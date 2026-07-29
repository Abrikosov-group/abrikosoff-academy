import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const ownerRole = "owner";
const action = "admin.role.bootstrap_grant";
const principalKey = "system:bootstrap";

export class AdminBootstrapError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.name = "AdminBootstrapError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function normalizeInput(input) {
  if (!isUuid(input.userId)) {
    throw new AdminBootstrapError(
      "INVALID_USER_ID",
      "Укажите корректный внутренний UUID пользователя.",
      2,
    );
  }

  if (input.role !== ownerRole) {
    throw new AdminBootstrapError(
      "ROLE_NOT_ENABLED",
      "В защитном фундаменте разрешена только роль owner.",
      2,
    );
  }

  if (
    typeof input.reason !== "string" ||
    input.reason.length < 10 ||
    input.reason.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(input.reason)
  ) {
    throw new AdminBootstrapError(
      "INVALID_REASON",
      "Причина должна содержать от 10 до 500 печатных символов.",
      2,
    );
  }

  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.length < 16 ||
    input.idempotencyKey.length > 64 ||
    !/^[A-Za-z0-9_-]+$/u.test(input.idempotencyKey)
  ) {
    throw new AdminBootstrapError(
      "INVALID_IDEMPOTENCY_KEY",
      "Укажите безопасный ключ идемпотентности длиной 16–64 символа.",
      2,
    );
  }

  return {
    ...input,
    userId: input.userId.toLowerCase(),
  };
}

function requestHash(input) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action,
        reason: input.reason,
        role: input.role,
        userId: input.userId,
      }),
    )
    .digest("hex");
}

async function reserveCommand(client, input) {
  const hash = requestHash(input);
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    let existing = await client.query(
      `
        SELECT
          id,
          request_sha256,
          status,
          result,
          error_code,
          lease_expires_at,
          attempt_count
        FROM admin_command_executions
        WHERE principal_key = $1
          AND action = $2
          AND idempotency_key = $3
        FOR UPDATE
      `,
      [principalKey, action, input.idempotencyKey],
    );

    if (!existing.rows[0]) {
      const executionId = randomUUID();
      const inserted = await client.query(
        `
          INSERT INTO admin_command_executions (
            id,
            principal_key,
            actor_user_id,
            action,
            idempotency_key,
            request_sha256,
            target_type,
            target_id,
            execution_kind,
            status,
            lease_expires_at,
            attempt_count
          )
          VALUES (
            $1,
            $2,
            NULL,
            $3,
            $4,
            $5,
            'identity_user',
            $6,
            'internal',
            'in_progress',
            now() + interval '5 minutes',
            1
          )
          ON CONFLICT (principal_key, action, idempotency_key)
          DO NOTHING
          RETURNING id, attempt_count
        `,
        [
          executionId,
          principalKey,
          action,
          input.idempotencyKey,
          hash,
          input.userId,
        ],
      );

      if (inserted.rows[0]) {
        await client.query("COMMIT");
        transactionOpen = false;

        return {
          executionId: inserted.rows[0].id,
          attemptCount: inserted.rows[0].attempt_count,
          repeated: false,
        };
      }

      existing = await client.query(
        `
          SELECT
            id,
            request_sha256,
            status,
            result,
            error_code,
            lease_expires_at,
            attempt_count
          FROM admin_command_executions
          WHERE principal_key = $1
            AND action = $2
            AND idempotency_key = $3
          FOR UPDATE
        `,
        [principalKey, action, input.idempotencyKey],
      );
    }

    const previous = existing.rows[0];

    if (!previous || previous.request_sha256 !== hash) {
      throw new AdminBootstrapError(
        "IDEMPOTENCY_CONFLICT",
        "Этот ключ идемпотентности уже связан с другой командой.",
        3,
      );
    }

    if (previous.status === "succeeded") {
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        executionId: previous.id,
        repeated: true,
        created: Boolean(previous.result?.created),
      };
    }

    if (previous.status === "rejected") {
      throw new AdminBootstrapError(
        previous.error_code || "COMMAND_REJECTED",
        "Команда ранее была отклонена с тем же ключом.",
        3,
      );
    }

    if (previous.status === "failed") {
      throw new AdminBootstrapError(
        previous.error_code || "COMMAND_FAILED",
        "Команда ранее завершилась ошибкой с тем же ключом.",
        3,
      );
    }

    if (
      previous.lease_expires_at &&
      previous.lease_expires_at.getTime() > Date.now()
    ) {
      throw new AdminBootstrapError(
        "COMMAND_IN_PROGRESS",
        "Команда с этим ключом уже выполняется.",
        3,
      );
    }

    const recovered = await client.query(
      `
        UPDATE admin_command_executions
        SET
          status = 'in_progress',
          lease_expires_at = now() + interval '5 minutes',
          attempt_count = attempt_count + 1,
          updated_at = now()
        WHERE id = $1
          AND status IN ('in_progress', 'waiting_external')
        RETURNING id, attempt_count
      `,
      [previous.id],
    );

    if (!recovered.rows[0]) {
      throw new AdminBootstrapError(
        "COMMAND_RESERVATION_LOST",
        "Не удалось безопасно зарезервировать повторную попытку.",
        3,
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      executionId: recovered.rows[0].id,
      attemptCount: recovered.rows[0].attempt_count,
      repeated: false,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    throw error;
  }
}

