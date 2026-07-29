import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { AdministrationService } from "@/modules/administration/application/administration-service";
import { PostgresAdministrationRepository } from "@/modules/administration/infrastructure/postgres-administration-repository";
import {
  hashIdentityToken,
  IdentityService,
} from "@/modules/identity/application/identity-service";
import { PostgresIdentityRepository } from "@/modules/identity/infrastructure/postgres-identity-repository";

const executeFile = promisify(execFile);
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const consent = {
  acceptedAt: "2026-07-29T08:00:00.000Z",
  documentVersion: "2026-07-28",
  source: "administration-integration-test",
};

async function runBootstrap(input: {
  userId: string;
  reason: string;
  idempotencyKey: string;
}) {
  return executeFile(
    process.execPath,
    [
      "scripts/academy-admin.mjs",
      "grant",
      "--user-id",
      input.userId,
      "--role",
      "owner",
      "--reason",
      input.reason,
      "--idempotency-key",
      input.idempotencyKey,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
      },
    },
  );
}

function bootstrapRequestSha256(input: {
  userId: string;
  reason: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: "admin.role.bootstrap_grant",
        reason: input.reason,
        role: "owner",
        userId: input.userId,
      }),
    )
    .digest("hex");
}

async function ensureActiveOwner(pool: Pool) {
  const existing = await pool.query<{ user_id: string }>(
    `
      SELECT assignment.user_id
      FROM admin_role_assignments AS assignment
      INNER JOIN identity_users AS identity_user
        ON identity_user.id = assignment.user_id
      WHERE assignment.role = 'owner'
        AND assignment.status = 'active'
        AND identity_user.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM identity_methods AS identity_method
          WHERE identity_method.user_id = assignment.user_id
            AND identity_method.method_type = 'telegram'
            AND NOT (
              identity_method.metadata @> '{"demo": true}'::jsonb
            )
        )
      ORDER BY assignment.granted_at, assignment.id
      LIMIT 1
    `,
  );

  if (existing.rows[0]) {
    return existing.rows[0].user_id;
  }

  const identityRepository = new PostgresIdentityRepository(pool);
  const identity = await identityRepository.upsertIdentity({
    methodType: "telegram",
    identifier: `admin-owner-helper-${randomUUID()}`,
    displayName: "Владелец для независимого теста",
    metadata: {},
    consent,
  });

  await runBootstrap({
    userId: identity.id,
    reason: "Подготовка владельца для независимого теста",
    idempotencyKey: randomUUID(),
  });

  return identity.id;
}

