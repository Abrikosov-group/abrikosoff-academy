import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { IdentityAdministrationRepository } from "@/modules/identity/application/identity-administration-repository";
import {
  normalizeRevokeUserSessionsInput,
  RevokeUserSessionsService,
} from "@/modules/administration/application/revoke-user-sessions-service";
import { configuredPermissionsForRole } from "@/modules/administration/domain/permissions";
import type { AdminContext } from "@/modules/administration/domain/types";
import { PostgresAdministrationCommandRepository } from "@/modules/administration/infrastructure/postgres-administration-command-repository";
import { PostgresIdentityAdministrationRepository } from "@/modules/identity/infrastructure/postgres-identity-administration-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const pool = new Pool({
  connectionString: testDatabaseUrl,
  application_name:
    "academy-admin-session-commands-integration-tests",
  max: 4,
});
const ownerPermissions = configuredPermissionsForRole("owner");
const suspectedAccessReason =
  "suspected_unauthorized_access";
const studentRequestReason = "student_requested_sign_out";
const deviceChangedReason = "trusted_device_changed";
const supportMeasureReason = "support_security_measure";

async function insertUser(
  displayName: string,
  status: "active" | "blocked" | "deleted" = "active",
) {
  const id = randomUUID();

  await pool.query(
    `
      INSERT INTO identity_users (
        id,
        display_name,
        status
      )
      VALUES ($1, $2, $3)
    `,
    [id, displayName, status],
  );

  return id;
}

async function insertSession(
  userId: string,
  input: {
    expiresAt?: string;
    id?: string;
    revokedAt?: string;
  } = {},
) {
  const id = input.id ?? randomUUID();
  const tokenSha256 = createHash("sha256")
    .update(randomUUID())
    .digest("hex");

  await pool.query(
    `
      INSERT INTO identity_sessions (
        id,
        user_id,
        token_sha256,
        expires_at,
        revoked_at
      )
      VALUES (
        $1,
        $2,
        $3,
        COALESCE(
          $4::timestamptz,
          now() + interval '1 day'
        ),
        $5
      )
    `,
    [
      id,
      userId,
      tokenSha256,
      input.expiresAt ?? null,
      input.revokedAt ?? null,
    ],
  );

  return id;
}

function context(
  actorUserId: string,
  requestId = randomUUID(),
  sessionId = randomUUID(),
): AdminContext {
  return {
    actor: {
      id: actorUserId,
      displayName: "Владелец интеграционного теста",
      primaryMethod: {
        id: randomUUID(),
        type: "telegram",
        identifier: `owner-${actorUserId}`,
        metadata: {},
      },
    },
    sessionId,
    roles: ["owner"],
    permissions: ownerPermissions,
    adminVerifiedAt: new Date(),
    adminVerificationMethod: "telegram_oidc",
    requestId,
  };
}

function service(
  identityRepository: IdentityAdministrationRepository =
    new PostgresIdentityAdministrationRepository(),
) {
  return new RevokeUserSessionsService(
    new PostgresAdministrationCommandRepository(
      pool,
      identityRepository,
    ),
  );
}