async function insertAuditEvent(
  client,
  {
    executionId,
    input,
    outcome,
    errorCode,
    beforeState = {},
    afterState = {},
  },
) {
  await client.query(
    `
      INSERT INTO admin_audit_events (
        id,
        request_id,
        command_execution_id,
        actor_kind,
        actor_user_id,
        actor_roles,
        action,
        target_type,
        target_id,
        reason,
        before_state,
        after_state,
        outcome,
        error_code
      )
      VALUES (
        $1,
        $2,
        $3,
        'system',
        NULL,
        ARRAY[]::text[],
        $4,
        'identity_user',
        $5,
        $6,
        $7::jsonb,
        $8::jsonb,
        $9,
        $10
      )
    `,
    [
      randomUUID(),
      randomUUID(),
      executionId,
      action,
      input.userId,
      input.reason,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      outcome,
      errorCode,
    ],
  );
}

async function rejectReservedCommand(
  client,
  input,
  reservation,
  {
    errorCode,
    resultStatus,
  },
) {
  const rejected = await client.query(
    `
      UPDATE admin_command_executions
      SET
        status = 'rejected',
        result_status = $4,
        result = $5::jsonb,
        error_code = $6,
        lease_expires_at = NULL,
        completed_at = now(),
        updated_at = now()
      WHERE id = $1
        AND request_sha256 = $2
        AND status = 'in_progress'
        AND attempt_count = $3
      RETURNING id
    `,
    [
      reservation.executionId,
      requestHash(input),
      reservation.attemptCount,
      resultStatus,
      JSON.stringify({ assigned: false }),
      errorCode,
    ],
  );

  if (!rejected.rows[0]) {
    throw new AdminBootstrapError(
      "COMMAND_ATTEMPT_SUPERSEDED",
      "Попытка команды потеряла право на запись результата.",
      3,
    );
  }

  await insertAuditEvent(client, {
    executionId: reservation.executionId,
    input,
    outcome: "rejected",
    errorCode,
  });

  return {
    executionId: reservation.executionId,
    rejectedCode: errorCode,
  };
}

async function executeReservedCommand(client, input, reservation) {
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const execution = await client.query(
      `
        SELECT id
        FROM admin_command_executions
        WHERE id = $1
          AND request_sha256 = $2
          AND status = 'in_progress'
          AND attempt_count = $3
          AND lease_expires_at > now()
        FOR UPDATE
      `,
      [
        reservation.executionId,
        requestHash(input),
        reservation.attemptCount,
      ],
    );

    if (!execution.rows[0]) {
      throw new AdminBootstrapError(
        "COMMAND_ATTEMPT_SUPERSEDED",
        "Попытка команды потеряла право на запись результата.",
        3,
      );
    }

    const invariantLock = await client.query(
      `
        SELECT name
        FROM admin_invariant_locks
        WHERE name = 'active_owner'
        FOR UPDATE
      `,
    );

    if (!invariantLock.rows[0]) {
      throw new AdminBootstrapError(
        "OWNER_INVARIANT_LOCK_MISSING",
        "Защитный lock владельца не найден.",
      );
    }

    const user = await client.query(
      `
        SELECT status
        FROM identity_users
        WHERE id = $1
        FOR SHARE
      `,
      [input.userId],
    );

    if (!user.rows[0] || user.rows[0].status !== "active") {
      const result = await rejectReservedCommand(
        client,
        input,
        reservation,
        {
          errorCode: "ACTIVE_USER_NOT_FOUND",
          resultStatus: 404,
        },
      );
      await client.query("COMMIT");
      transactionOpen = false;

      return result;
    }

    const telegramMethod = await client.query(
      `
        SELECT id
        FROM identity_methods
        WHERE user_id = $1
          AND method_type = 'telegram'
          AND verified_at IS NOT NULL
        ORDER BY verified_at DESC, id
        LIMIT 1
        FOR SHARE
      `,
      [input.userId],
    );

    if (!telegramMethod.rows[0]) {
      const result = await rejectReservedCommand(
        client,
        input,
        reservation,
        {
          errorCode: "ACTIVE_TELEGRAM_METHOD_REQUIRED",
          resultStatus: 422,
        },
      );
      await client.query("COMMIT");
      transactionOpen = false;

      return result;
    }

    const activeOwners = await client.query(
      `
        SELECT id, user_id
        FROM admin_role_assignments
        WHERE role = 'owner'
          AND status = 'active'
        ORDER BY granted_at, id
        FOR SHARE
      `,
    );
    const previousAssignment = activeOwners.rows.find(
      (assignment) => assignment.user_id === input.userId,
    );

    if (activeOwners.rows.length > 0 && !previousAssignment) {
      const result = await rejectReservedCommand(
        client,
        input,
        reservation,
        {
          errorCode: "BOOTSTRAP_OWNER_ALREADY_EXISTS",
          resultStatus: 409,
        },
      );
      await client.query("COMMIT");
      transactionOpen = false;

      return result;
    }

    const created = !previousAssignment;

    if (created) {
      await client.query(
        `
          INSERT INTO admin_role_assignments (
            id,
            user_id,
            role,
            status,
            granted_by_user_id,
            granted_by_kind,
            grant_reason
          )
          VALUES (
            $1,
            $2,
            'owner',
            'active',
            NULL,
            'system',
            $3
          )
        `,
        [randomUUID(), input.userId, input.reason],
      );
    }

    const beforeState = created
      ? { role: ownerRole, status: null }
      : { role: ownerRole, status: "active" };
    const result = {
      assigned: true,
      created,
      role: ownerRole,
      status: "active",
    };
    const completed = await client.query(
      `
        UPDATE admin_command_executions
        SET
          status = 'succeeded',
          result_status = 200,
          result = $4::jsonb,
          error_code = NULL,
          lease_expires_at = NULL,
          completed_at = now(),
          updated_at = now()
        WHERE id = $1
          AND request_sha256 = $2
          AND status = 'in_progress'
          AND attempt_count = $3
        RETURNING id
      `,
      [
        reservation.executionId,
        requestHash(input),
        reservation.attemptCount,
        JSON.stringify(result),
      ],
    );

    if (!completed.rows[0]) {
      throw new AdminBootstrapError(
        "COMMAND_ATTEMPT_SUPERSEDED",
        "Попытка команды потеряла право на запись результата.",
        3,
      );
    }

    await insertAuditEvent(client, {
      executionId: reservation.executionId,
      input,
      outcome: "succeeded",
      errorCode: null,
      beforeState,
      afterState: {
        role: ownerRole,
        status: "active",
      },
    });
    await client.query("COMMIT");
    transactionOpen = false;

    return {
      executionId: reservation.executionId,
      repeated: false,
      created,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    throw error;
  }
}