describe("Administration с PostgreSQL", () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    application_name: "academy-administration-integration-tests",
    max: 4,
  });

  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("не назначает первым owner пользователя без Telegram", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const emailOnlyUser = await identityRepository.upsertIdentity({
      methodType: "email",
      identifier: "email-only-owner@example.test",
      displayName: "Пользователь только с email",
      metadata: {},
      consent,
    });

    await expect(
      runBootstrap({
        userId: emailOnlyUser.id,
        reason:
          "Проверка запрета назначения владельца без Telegram",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining(
        "ACTIVE_TELEGRAM_METHOD_REQUIRED",
      ),
    });

    const persisted = await pool.query<{
      assignments: string;
      status: string;
      error_code: string;
      audit_events: string;
    }>(
      `
        SELECT
          (
            SELECT count(*)::text
            FROM admin_role_assignments
            WHERE user_id = $1
              AND role = 'owner'
              AND status = 'active'
          ) AS assignments,
          execution.status,
          execution.error_code,
          (
            SELECT count(*)::text
            FROM admin_audit_events
            WHERE command_execution_id = execution.id
          ) AS audit_events
        FROM admin_command_executions AS execution
        WHERE execution.target_id = $1::text
        ORDER BY execution.created_at DESC
        LIMIT 1
      `,
      [emailOnlyUser.id],
    );

    expect(persisted.rows[0]).toEqual({
      assignments: "0",
      status: "rejected",
      error_code: "ACTIVE_TELEGRAM_METHOD_REQUIRED",
      audit_events: "1",
    });
  });

  it("не назначает первым owner пользователя с demo-входом", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityService = new IdentityService(
      identityRepository,
      30,
    );
    const demoSession = await identityService.authenticateIdentity({
      authenticationMethod: "demo",
      methodType: "telegram",
      identifier: `demo-owner-${randomUUID()}`,
      displayName: "Демо-владелец",
      metadata: {
        demo: true,
        username: "demo_owner",
      },
      consent,
      userAgentFamily: "Google Chrome",
    });
    const idempotencyKey = randomUUID();

    await expect(
      runBootstrap({
        userId: demoSession.user.id,
        reason:
          "Проверка запрета назначения владельца с демо-входом",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining(
        "ACTIVE_TELEGRAM_METHOD_REQUIRED",
      ),
    });

    const persisted = await pool.query<{
      assignments: string;
      status: string;
      error_code: string;
      audit_events: string;
    }>(
      `
        SELECT
          (
            SELECT count(*)::text
            FROM admin_role_assignments
            WHERE user_id = $1
              AND role = 'owner'
              AND status = 'active'
          ) AS assignments,
          execution.status,
          execution.error_code,
          (
            SELECT count(*)::text
            FROM admin_audit_events
            WHERE command_execution_id = execution.id
          ) AS audit_events
        FROM admin_command_executions AS execution
        WHERE execution.principal_key = 'system:bootstrap'
          AND execution.action = 'admin.role.bootstrap_grant'
          AND execution.idempotency_key = $2
      `,
      [demoSession.user.id, idempotencyKey],
    );

    expect(persisted.rows[0]).toEqual({
      assignments: "0",
      status: "rejected",
      error_code: "ACTIVE_TELEGRAM_METHOD_REQUIRED",
      audit_events: "1",
    });
  });

  it("отклоняет пустую после нормализации причину", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identity = await identityRepository.upsertIdentity({
      methodType: "email",
      identifier: `blank-reason-${randomUUID()}@example.test`,
      displayName: "Проверка пустой причины",
      metadata: {},
      consent,
    });

    await expect(
      runBootstrap({
        userId: identity.id,
        reason: "              ",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("INVALID_REASON"),
    });

    await expect(
      pool.query(
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
            'support',
            'active',
            NULL,
            'system',
            '              '
          )
        `,
        [randomUUID(), identity.id],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });

    await expect(
      pool.query(
        `
          INSERT INTO admin_audit_events (
            id,
            request_id,
            actor_kind,
            actor_user_id,
            action,
            target_type,
            target_id,
            reason,
            outcome
          )
          VALUES (
            $1,
            $2,
            'system',
            NULL,
            'admin.blank_reason.test',
            'identity_user',
            $3,
            '              ',
            'succeeded'
          )
        `,
        [randomUUID(), randomUUID(), identity.id],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("назначает первого owner идемпотентно и пишет неизменяемый аудит", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityService = new IdentityService(
      identityRepository,
      30,
    );
    const telegramIdentifier =
      "admin-integration-owner-telegram";
    const ordinarySession =
      await identityService.authenticateIdentity({
        authenticationMethod: "telegram_oidc",
        methodType: "telegram",
        identifier: telegramIdentifier,
        displayName: "Владелец интеграционного теста",
        receiptEmail: "owner-admin@example.test",
        metadata: {
          username: "owner_admin_integration",
        },
        consent,
        userAgentFamily: "Google Chrome",
      });
    const idempotencyKey = randomUUID();
    const reason = "Первичное назначение владельца в integration";
    const first = await runBootstrap({
      userId: ordinarySession.user.id.toUpperCase(),
      reason,
      idempotencyKey,
    });
    const repeated = await runBootstrap({
      userId: ordinarySession.user.id,
      reason,
      idempotencyKey,
    });

    expect(first.stdout).toContain("Первый владелец назначен.");
    expect(repeated.stdout).toContain(
      "Команда уже была успешно выполнена.",
    );
    expect(first.stdout).not.toContain("owner-admin@example.test");
    expect(first.stdout).not.toContain(telegramIdentifier);

    const persisted = await pool.query<{
      assignments: string;
      executions: string;
      audit_events: string;
    }>(
      `
        SELECT
          (
            SELECT count(*)::text
            FROM admin_role_assignments
            WHERE user_id = $1::uuid
              AND role = 'owner'
              AND status = 'active'
          ) AS assignments,
          (
            SELECT count(*)::text
            FROM admin_command_executions
            WHERE target_id = $1::text
              AND action = 'admin.role.bootstrap_grant'
          ) AS executions,
          (
            SELECT count(*)::text
            FROM admin_audit_events
            WHERE target_id = $1::text
              AND action = 'admin.role.bootstrap_grant'
          ) AS audit_events
      `,
      [ordinarySession.user.id],
    );

    expect(persisted.rows[0]).toEqual({
      assignments: "1",
      executions: "1",
      audit_events: "1",
    });

    const administrationRepository =
      new PostgresAdministrationRepository(pool);
    const administrationService = new AdministrationService(
      administrationRepository,
      {
        enabled: true,
        sessionTtlDays: 30,
      },
    );
    const ordinaryTokenSha256 = hashIdentityToken(
      ordinarySession.token,
    );

    await expect(
      administrationService.getContext({
        tokenSha256: ordinaryTokenSha256,
        permission: "admin.enter",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_REAUTH_REQUIRED",
    });

    const verification =
      await administrationService.prepareTelegramVerification({
        tokenSha256: ordinaryTokenSha256,
      });

    await expect(
      administrationService.confirmTelegramVerification({
        currentTokenSha256: ordinaryTokenSha256,
        expectedSessionId: verification.sessionId,
        expectedUserId: verification.userId,
        telegramIdentifier: "different-telegram-subject",
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_VERIFICATION_REJECTED",
    });

    await expect(
      identityRepository.findUserBySessionTokenSha256(
        ordinaryTokenSha256,
      ),
    ).resolves.toMatchObject({
      id: ordinarySession.user.id,
    });

    const adminSession =
      await administrationService.confirmTelegramVerification({
        currentTokenSha256: ordinaryTokenSha256,
        expectedSessionId: verification.sessionId,
        expectedUserId: verification.userId,
        telegramIdentifier,
        userAgentFamily: "Google Chrome",
      });
    const context = await administrationService.getContext({
      tokenSha256: hashIdentityToken(adminSession.token),
      permission: "dashboard.read",
      requestId: randomUUID(),
    });

    expect(context).toMatchObject({
      actor: {
        id: ordinarySession.user.id,
      },
      roles: ["owner"],
      adminVerificationMethod: "telegram_oidc",
    });
    expect(context.permissions.has("roles.write")).toBe(true);
    await expect(
      identityRepository.findUserBySessionTokenSha256(
        ordinaryTokenSha256,
      ),
    ).resolves.toBeNull();

    const sessionMetadata = await pool.query<{
      authentication_method: string;
      authentication_method_id: string;
      admin_verification_method: string;
      admin_break_glass_expires_at: Date | null;
      user_agent_family: string;
    }>(
      `
        SELECT
          authentication_method,
          authentication_method_id,
          admin_verification_method,
          admin_break_glass_expires_at,
          user_agent_family
        FROM identity_sessions
        WHERE token_sha256 = $1
      `,
      [hashIdentityToken(adminSession.token)],
    );

    expect(sessionMetadata.rows[0]).toMatchObject({
      authentication_method: "telegram_oidc",
      authentication_method_id:
        ordinarySession.user.primaryMethod.id,
      admin_verification_method: "telegram_oidc",
      admin_break_glass_expires_at: null,
      user_agent_family: "Google Chrome",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_audit_events
          SET action = 'tampered'
          WHERE target_id = $1
        `,
        [ordinarySession.user.id],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await pool.query(
      `
        UPDATE identity_users
        SET status = 'blocked'
        WHERE id = $1
      `,
      [ordinarySession.user.id],
    );

    try {
      await expect(
        administrationService.getContext({
          tokenSha256: hashIdentityToken(adminSession.token),
          permission: "admin.enter",
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        code: "ADMIN_AUTH_REQUIRED",
      });
    } finally {
      await pool.query(
        `
          UPDATE identity_users
          SET status = 'active'
          WHERE id = $1
        `,
        [ordinarySession.user.id],
      );
    }
  });

  it("не позволяет изменить или удалить завершённую команду", async () => {
    const executionId = randomUUID();

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
          result_status,
          result,
          completed_at
        )
        VALUES (
          $1,
          'system:terminal-test',
          NULL,
          'admin.terminal.test',
          $2,
          $3,
          'identity_user',
          'terminal-test',
          'internal',
          'succeeded',
          200,
          '{}'::jsonb,
          now()
        )
      `,
      [executionId, randomUUID(), "c".repeat(64)],
    );

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET result_status = 201
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          DELETE FROM admin_command_executions
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });
  });

  it("фиксирует идентичность незавершённой команды", async () => {
    const executionId = randomUUID();

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
        VALUES (
          $1,
          'system:mutable-test',
          NULL,
          'admin.mutable.test',
          $2,
          $3,
          'identity_user',
          'original-target',
          'internal',
          'in_progress',
          now() + interval '5 minutes',
          1
        )
      `,
      [executionId, randomUUID(), "d".repeat(64)],
    );

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET target_id = 'tampered-target'
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET request_sha256 = $2
          WHERE id = $1
        `,
        [executionId, "e".repeat(64)],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET
            lease_expires_at = now() + interval '10 minutes',
            attempt_count = attempt_count + 1,
            updated_at = now()
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await pool.query(
      `
        UPDATE admin_command_executions
        SET
          lease_expires_at = now() - interval '1 second',
          updated_at = now()
        WHERE id = $1
      `,
      [executionId],
    );

    await pool.query(
      `
        UPDATE admin_command_executions
        SET
          lease_expires_at = now() + interval '10 minutes',
          attempt_count = attempt_count + 1,
          updated_at = now()
        WHERE id = $1
      `,
      [executionId],
    );

    const active = await pool.query<{
      target_id: string;
      request_sha256: string;
      attempt_count: number;
    }>(
      `
        SELECT target_id, request_sha256, attempt_count
        FROM admin_command_executions
        WHERE id = $1
      `,
      [executionId],
    );

    expect(active.rows[0]).toEqual({
      target_id: "original-target",
      request_sha256: "d".repeat(64),
      attempt_count: 2,
    });

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET attempt_count = attempt_count - 1
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET attempt_count = attempt_count + 2
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET updated_at = created_at - interval '1 second'
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_command_executions
          SET
            status = 'failed',
            result_status = 500,
            result = '{}'::jsonb,
            error_code = 'INVALID_TEST_CHRONOLOGY',
            lease_expires_at = NULL,
            completed_at = updated_at,
            updated_at = updated_at + interval '1 second'
          WHERE id = $1
        `,
        [executionId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });

    await pool.query(
      `
        UPDATE admin_command_executions
        SET
          status = 'failed',
          result_status = 500,
          result = '{}'::jsonb,
          error_code = 'EXPECTED_TEST_FAILURE',
          lease_expires_at = NULL,
          completed_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [executionId],
    );
  });

  it("сохраняет историю назначения и отзыва роли", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identity = await identityRepository.upsertIdentity({
      methodType: "email",
      identifier: `role-history-${randomUUID()}@example.test`,
      displayName: "Проверка истории роли",
      metadata: {},
      consent,
    });
    const assignmentId = randomUUID();

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
          'support',
          'active',
          NULL,
          'system',
          'Назначение для проверки неизменяемой истории'
        )
      `,
      [assignmentId, identity.id],
    );

    await expect(
      pool.query(
        `
          UPDATE admin_role_assignments
          SET role = 'finance'
          WHERE id = $1
        `,
        [assignmentId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_role_assignments
          SET grant_reason = 'Подменённая причина назначения роли'
          WHERE id = $1
        `,
        [assignmentId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });

    await expect(
      pool.query(
        `
          UPDATE admin_role_assignments
          SET
            status = 'revoked',
            revoke_reason = 'Некорректный отзыв раньше назначения роли',
            revoked_at = granted_at - interval '1 second'
          WHERE id = $1
        `,
        [assignmentId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });

    await pool.query(
      `
        UPDATE admin_role_assignments
        SET
          status = 'revoked',
          revoke_reason = 'Штатный отзыв тестового назначения роли',
          revoked_at = now()
        WHERE id = $1
      `,
      [assignmentId],
    );

    await expect(
      pool.query(
        `
          UPDATE admin_role_assignments
          SET
            status = 'active',
            revoke_reason = NULL,
            revoked_at = NULL
          WHERE id = $1
        `,
        [assignmentId],
      ),
    ).rejects.toMatchObject({
      code: "55000",
    });
  });

  it("не повышает совместимую legacy-сессию и сохраняет ученический вход", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identity = await identityRepository.upsertIdentity({
      methodType: "telegram",
      identifier: "admin-integration-legacy",
      displayName: "Legacy пользователь",
      metadata: {},
      consent,
    });
    const legacyTokenSha256 = "9".repeat(64);

    await pool.query(
      `
        INSERT INTO identity_sessions (
          id,
          user_id,
          token_sha256,
          expires_at
        )
        VALUES ($1, $2, $3, now() + interval '1 day')
      `,
      [randomUUID(), identity.id, legacyTokenSha256],
    );
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
          'Тестовая роль для проверки legacy-сессии'
        )
      `,
      [randomUUID(), identity.id],
    );

    await expect(
      identityRepository.findUserBySessionTokenSha256(
        legacyTokenSha256,
      ),
    ).resolves.toMatchObject({
      id: identity.id,
    });

    const administrationService = new AdministrationService(
      new PostgresAdministrationRepository(pool),
      {
        enabled: true,
        sessionTtlDays: 30,
      },
    );

    await expect(
      administrationService.prepareTelegramVerification({
        tokenSha256: legacyTokenSha256,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_LOGIN_REQUIRED",
    });

    await expect(
      pool.query(
        `
          INSERT INTO identity_sessions (
            id,
            user_id,
            token_sha256,
            expires_at,
            authenticated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            now() + interval '1 day',
            now()
          )
        `,
        [randomUUID(), identity.id, "8".repeat(64)],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });

    await expect(
      pool.query(
        `
          INSERT INTO identity_sessions (
            id,
            user_id,
            token_sha256,
            expires_at,
            authenticated_at,
            authentication_method,
            authentication_method_id,
            admin_verified_at
          )
          VALUES (
            $1,
            $2,
            $3,
            now() + interval '1 day',
            now(),
            'telegram_oidc',
            $4,
            now()
          )
        `,
        [
          randomUUID(),
          identity.id,
          "7".repeat(64),
          identity.primaryMethod.id,
        ],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });

    await expect(
      pool.query(
        `
          INSERT INTO identity_sessions (
            id,
            user_id,
            token_sha256,
            expires_at,
            authenticated_at,
            authentication_method,
            authentication_method_id,
            admin_verified_at,
            admin_verification_method
          )
          VALUES (
            $1,
            $2,
            $3,
            now() + interval '1 day',
            now(),
            'telegram_oidc',
            $4,
            now(),
            'break_glass'
          )
        `,
        [
          randomUUID(),
          identity.id,
          "6".repeat(64),
          identity.primaryMethod.id,
        ],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("связывает ключ идемпотентности с точным запросом", async () => {
    const ownerUserId = await ensureActiveOwner(pool);
    const idempotencyKey = randomUUID();
    const reason = "Первое точное назначение для проверки ключа";

    const first = await runBootstrap({
      userId: ownerUserId,
      reason: `  ${reason}  `,
      idempotencyKey,
    });
    const repeated = await runBootstrap({
      userId: ownerUserId,
      reason,
      idempotencyKey,
    });

    expect(first.stdout).toContain(
      "Активная роль владельца уже существовала.",
    );
    expect(repeated.stdout).toContain(
      "Команда уже была успешно выполнена.",
    );

    const persistedReason = await pool.query<{ reason: string }>(
      `
        SELECT audit_event.reason
        FROM admin_audit_events AS audit_event
        INNER JOIN admin_command_executions AS execution
          ON execution.id = audit_event.command_execution_id
        WHERE execution.principal_key = 'system:bootstrap'
          AND execution.action = 'admin.role.bootstrap_grant'
          AND execution.idempotency_key = $1
      `,
      [idempotencyKey],
    );

    expect(persistedReason.rows[0]?.reason).toBe(reason);

    await expect(
      runBootstrap({
        userId: ownerUserId,
        reason: "Изменённая причина с тем же ключом команды",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining("IDEMPOTENCY_CONFLICT"),
    });
  });

  it("не захватывает команду с действующим lease", async () => {
    const ownerUserId = await ensureActiveOwner(pool);
    const idempotencyKey = randomUUID();
    const reason = "Проверка запрета захвата действующего lease";
    const requestSha256 = bootstrapRequestSha256({
      userId: ownerUserId,
      reason,
    });
    const executionId = randomUUID();

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
        VALUES (
          $1,
          'system:bootstrap',
          NULL,
          'admin.role.bootstrap_grant',
          $2,
          $3,
          'identity_user',
          $4,
          'internal',
          'in_progress',
          now() + interval '5 minutes',
          1
        )
      `,
      [
        executionId,
        idempotencyKey,
        requestSha256,
        ownerUserId,
      ],
    );

    await expect(
      runBootstrap({
        userId: ownerUserId,
        reason,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining("COMMAND_IN_PROGRESS"),
    });

    const persisted = await pool.query<{
      status: string;
      attempt_count: number;
      lease_is_live: boolean;
    }>(
      `
        SELECT
          status,
          attempt_count,
          lease_expires_at > statement_timestamp() AS lease_is_live
        FROM admin_command_executions
        WHERE id = $1
      `,
      [executionId],
    );

    expect(persisted.rows[0]).toEqual({
      status: "in_progress",
      attempt_count: 1,
      lease_is_live: true,
    });
  });

  it("безопасно продолжает команду после истечения lease", async () => {
    const ownerUserId = await ensureActiveOwner(pool);
    const idempotencyKey = randomUUID();
    const reason =
      "Восстановление назначения владельца после истечения lease";
    const requestSha256 = bootstrapRequestSha256({
      userId: ownerUserId,
      reason,
    });
    const executionId = randomUUID();

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
        VALUES (
          $1,
          'system:bootstrap',
          NULL,
          'admin.role.bootstrap_grant',
          $2,
          $3,
          'identity_user',
          $4,
          'internal',
          'in_progress',
          now() - interval '1 minute',
          1
        )
      `,
      [
        executionId,
        idempotencyKey,
        requestSha256,
        ownerUserId,
      ],
    );

    const recovered = await runBootstrap({
      userId: ownerUserId,
      reason,
      idempotencyKey,
    });

    expect(recovered.stdout).toContain(
      "Активная роль владельца уже существовала.",
    );

    const persisted = await pool.query<{
      status: string;
      attempt_count: number;
      audit_events: string;
    }>(
      `
        SELECT
          execution.status,
          execution.attempt_count,
          (
            SELECT count(*)::text
            FROM admin_audit_events
            WHERE command_execution_id = execution.id
          ) AS audit_events
        FROM admin_command_executions AS execution
        WHERE execution.id = $1
      `,
      [executionId],
    );

    expect(persisted.rows[0]).toEqual({
      status: "succeeded",
      attempt_count: 2,
      audit_events: "1",
    });
  });

  it("сигнализирует о невозможности записать неудачную попытку", async () => {
    const ownerUserId = await ensureActiveOwner(pool);
    const idempotencyKey = randomUUID();
    const reason =
      "Проверка безопасного сигнала при недоступном аудите";

    await pool.query(
      `
        DROP TRIGGER IF EXISTS
          test_reject_admin_audit_insert
          ON admin_audit_events
      `,
    );
    await pool.query(
      `
        CREATE OR REPLACE FUNCTION
          test_reject_admin_audit_insert()
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
        CREATE TRIGGER test_reject_admin_audit_insert
        BEFORE INSERT ON admin_audit_events
        FOR EACH ROW
        EXECUTE FUNCTION test_reject_admin_audit_insert()
      `,
    );

    try {
      await expect(
        runBootstrap({
          userId: ownerUserId,
          reason,
          idempotencyKey,
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringMatching(
          /administration\.failed_attempt_persistence_failed[\s\S]*admin_audit_write_failed_total/u,
        ),
      });
    } finally {
      await pool.query(
        `
          DROP TRIGGER IF EXISTS
            test_reject_admin_audit_insert
            ON admin_audit_events
        `,
      );
      await pool.query(
        `
          DROP FUNCTION IF EXISTS
            test_reject_admin_audit_insert()
        `,
      );
    }

    const persisted = await pool.query<{
      status: string;
      audit_events: string;
    }>(
      `
        SELECT
          execution.status,
          (
            SELECT count(*)::text
            FROM admin_audit_events
            WHERE command_execution_id = execution.id
          ) AS audit_events
        FROM admin_command_executions AS execution
        WHERE execution.principal_key = 'system:bootstrap'
          AND execution.action = 'admin.role.bootstrap_grant'
          AND execution.idempotency_key = $1
      `,
      [idempotencyKey],
    );

    expect(persisted.rows[0]).toEqual({
      status: "in_progress",
      audit_events: "0",
    });
  });

  it("не сохраняет завершённую команду без result_status", async () => {
    await expect(
      pool.query(
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
            result_status,
            completed_at
          )
          VALUES (
            $1,
            'system:constraint-test',
            NULL,
            'admin.constraint.test',
            $2,
            $3,
            'identity_user',
            'constraint-test',
            'internal',
            'succeeded',
            NULL,
            now()
          )
        `,
        [randomUUID(), randomUUID(), "a".repeat(64)],
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("требует согласованную пару IP HMAC и версии ключа", async () => {
    const invalidPairs = [
      {
        ipHmac: null,
        ipHmacKeyVersion: 1,
      },
      {
        ipHmac: "b".repeat(64),
        ipHmacKeyVersion: null,
      },
    ];

    for (const pair of invalidPairs) {
      await expect(
        pool.query(
          `
            INSERT INTO admin_audit_events (
              id,
              request_id,
              actor_kind,
              actor_user_id,
              action,
              target_type,
              target_id,
              outcome,
              ip_hmac,
              ip_hmac_key_version
            )
            VALUES (
              $1,
              $2,
              'system',
              NULL,
              'admin.constraint.test',
              'identity_user',
              'constraint-test',
              'succeeded',
              $3,
              $4
            )
          `,
          [
            randomUUID(),
            randomUUID(),
            pair.ipHmac,
            pair.ipHmacKeyVersion,
          ],
        ),
      ).rejects.toMatchObject({
        code: "23514",
      });
    }
  });

  it("запрещает TRUNCATE неизменяемых административных таблиц", async () => {
    const truncateStatements = [
      "TRUNCATE TABLE admin_audit_events",
      "TRUNCATE TABLE admin_command_executions CASCADE",
      "TRUNCATE TABLE admin_role_assignments",
      "TRUNCATE TABLE admin_invariant_locks",
    ];

    for (const statement of truncateStatements) {
      await expect(
        pool.query(statement),
      ).rejects.toMatchObject({
        code: "55000",
      });
    }
  });
});