describe("отзыв сессий ученика с PostgreSQL", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("атомарно отзывает только активные сессии и пишет один audit при повторе", async () => {
    const actorUserId = await insertUser(
      "Владелец успешной команды",
    );
    const targetUserId = await insertUser(
      "Ученик успешной команды",
    );
    const firstActiveSessionId =
      await insertSession(targetUserId);
    const secondActiveSessionId =
      await insertSession(targetUserId);
    const expiredSessionId = await insertSession(
      targetUserId,
      {
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
    );
    const previouslyRevokedAt =
      "2026-07-01T00:00:00.000Z";
    const revokedSessionId = await insertSession(
      targetUserId,
      {
        revokedAt: previouslyRevokedAt,
      },
    );
    const requestId = randomUUID();
    const commandContext = context(actorUserId, requestId);
    const idempotencyKey = randomUUID();
    const input = {
      context: commandContext,
      targetUserId,
      reason: suspectedAccessReason,
      idempotencyKey,
      userAgentFamily: "Google Chrome",
    };
    const commandService = service();

    await expect(commandService.execute(input)).resolves.toEqual({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      revokedSessionCount: 2,
    });
    await expect(
      commandService.execute({
        ...input,
        context: context(actorUserId),
      }),
    ).resolves.toEqual({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      revokedSessionCount: 2,
    });

    const sessions = await pool.query<{
      id: string;
      revoked_at: Date | null;
    }>(
      `
        SELECT id, revoked_at
        FROM identity_sessions
        WHERE id = ANY($1::uuid[])
        ORDER BY id
      `,
      [
        [
          firstActiveSessionId,
          secondActiveSessionId,
          expiredSessionId,
          revokedSessionId,
        ],
      ],
    );
    const sessionsById = new Map(
      sessions.rows.map((row) => [row.id, row.revoked_at]),
    );

    expect(sessionsById.get(firstActiveSessionId)).toBeInstanceOf(
      Date,
    );
    expect(sessionsById.get(secondActiveSessionId)).toBeInstanceOf(
      Date,
    );
    expect(sessionsById.get(expiredSessionId)).toBeNull();
    expect(
      sessionsById.get(revokedSessionId)?.toISOString(),
    ).toBe(previouslyRevokedAt);

    const executions = await pool.query<{
      id: string;
      principal_key: string;
      action: string;
      target_type: string;
      target_id: string;
      status: string;
      result_status: number;
      result: {
        activeSessionCount: number;
        revokedSessionCount: number;
      };
      attempt_count: number;
    }>(
      `
        SELECT
          id,
          principal_key,
          action,
          target_type,
          target_id,
          status,
          result_status,
          result,
          attempt_count
        FROM admin_command_executions
        WHERE principal_key = $1
          AND action = 'identity.sessions.revoke_all'
          AND idempotency_key = $2
      `,
      [`user:${actorUserId}`, idempotencyKey],
    );

    expect(executions.rows).toEqual([
      expect.objectContaining({
        principal_key: `user:${actorUserId}`,
        action: "identity.sessions.revoke_all",
        target_type: "identity_user",
        target_id: targetUserId,
        status: "succeeded",
        result_status: 200,
        result: {
          activeSessionCount: 0,
          revokedSessionCount: 2,
        },
        attempt_count: 1,
      }),
    ]);

    const audit = await pool.query<{
      request_id: string;
      command_execution_id: string;
      actor_user_id: string;
      actor_roles: string[];
      reason: string;
      before_state: { activeSessionCount: number };
      after_state: {
        activeSessionCount: number;
        revokedSessionCount: number;
      };
      outcome: string;
      error_code: string | null;
      user_agent_family: string | null;
    }>(
      `
        SELECT
          request_id,
          command_execution_id,
          actor_user_id,
          actor_roles,
          reason,
          before_state,
          after_state,
          outcome,
          error_code,
          user_agent_family
        FROM admin_audit_events
        WHERE command_execution_id = $1
      `,
      [executions.rows[0]?.id],
    );

    expect(audit.rows).toEqual([
      {
        request_id: requestId,
        command_execution_id: executions.rows[0]?.id,
        actor_user_id: actorUserId,
        actor_roles: ["owner"],
        reason: "Подозрение на посторонний доступ",
        before_state: {
          activeSessionCount: 2,
        },
        after_state: {
          activeSessionCount: 0,
          revokedSessionCount: 2,
        },
        outcome: "succeeded",
        error_code: null,
        user_agent_family: "Google Chrome",
      },
    ]);
  });

  it("не переисполняет ключ с изменённой причиной", async () => {
    const actorUserId = await insertUser(
      "Владелец конфликта",
    );
    const targetUserId = await insertUser(
      "Ученик конфликта",
    );
    const commandService = service();
    const idempotencyKey = randomUUID();

    await insertSession(targetUserId);
    await commandService.execute({
      context: context(actorUserId),
      targetUserId,
      reason: suspectedAccessReason,
      idempotencyKey,
    });
    const laterSessionId = await insertSession(targetUserId);

    await expect(
      commandService.execute({
        context: context(actorUserId),
        targetUserId,
        reason: studentRequestReason,
        idempotencyKey,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "IDEMPOTENCY_CONFLICT",
        httpStatus: 409,
      }),
    );

    const laterSession = await pool.query<{
      revoked_at: Date | null;
    }>(
      `
        SELECT revoked_at
        FROM identity_sessions
        WHERE id = $1
      `,
      [laterSessionId],
    );

    expect(laterSession.rows[0]?.revoked_at).toBeNull();
  });

  it("изолирует одинаковый ключ между двумя principals", async () => {
    const firstActorUserId = await insertUser(
      "Первый владелец principal",
    );
    const secondActorUserId = await insertUser(
      "Второй владелец principal",
    );
    const targetUserId = await insertUser(
      "Ученик двух principals",
    );
    const idempotencyKey = randomUUID();
    const commandService = service();

    await insertSession(targetUserId);
    await expect(
      commandService.execute({
        context: context(firstActorUserId),
        targetUserId,
        reason: supportMeasureReason,
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ revokedSessionCount: 1 });

    await insertSession(targetUserId);
    await expect(
      commandService.execute({
        context: context(secondActorUserId),
        targetUserId,
        reason: supportMeasureReason,
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ revokedSessionCount: 1 });

    const executions = await pool.query<{ count: number }>(
      `
        SELECT count(*)::integer AS count
        FROM admin_command_executions
        WHERE idempotency_key = $1
          AND action = 'identity.sessions.revoke_all'
          AND actor_user_id = ANY($2::uuid[])
      `,
      [
        idempotencyKey,
        [firstActorUserId, secondActorUserId],
      ],
    );

    expect(executions.rows[0]?.count).toBe(2);
  });

  it("не запускает живое исполнение и восстанавливает истёкший lease с новым fencing attempt", async () => {
    const actorUserId = await insertUser(
      "Владелец lease",
    );
    const liveTargetUserId = await insertUser(
      "Ученик живого lease",
    );
    const expiredTargetUserId = await insertUser(
      "Ученик истёкшего lease",
    );
    const liveContext = context(actorUserId);
    const expiredContext = context(actorUserId);
    const liveInput = {
      context: liveContext,
      targetUserId: liveTargetUserId,
      reason: supportMeasureReason,
      idempotencyKey: randomUUID(),
    };
    const expiredInput = {
      context: expiredContext,
      targetUserId: expiredTargetUserId,
      reason: supportMeasureReason,
      idempotencyKey: randomUUID(),
    };
    const liveCommand =
      normalizeRevokeUserSessionsInput(liveInput);
    const expiredCommand =
      normalizeRevokeUserSessionsInput(expiredInput);

    await insertSession(liveTargetUserId);
    await insertSession(expiredTargetUserId);
    await pool.query(
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
        VALUES
          (
            $1, $2, $3, $4, $5, $6, $7, $8,
            'internal', 'in_progress',
            now() + interval '5 minutes', 1
          ),
          (
            $9, $10, $11, $12, $13, $14, $15, $16,
            'internal', 'in_progress',
            now() - interval '1 minute', 1
          )
      `,
      [
        randomUUID(),
        liveCommand.principalKey,
        liveCommand.actorUserId,
        liveCommand.action,
        liveCommand.idempotencyKey,
        liveCommand.requestSha256,
        liveCommand.targetType,
        liveCommand.targetId,
        randomUUID(),
        expiredCommand.principalKey,
        expiredCommand.actorUserId,
        expiredCommand.action,
        expiredCommand.idempotencyKey,
        expiredCommand.requestSha256,
        expiredCommand.targetType,
        expiredCommand.targetId,
      ],
    );
    const commandService = service();

    await expect(
      commandService.execute(liveInput),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "COMMAND_IN_PROGRESS",
        httpStatus: 409,
      }),
    );
    await expect(
      commandService.execute(expiredInput),
    ).resolves.toMatchObject({
      activeSessionCount: 0,
      revokedSessionCount: 1,
    });

    const recovered = await pool.query<{
      status: string;
      attempt_count: number;
    }>(
      `
        SELECT status, attempt_count
        FROM admin_command_executions
        WHERE principal_key = $1
          AND action = $2
          AND idempotency_key = $3
      `,
      [
        expiredCommand.principalKey,
        expiredCommand.action,
        expiredCommand.idempotencyKey,
      ],
    );

    expect(recovered.rows[0]).toEqual({
      status: "succeeded",
      attempt_count: 2,
    });
  });

  it("не позволяет старому fencing attempt завершить восстановленную команду", async () => {
    const actorUserId = await insertUser(
      "Владелец fencing",
    );
    const targetUserId = await insertUser(
      "Ученик fencing",
    );
    const sessionId = await insertSession(targetUserId);
    const input = {
      context: context(actorUserId),
      targetUserId,
      reason: supportMeasureReason,
      idempotencyKey: randomUUID(),
    };
    const command = normalizeRevokeUserSessionsInput(input);
    const commandRepository =
      new PostgresAdministrationCommandRepository(
        pool,
        new PostgresIdentityAdministrationRepository(),
      );
    const firstReservation =
      await commandRepository.reserveInternalCommand(command);

    expect(firstReservation.state).toBe("reserved");

    if (firstReservation.state !== "reserved") {
      throw new Error(
        "Первая попытка команды не была зарезервирована.",
      );
    }

    await pool.query(
      `
        UPDATE admin_command_executions
        SET
          lease_expires_at = now() - interval '1 minute',
          updated_at = now()
        WHERE id = $1
      `,
      [firstReservation.executionId],
    );
    const recoveredReservation =
      await commandRepository.reserveInternalCommand(command);

    expect(recoveredReservation).toMatchObject({
      state: "reserved",
      executionId: firstReservation.executionId,
      attemptCount: 2,
    });

    if (recoveredReservation.state !== "reserved") {
      throw new Error(
        "Истёкшая команда не была восстановлена.",
      );
    }

    await expect(
      commandRepository.executeRevokeUserSessions(
        command,
        firstReservation,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "COMMAND_ATTEMPT_SUPERSEDED",
        httpStatus: 409,
      }),
    );

    const beforeCurrentAttempt = await pool.query<{
      revoked_at: Date | null;
    }>(
      `
        SELECT revoked_at
        FROM identity_sessions
        WHERE id = $1
      `,
      [sessionId],
    );

    expect(
      beforeCurrentAttempt.rows[0]?.revoked_at,
    ).toBeNull();
    await expect(
      commandRepository.executeRevokeUserSessions(
        command,
        recoveredReservation,
      ),
    ).resolves.toMatchObject({
      state: "succeeded",
      revokedSessionCount: 1,
    });
  });

  it("сохраняет предметный отказ и возвращает его при повторе", async () => {
    const actorUserId = await insertUser(
      "Владелец отсутствующего ученика",
    );
    const targetUserId = randomUUID();
    const idempotencyKey = randomUUID();
    const commandService = service();
    const input = {
      context: context(actorUserId),
      targetUserId,
      reason: studentRequestReason,
      idempotencyKey,
    };

    await expect(commandService.execute(input)).rejects.toEqual(
      expect.objectContaining({
        code: "USER_NOT_FOUND",
        httpStatus: 404,
      }),
    );
    await expect(
      commandService.execute({
        ...input,
        context: context(actorUserId),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "USER_NOT_FOUND",
        httpStatus: 404,
      }),
    );

    const journal = await pool.query<{
      status: string;
      result_status: number;
      error_code: string;
      audit_count: number;
    }>(
      `
        SELECT
          execution.status,
          execution.result_status,
          execution.error_code,
          count(audit.id)::integer AS audit_count
        FROM admin_command_executions execution
        LEFT JOIN admin_audit_events audit
          ON audit.command_execution_id = execution.id
        WHERE execution.principal_key = $1
          AND execution.action =
            'identity.sessions.revoke_all'
          AND execution.idempotency_key = $2
        GROUP BY execution.id
      `,
      [`user:${actorUserId}`, idempotencyKey],
    );

    expect(journal.rows).toEqual([
      {
        status: "rejected",
        result_status: 404,
        error_code: "USER_NOT_FOUND",
        audit_count: 1,
      },
    ]);
  });

  it("не завершает новую сессию актёра при повторе прежней самоотзыв-команды", async () => {
    const actorUserId = await insertUser(
      "Владелец самоотзыва",
    );
    const firstSessionId = randomUUID();
    const secondSessionId = randomUUID();
    const idempotencyKey = randomUUID();
    const reason = deviceChangedReason;
    const commandService = service();

    await insertSession(actorUserId, {
      id: firstSessionId,
    });
    await expect(
      commandService.execute({
        context: context(
          actorUserId,
          randomUUID(),
          firstSessionId,
        ),
        targetUserId: actorUserId,
        reason,
        idempotencyKey,
      }),
    ).resolves.toEqual({
      activeSessionCount: 0,
      currentSessionRevoked: true,
      revokedSessionCount: 1,
    });

    await insertSession(actorUserId, {
      id: secondSessionId,
    });
    await expect(
      commandService.execute({
        context: context(
          actorUserId,
          randomUUID(),
          secondSessionId,
        ),
        targetUserId: actorUserId,
        reason,
        idempotencyKey,
      }),
    ).resolves.toEqual({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      revokedSessionCount: 1,
    });

    const newSession = await pool.query<{
      revoked_at: Date | null;
    }>(
      `
        SELECT revoked_at
        FROM identity_sessions
        WHERE id = $1
      `,
      [secondSessionId],
    );
    const states = await pool.query<{
      result: {
        revokedActorSessionId: string;
      };
      after_state: Record<string, unknown>;
    }>(
      `
        SELECT execution.result, audit.after_state
        FROM admin_command_executions execution
        JOIN admin_audit_events audit
          ON audit.command_execution_id = execution.id
        WHERE execution.principal_key = $1
          AND execution.action =
            'identity.sessions.revoke_all'
          AND execution.idempotency_key = $2
      `,
      [`user:${actorUserId}`, idempotencyKey],
    );

    expect(newSession.rows[0]?.revoked_at).toBeNull();
    expect(
      states.rows[0]?.result.revokedActorSessionId,
    ).toBe(firstSessionId);
    expect(states.rows[0]?.after_state).not.toHaveProperty(
      "revokedActorSessionId",
    );
  });

  it("откатывает Identity-изменение и атомарно фиксирует failed при неожиданной ошибке", async () => {
    const actorUserId = await insertUser(
      "Владелец отказавшей команды",
    );
    const targetUserId = await insertUser(
      "Ученик отказавшей команды",
    );
    const sessionId = await insertSession(targetUserId);
    const idempotencyKey = randomUUID();
    const failingIdentityRepository: IdentityAdministrationRepository =
      {
        async revokeActiveSessions(client, input) {
          expect(input.trackedSessionId).toBeUndefined();
          await client.query(
            `
              UPDATE identity_sessions
              SET revoked_at = $2
              WHERE user_id = $1
                AND revoked_at IS NULL
            `,
            [input.userId, input.revokedAt],
          );
          throw new Error(
            "Искусственный сбой после бизнес-изменения",
          );
        },
      };
    const commandService = service(
      failingIdentityRepository,
    );

    await expect(
      commandService.execute({
        context: context(actorUserId),
        targetUserId,
        reason: supportMeasureReason,
        idempotencyKey,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "REVOKE_USER_SESSIONS_FAILED",
        httpStatus: 500,
      }),
    );

    const session = await pool.query<{
      revoked_at: Date | null;
    }>(
      `
        SELECT revoked_at
        FROM identity_sessions
        WHERE id = $1
      `,
      [sessionId],
    );
    const journal = await pool.query<{
      status: string;
      error_code: string;
      outcome: string;
      audit_error_code: string;
    }>(
      `
        SELECT
          execution.status,
          execution.error_code,
          audit.outcome,
          audit.error_code AS audit_error_code
        FROM admin_command_executions execution
        JOIN admin_audit_events audit
          ON audit.command_execution_id = execution.id
        WHERE execution.principal_key = $1
          AND execution.action =
            'identity.sessions.revoke_all'
          AND execution.idempotency_key = $2
      `,
      [`user:${actorUserId}`, idempotencyKey],
    );

    expect(session.rows[0]?.revoked_at).toBeNull();
    expect(journal.rows).toEqual([
      {
        status: "failed",
        error_code: "REVOKE_USER_SESSIONS_FAILED",
        outcome: "failed",
        audit_error_code: "REVOKE_USER_SESSIONS_FAILED",
      },
    ]);
  });

  it("откатывает отзыв сессий и сигнализирует, если audit недоступен", async () => {
    const actorUserId = await insertUser(
      "Владелец проверки недоступного аудита",
    );
    const targetUserId = await insertUser(
      "Ученик проверки недоступного аудита",
    );
    const sessionId = await insertSession(targetUserId);
    const idempotencyKey = randomUUID();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await pool.query(
      `
        CREATE OR REPLACE FUNCTION
          test_reject_revoke_sessions_audit_insert()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'forced audit failure';
        END;
        $$
      `,
    );
    await pool.query(
      `
        CREATE TRIGGER
          test_reject_revoke_sessions_audit_insert
        BEFORE INSERT ON admin_audit_events
        FOR EACH ROW
        EXECUTE FUNCTION
          test_reject_revoke_sessions_audit_insert()
      `,
    );

    try {
      await expect(
        service().execute({
          context: context(actorUserId),
          targetUserId,
          reason: supportMeasureReason,
          idempotencyKey,
        }),
      ).rejects.toEqual(
        expect.objectContaining({
          code: "COMMAND_RECOVERY_REQUIRED",
          httpStatus: 503,
        }),
      );
    } finally {
      await pool.query(
        `
          DROP TRIGGER IF EXISTS
            test_reject_revoke_sessions_audit_insert
            ON admin_audit_events
        `,
      );
      await pool.query(
        `
          DROP FUNCTION IF EXISTS
            test_reject_revoke_sessions_audit_insert()
        `,
      );
    }

    const session = await pool.query<{
      revoked_at: Date | null;
    }>(
      `
        SELECT revoked_at
        FROM identity_sessions
        WHERE id = $1
      `,
      [sessionId],
    );
    const journal = await pool.query<{
      status: string;
      audit_count: number;
    }>(
      `
        SELECT
          execution.status,
          count(audit.id)::integer AS audit_count
        FROM admin_command_executions execution
        LEFT JOIN admin_audit_events audit
          ON audit.command_execution_id = execution.id
        WHERE execution.principal_key = $1
          AND execution.action =
            'identity.sessions.revoke_all'
          AND execution.idempotency_key = $2
        GROUP BY execution.id
      `,
      [`user:${actorUserId}`, idempotencyKey],
    );
    const loggedEvents = consoleError.mock.calls.map(
      ([entry]) => JSON.parse(String(entry)) as {
        event?: string;
        metric?: string;
      },
    );

    expect(session.rows[0]?.revoked_at).toBeNull();
    expect(journal.rows).toEqual([
      {
        status: "in_progress",
        audit_count: 0,
      },
    ]);
    expect(loggedEvents).toContainEqual(
      expect.objectContaining({
        event: "administration.audit_write_failed",
        metric: "admin_audit_write_failed_total",
      }),
    );
  });
});