async function recordFailedAttempt(
  client,
  input,
  reservation,
  error,
) {
  const errorCode =
    error instanceof AdminBootstrapError
      ? error.code
      : "ADMIN_BOOTSTRAP_FAILED";
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const failed = await client.query(
      `
        UPDATE admin_command_executions
        SET
          status = 'failed',
          result_status = 500,
          result = $4::jsonb,
          error_code = $5,
          lease_expires_at = NULL,
          completed_at = now(),
          updated_at = now()
        WHERE id = $1
          AND request_sha256 = $2
          AND status = 'in_progress'
          AND attempt_count = $3
        RETURNING id
      `,
      [
        reservation.executionId,
        requestHash(input),
        reservation.attemptCount,
        JSON.stringify({ assigned: false }),
        errorCode,
      ],
    );

    if (failed.rows[0]) {
      await insertAuditEvent(client, {
        executionId: reservation.executionId,
        input,
        outcome: "failed",
        errorCode,
      });
    }

    await client.query("COMMIT");
    transactionOpen = false;
  } catch {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
  }
}

export async function bootstrapOwner(input, options = {}) {
  const normalizedInput = normalizeInput(input);
  const administrationEnabled =
    process.env.ADMINISTRATION_ENABLED?.trim().toLowerCase();

  if (
    process.env.NODE_ENV === "production" &&
    administrationEnabled !== "false"
  ) {
    throw new AdminBootstrapError(
      "ADMINISTRATION_GATE_MUST_BE_DISABLED",
      "Bootstrap разрешён только при явно выключенном production-гейте.",
      2,
    );
  }

  const connectionString =
    options.databaseUrl || process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new AdminBootstrapError(
      "DATABASE_NOT_CONFIGURED",
      "DATABASE_URL не задан.",
      2,
    );
  }

  const client = new Client({
    connectionString,
    application_name: "academy-admin-bootstrap",
  });

  await client.connect();

  try {
    const reservation = await reserveCommand(
      client,
      normalizedInput,
    );

    if (reservation.repeated) {
      return reservation;
    }

    let result;

    try {
      result = await executeReservedCommand(
        client,
        normalizedInput,
        reservation,
      );
    } catch (error) {
      await recordFailedAttempt(
        client,
        normalizedInput,
        reservation,
        error,
      );
      throw error;
    }

    if (result.rejectedCode) {
      const rejectionMessages = {
        ACTIVE_USER_NOT_FOUND:
          "Активный пользователь с указанным UUID не найден.",
        ACTIVE_TELEGRAM_METHOD_REQUIRED:
          "Для первого владельца требуется подтверждённый вход через Telegram.",
        BOOTSTRAP_OWNER_ALREADY_EXISTS:
          "Первый владелец уже назначен другой учётной записи.",
      };
      const message =
        rejectionMessages[result.rejectedCode] ??
        "Команда назначения первого владельца отклонена.";

      throw new AdminBootstrapError(
        result.rejectedCode,
        message,
        3,
      );
    }

    return result;
  } finally {
    await client.end();
  }
}
