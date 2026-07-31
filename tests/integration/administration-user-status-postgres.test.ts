import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  describe,
  expect,
  it,
} from "vitest";
import { ChangeUserStatusService } from "@/modules/administration/application/change-user-status-service";
import { configuredPermissionsForRole } from "@/modules/administration/domain/permissions";
import type { AdminContext } from "@/modules/administration/domain/types";
import { PostgresAdministrationCommandRepository } from "@/modules/administration/infrastructure/postgres-administration-command-repository";
import type {
  ApplyIdentityUserStatusResult,
  IdentityUserStatusAdministrationRepository,
  LockedIdentityUserStatus,
} from "@/modules/identity/application/identity-user-status-administration-repository";
import type { IdentityUserStatus } from "@/modules/identity/domain/types";
import { PostgresIdentityAdministrationRepository } from "@/modules/identity/infrastructure/postgres-identity-administration-repository";
import { PostgresIdentityRepository } from "@/modules/identity/infrastructure/postgres-identity-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const pool = new Pool({
  connectionString: testDatabaseUrl,
  application_name:
    "academy-admin-user-status-integration-tests",
  max: 6,
});
const ownerPermissions = configuredPermissionsForRole("owner");

async function insertUser(
  displayName: string,
  status: IdentityUserStatus = "active",
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

async function insertTelegramMethod(userId: string) {
  const id = randomUUID();
  const identifier = `telegram-${randomUUID()}`;

  await pool.query(
    `
      INSERT INTO identity_methods (
        id,
        user_id,
        method_type,
        identifier,
        verified_at,
        metadata
      )
      VALUES (
        $1,
        $2,
        'telegram',
        $3,
        now(),
        '{}'::jsonb
      )
    `,
    [id, userId, identifier],
  );

  return { id, identifier };
}

async function insertSession(
  userId: string,
  input: {
    id?: string;
    expiresAt?: string;
  } = {},
) {
  const id = input.id ?? randomUUID();

  await pool.query(
    `
      INSERT INTO identity_sessions (
        id,
        user_id,
        token_sha256,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        COALESCE(
          $4::timestamptz,
          now() + interval '1 day'
        )
      )
    `,
    [
      id,
      userId,
      createHash("sha256")
        .update(randomUUID())
        .digest("hex"),
      input.expiresAt ?? null,
    ],
  );

  return id;
}

async function insertOwnerRole(userId: string) {
  await pool.query(
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
        'Подготовка integration-теста состояния пользователя'
      )
    `,
    [randomUUID(), userId],
  );
}

async function insertPaidAccess(userId: string) {
  const orderId = randomUUID();

  await pool.query(
    `
      INSERT INTO billing_orders (
        id,
        customer_id,
        plan_id,
        legal_entity_id,
        country_code,
        amount_minor,
        currency,
        status,
        idempotency_key,
        selected_provider,
        merchant_account_id,
        offer_accepted_at,
        offer_version,
        receipt_email
      )
      VALUES (
        $1,
        $2,
        'annual',
        'ip-fedotova',
        'RU',
        1400000,
        'RUB',
        'paid',
        $3,
        'demo',
        'admin-user-status-integration',
        now(),
        'integration',
        'status-test@example.test'
      )
    `,
    [orderId, userId, randomUUID()],
  );
  await pool.query(
    `
      INSERT INTO billing_access_grants (
        order_id,
        customer_id,
        plan_id,
        status,
        period_start,
        period_end,
        granted_at
      )
      VALUES (
        $1,
        $2,
        'annual',
        'granted',
        now() - interval '1 day',
        now() + interval '1 year',
        now()
      )
    `,
    [orderId, userId],
  );

  return orderId;
}

function context(
  actorUserId: string,
  sessionId: string = randomUUID(),
): AdminContext {
  return {
    actor: {
      id: actorUserId,
      displayName: "Владелец integration-теста",
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
    requestId: randomUUID(),
  };
}

function service(
  statusRepository: IdentityUserStatusAdministrationRepository =
    new PostgresIdentityAdministrationRepository(),
) {
  const identityRepository =
    new PostgresIdentityAdministrationRepository();

  return new ChangeUserStatusService(
    new PostgresAdministrationCommandRepository(
      pool,
      identityRepository,
      statusRepository,
    ),
  );
}

async function suspendExistingAvailableOwners() {
  const suspended = await pool.query<{ id: string }>(
    `
      UPDATE identity_users users
      SET
        status = 'blocked',
        updated_at = now()
      WHERE users.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM admin_role_assignments assignments
          WHERE assignments.user_id = users.id
            AND assignments.role = 'owner'
            AND assignments.status = 'active'
        )
      RETURNING users.id
    `,
  );
  const userIds = suspended.rows.map((row) => row.id);

  return async () => {
    if (userIds.length === 0) {
      return;
    }

    await pool.query(
      `
        UPDATE identity_users
        SET
          status = 'active',
          updated_at = now()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds],
    );
  };
}

async function waitForBlockedQuery(
  applicationName: string,
  queryFragment: string,
) {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    const activity = await pool.query<{
      wait_event_type: string | null;
    }>(
      `
        SELECT wait_event_type
        FROM pg_stat_activity
        WHERE application_name = $1
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND position($2 in query) > 0
      `,
      [applicationName, queryFragment],
    );

    if (activity.rows[0]) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(
    `Не дождались заблокированного запроса ${queryFragment}.`,
  );
}

describe("изменение состояния ученика с PostgreSQL", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("атомарно блокирует, отзывает сессии, сохраняет оплаченный доступ и разблокирует без восстановления сессий", async () => {
    const actorUserId = await insertUser(
      "Владелец команды состояния",
    );
    await insertOwnerRole(actorUserId);
    const targetUserId = await insertUser(
      "Ученик команды состояния",
    );
    const firstSessionId = await insertSession(targetUserId);
    const secondSessionId = await insertSession(targetUserId);
    const expiredSessionId = await insertSession(targetUserId, {
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const orderId = await insertPaidAccess(targetUserId);
    const commandService = service();
    const blockIdempotencyKey = randomUUID();
    const blockInput = {
      context: context(actorUserId),
      targetUserId,
      statusAction: "block",
      reason: "support_security_measure",
      idempotencyKey: blockIdempotencyKey,
      userAgentFamily: "Google Chrome",
    };

    await expect(
      commandService.execute(blockInput),
    ).resolves.toEqual({
      status: "blocked",
      statusChanged: true,
      revokedSessionCount: 2,
      currentSessionRevoked: false,
    });
    await expect(
      commandService.execute(blockInput),
    ).resolves.toEqual({
      status: "blocked",
      statusChanged: true,
      revokedSessionCount: 2,
      currentSessionRevoked: false,
    });

    const blockedState = await pool.query<{
      status: IdentityUserStatus;
    }>(
      `
        SELECT status
        FROM identity_users
        WHERE id = $1
      `,
      [targetUserId],
    );
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
      [[firstSessionId, secondSessionId, expiredSessionId]],
    );
    const paidAccess = await pool.query<{
      status: string;
    }>(
      `
        SELECT status
        FROM billing_access_grants
        WHERE order_id = $1
      `,
      [orderId],
    );
    const blockEvidence = await pool.query<{
      audit_count: number;
      execution_count: number;
    }>(
      `
        SELECT
          count(DISTINCT execution.id)::integer
            AS execution_count,
          count(DISTINCT audit.id)::integer
            AS audit_count
        FROM admin_command_executions execution
        LEFT JOIN admin_audit_events audit
          ON audit.command_execution_id = execution.id
        WHERE execution.principal_key = $1
          AND execution.action = 'identity.user.block'
          AND execution.idempotency_key = $2
      `,
      [`user:${actorUserId}`, blockIdempotencyKey],
    );

    expect(blockedState.rows[0]?.status).toBe("blocked");
    const activeSessionIds = new Set<string>([
      firstSessionId,
      secondSessionId,
    ]);

    expect(
      sessions.rows
        .filter((session) =>
          activeSessionIds.has(session.id),
        )
        .every((session) => session.revoked_at !== null),
    ).toBe(true);
    expect(
      sessions.rows.find(
        (session) => session.id === expiredSessionId,
      )?.revoked_at,
    ).toBeNull();
    expect(paidAccess.rows).toEqual([{ status: "granted" }]);
    expect(blockEvidence.rows).toEqual([
      {
        audit_count: 1,
        execution_count: 1,
      },
    ]);

    await expect(
      commandService.execute({
        context: context(actorUserId),
        targetUserId,
        statusAction: "unblock",
        reason: "security_check_completed",
        idempotencyKey: randomUUID(),
      }),
    ).resolves.toEqual({
      status: "active",
      statusChanged: true,
      revokedSessionCount: 0,
      currentSessionRevoked: false,
    });

    const restoredState = await pool.query<{
      active_session_count: number;
      status: IdentityUserStatus;
    }>(
      `
        SELECT
          users.status,
          count(sessions.id) FILTER (
            WHERE sessions.revoked_at IS NULL
              AND sessions.expires_at > now()
          )::integer AS active_session_count
        FROM identity_users users
        LEFT JOIN identity_sessions sessions
          ON sessions.user_id = users.id
        WHERE users.id = $1
        GROUP BY users.id
      `,
      [targetUserId],
    );

    expect(restoredState.rows).toEqual([
      {
        active_session_count: 0,
        status: "active",
      },
    ]);
    expect(paidAccess.rows).toEqual([{ status: "granted" }]);
  });

  it("при разблокировке отзывает старую живую сессию, но не затрагивает новую сессию уже активного ученика", async () => {
    const actorUserId = await insertUser(
      "Владелец безопасной разблокировки",
    );
    await insertOwnerRole(actorUserId);
    const targetUserId = await insertUser(
      "Заблокированный ученик со старой сессией",
      "blocked",
    );
    const staleSessionId = await insertSession(targetUserId);
    const commandService = service();

    await expect(
      commandService.execute({
        context: context(actorUserId),
        targetUserId,
        statusAction: "unblock",
        reason: "security_check_completed",
        idempotencyKey: randomUUID(),
      }),
    ).resolves.toEqual({
      status: "active",
      statusChanged: true,
      revokedSessionCount: 1,
      currentSessionRevoked: false,
    });

    const newSessionId = await insertSession(targetUserId);

    await expect(
      commandService.execute({
        context: context(actorUserId),
        targetUserId,
        statusAction: "unblock",
        reason: "support_correction",
        idempotencyKey: randomUUID(),
      }),
    ).resolves.toEqual({
      status: "active",
      statusChanged: false,
      revokedSessionCount: 0,
      currentSessionRevoked: false,
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
      [[staleSessionId, newSessionId]],
    );
    const state = new Map(
      sessions.rows.map((session) => [
        session.id,
        session.revoked_at,
      ]),
    );

    expect(state.get(staleSessionId)).toBeInstanceOf(Date);
    expect(state.get(newSessionId)).toBeNull();
  });

  it("не блокирует последнего доступного владельца и не отзывает его сессию", async () => {
    const restoreExistingOwners =
      await suspendExistingAvailableOwners();
    const ownerUserId = await insertUser(
      "Последний доступный владелец",
    );

    try {
      await insertOwnerRole(ownerUserId);
      const ownerSessionId = await insertSession(ownerUserId);
      const idempotencyKey = randomUUID();

      await expect(
        service().execute({
          context: context(ownerUserId, ownerSessionId),
          targetUserId: ownerUserId,
          statusAction: "block",
          reason: "support_security_measure",
          idempotencyKey,
        }),
      ).rejects.toMatchObject({
        code: "LAST_AVAILABLE_OWNER",
        httpStatus: 409,
      });

      const state = await pool.query<{
        audit_outcome: string;
        error_code: string;
        revoked_at: Date | null;
        status: IdentityUserStatus;
      }>(
        `
          SELECT
            users.status,
            sessions.revoked_at,
            audit.outcome AS audit_outcome,
            audit.error_code
          FROM identity_users users
          JOIN identity_sessions sessions
            ON sessions.id = $2
          JOIN admin_command_executions execution
            ON execution.principal_key = $3
            AND execution.action = 'identity.user.block'
            AND execution.idempotency_key = $4
          JOIN admin_audit_events audit
            ON audit.command_execution_id = execution.id
          WHERE users.id = $1
        `,
        [
          ownerUserId,
          ownerSessionId,
          `user:${ownerUserId}`,
          idempotencyKey,
        ],
      );

      expect(state.rows).toEqual([
        {
          audit_outcome: "rejected",
          error_code: "LAST_AVAILABLE_OWNER",
          revoked_at: null,
          status: "active",
        },
      ]);
    } finally {
      await pool.query(
        `
          UPDATE identity_users
          SET status = 'blocked', updated_at = now()
          WHERE id = $1
        `,
        [ownerUserId],
      );
      await restoreExistingOwners();
    }
  });

  it("разрешает владельцу заблокировать себя при наличии второго доступного владельца", async () => {
    const restoreExistingOwners =
      await suspendExistingAvailableOwners();
    const selfOwnerId = await insertUser(
      "Самоблокируемый владелец",
    );
    const backupOwnerId = await insertUser(
      "Резервный доступный владелец",
    );

    try {
      await insertOwnerRole(selfOwnerId);
      await insertOwnerRole(backupOwnerId);
      const selfSessionId = await insertSession(selfOwnerId);

      await expect(
        service().execute({
          context: context(selfOwnerId, selfSessionId),
          targetUserId: selfOwnerId,
          statusAction: "block",
          reason: "support_security_measure",
          idempotencyKey: randomUUID(),
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        currentSessionRevoked: true,
        revokedSessionCount: 1,
      });

      const state = await pool.query<{
        backup_status: IdentityUserStatus;
        revoked_at: Date | null;
        self_status: IdentityUserStatus;
      }>(
        `
          SELECT
            self_user.status AS self_status,
            backup_user.status AS backup_status,
            self_session.revoked_at
          FROM identity_users self_user
          JOIN identity_users backup_user
            ON backup_user.id = $2
          JOIN identity_sessions self_session
            ON self_session.id = $3
          WHERE self_user.id = $1
        `,
        [selfOwnerId, backupOwnerId, selfSessionId],
      );

      expect(state.rows).toEqual([
        {
          backup_status: "active",
          revoked_at: expect.any(Date),
          self_status: "blocked",
        },
      ]);
    } finally {
      await pool.query(
        `
          UPDATE identity_users
          SET status = 'blocked', updated_at = now()
          WHERE id = ANY($1::uuid[])
        `,
        [[selfOwnerId, backupOwnerId]],
      );
      await restoreExistingOwners();
    }
  });

  it("разделяет одинаковый idempotency key между блокировкой и разблокировкой", async () => {
    const actorUserId = await insertUser(
      "Владелец независимых действий",
    );
    await insertOwnerRole(actorUserId);
    const targetUserId = await insertUser(
      "Ученик независимых действий",
    );
    const idempotencyKey = randomUUID();
    const commandService = service();
    const blockInput = {
      context: context(actorUserId),
      targetUserId,
      statusAction: "block",
      reason: "support_security_measure",
      idempotencyKey,
    } as const;
    const unblockInput = {
      context: context(actorUserId),
      targetUserId,
      statusAction: "unblock",
      reason: "security_check_completed",
      idempotencyKey,
    } as const;

    await expect(commandService.execute(blockInput)).resolves.toEqual({
      status: "blocked",
      statusChanged: true,
      revokedSessionCount: 0,
      currentSessionRevoked: false,
    });
    await expect(commandService.execute(unblockInput)).resolves.toEqual({
      status: "active",
      statusChanged: true,
      revokedSessionCount: 0,
      currentSessionRevoked: false,
    });
    await expect(commandService.execute(blockInput)).resolves.toEqual({
      status: "blocked",
      statusChanged: true,
      revokedSessionCount: 0,
      currentSessionRevoked: false,
    });

    const executions = await pool.query<{
      action: string;
      count: number;
    }>(
      `
        SELECT action, count(*)::integer AS count
        FROM admin_command_executions
        WHERE principal_key = $1
          AND idempotency_key = $2
        GROUP BY action
        ORDER BY action
      `,
      [`user:${actorUserId}`, idempotencyKey],
    );
    const target = await pool.query<{ status: string }>(
      `
        SELECT status
        FROM identity_users
        WHERE id = $1
      `,
      [targetUserId],
    );

    expect(executions.rows).toEqual([
      { action: "identity.user.block", count: 1 },
      { action: "identity.user.unblock", count: 1 },
    ]);
    expect(target.rows).toEqual([{ status: "active" }]);
  });

  it("сериализует взаимную блокировку двух владельцев и сохраняет одного доступного", async () => {
    const restoreExistingOwners =
      await suspendExistingAvailableOwners();
    const firstOwnerId = await insertUser(
      "Первый конкурентный владелец",
    );
    const secondOwnerId = await insertUser(
      "Второй конкурентный владелец",
    );

    try {
      await insertOwnerRole(firstOwnerId);
      await insertOwnerRole(secondOwnerId);
      await insertSession(firstOwnerId);
      await insertSession(secondOwnerId);
      const commandService = service();
      const results = await Promise.allSettled([
        commandService.execute({
          context: context(firstOwnerId),
          targetUserId: secondOwnerId,
          statusAction: "block",
          reason: "support_security_measure",
          idempotencyKey: randomUUID(),
        }),
        commandService.execute({
          context: context(secondOwnerId),
          targetUserId: firstOwnerId,
          statusAction: "block",
          reason: "support_security_measure",
          idempotencyKey: randomUUID(),
        }),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result) => result.status === "rejected",
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: {
          code: "LAST_AVAILABLE_OWNER",
        },
      });

      const ownerState = await pool.query<{
        available_owner_count: number;
        blocked_owner_count: number;
      }>(
        `
          SELECT
            count(*) FILTER (
              WHERE users.status = 'active'
            )::integer AS available_owner_count,
            count(*) FILTER (
              WHERE users.status = 'blocked'
            )::integer AS blocked_owner_count
          FROM identity_users users
          JOIN admin_role_assignments assignments
            ON assignments.user_id = users.id
          WHERE users.id = ANY($1::uuid[])
            AND assignments.role = 'owner'
            AND assignments.status = 'active'
        `,
        [[firstOwnerId, secondOwnerId]],
      );

      expect(ownerState.rows).toEqual([
        {
          available_owner_count: 1,
          blocked_owner_count: 1,
        },
      ]);
    } finally {
      await pool.query(
        `
          UPDATE identity_users
          SET status = 'blocked', updated_at = now()
          WHERE id = ANY($1::uuid[])
        `,
        [[firstOwnerId, secondOwnerId]],
      );
      await restoreExistingOwners();
    }
  });

  it("фиксирует время блокировки после получения user lock", async () => {
    const actorUserId = await insertUser(
      "Владелец хронологии блокировки",
    );
    await insertOwnerRole(actorUserId);
    const targetUserId = await insertUser(
      "Ученик хронологии блокировки",
    );
    const targetMethod =
      await insertTelegramMethod(targetUserId);
    const baseStatusRepository =
      new PostgresIdentityAdministrationRepository();
    let releaseBeforeUserLock: () => void = () => undefined;
    let reportBeforeUserLock: () => void = () => undefined;
    const beforeUserLock = new Promise<void>((resolve) => {
      reportBeforeUserLock = resolve;
    });
    const continueStatusChange = new Promise<void>((resolve) => {
      releaseBeforeUserLock = resolve;
    });
    const pausingStatusRepository: IdentityUserStatusAdministrationRepository =
      {
        async lockUsersForStatusChange(
          client,
          input,
        ): Promise<LockedIdentityUserStatus> {
          reportBeforeUserLock();
          await continueStatusChange;
          return baseStatusRepository.lockUsersForStatusChange(
            client,
            input,
          );
        },
        async applyUserStatusChange(
          client,
          input,
        ): Promise<ApplyIdentityUserStatusResult> {
          return baseStatusRepository.applyUserStatusChange(
            client,
            input,
          );
        },
      };
    const commandPromise = service(
      pausingStatusRepository,
    ).execute({
      context: context(actorUserId),
      targetUserId,
      statusAction: "block",
      reason: "support_security_measure",
      idempotencyKey: randomUUID(),
    });

    try {
      await beforeUserLock;
      const identityRepository =
        new PostgresIdentityRepository(pool);

      await expect(
        identityRepository.createSession({
          userId: targetUserId,
          tokenSha256: createHash("sha256")
            .update(randomUUID())
            .digest("hex"),
          expiresAt: new Date(Date.now() + 86_400_000),
          authenticatedAt: new Date(),
          authenticationMethod: "telegram_oidc",
          authenticationMethodId: targetMethod.id,
        }),
      ).resolves.toBe(true);
      releaseBeforeUserLock();

      await expect(commandPromise).resolves.toMatchObject({
        status: "blocked",
        revokedSessionCount: 1,
      });

      const chronology = await pool.query<{
        created_at: Date;
        revoked_at: Date;
        updated_at: Date;
      }>(
        `
          SELECT
            sessions.created_at,
            sessions.revoked_at,
            users.updated_at
          FROM identity_sessions sessions
          JOIN identity_users users
            ON users.id = sessions.user_id
          WHERE sessions.user_id = $1
        `,
        [targetUserId],
      );
      const state = chronology.rows[0];

      if (!state) {
        throw new Error(
          "Состояние сессии после блокировки не найдено.",
        );
      }

      expect(state.revoked_at).toBeInstanceOf(Date);
      expect(state.updated_at).toBeInstanceOf(Date);
      expect(
        state.revoked_at.getTime(),
      ).toBeGreaterThanOrEqual(state.created_at.getTime());
      expect(
        state.updated_at.getTime(),
      ).toBeGreaterThanOrEqual(state.created_at.getTime());
    } finally {
      releaseBeforeUserLock();
      await commandPromise.catch(() => undefined);
    }
  });

  it("не создаёт сессию, ожидавшую завершения блокировки", async () => {
    const actorUserId = await insertUser(
      "Владелец гонки блокировки",
    );
    await insertOwnerRole(actorUserId);
    const targetUserId = await insertUser(
      "Ученик гонки блокировки",
    );
    const targetMethod =
      await insertTelegramMethod(targetUserId);
    await insertSession(targetUserId);
    const baseStatusRepository =
      new PostgresIdentityAdministrationRepository();
    let releaseStatusLock: () => void = () => undefined;
    let reportStatusLocked: () => void = () => undefined;
    const statusLocked = new Promise<void>((resolve) => {
      reportStatusLocked = resolve;
    });
    const continueStatusChange = new Promise<void>((resolve) => {
      releaseStatusLock = resolve;
    });
    const pausingStatusRepository: IdentityUserStatusAdministrationRepository =
      {
        async lockUsersForStatusChange(
          client,
          input,
        ): Promise<LockedIdentityUserStatus> {
          const result =
            await baseStatusRepository.lockUsersForStatusChange(
              client,
              input,
            );

          reportStatusLocked();
          await continueStatusChange;
          return result;
        },
        async applyUserStatusChange(
          client,
          input,
        ): Promise<ApplyIdentityUserStatusResult> {
          return baseStatusRepository.applyUserStatusChange(
            client,
            input,
          );
        },
      };
    const commandPromise = service(
      pausingStatusRepository,
    ).execute({
      context: context(actorUserId),
      targetUserId,
      statusAction: "block",
      reason: "support_security_measure",
      idempotencyKey: randomUUID(),
    });

    await statusLocked;

    const loginApplicationName = `academy-login-${randomUUID()}`;
    const loginPool = new Pool({
      connectionString: testDatabaseUrl,
      application_name: loginApplicationName,
      max: 1,
    });
    const identityRepository =
      new PostgresIdentityRepository(loginPool);
    const createSessionPromise = identityRepository.createSession({
      userId: targetUserId,
      tokenSha256: createHash("sha256")
        .update(randomUUID())
        .digest("hex"),
      expiresAt: new Date(Date.now() + 86_400_000),
      authenticatedAt: new Date(),
      authenticationMethod: "telegram_oidc",
      authenticationMethodId: targetMethod.id,
    });

    try {
      await waitForBlockedQuery(
        loginApplicationName,
        "SELECT status",
      );
      releaseStatusLock();

      await expect(commandPromise).resolves.toMatchObject({
        status: "blocked",
        revokedSessionCount: 1,
      });
      await expect(createSessionPromise).resolves.toBe(false);
      await expect(
        identityRepository.upsertIdentity({
          methodType: "telegram",
          identifier: targetMethod.identifier,
          displayName: "Изменённое имя заблокированного ученика",
          metadata: {
            username: "blocked_user_should_not_update",
          },
          consent: {
            acceptedAt: new Date().toISOString(),
            documentVersion: "integration",
            source: "integration-test",
          },
        }),
      ).rejects.toMatchObject({
        code: "INVALID_LOGIN",
        httpStatus: 403,
      });

      const state = await pool.query<{
        active_session_count: number;
        display_name: string;
        metadata: Record<string, unknown>;
        status: IdentityUserStatus;
      }>(
        `
          SELECT
            users.status,
            users.display_name,
            methods.metadata,
            count(sessions.id) FILTER (
              WHERE sessions.revoked_at IS NULL
                AND sessions.expires_at > now()
            )::integer AS active_session_count
          FROM identity_users users
          LEFT JOIN identity_sessions sessions
            ON sessions.user_id = users.id
          JOIN identity_methods methods
            ON methods.id = $2
          WHERE users.id = $1
          GROUP BY users.id, methods.id
        `,
        [targetUserId, targetMethod.id],
      );

      expect(state.rows).toEqual([
        {
          active_session_count: 0,
          display_name: "Ученик гонки блокировки",
          metadata: {},
          status: "blocked",
        },
      ]);
    } finally {
      releaseStatusLock();
      await loginPool.end();
    }
  });
});
