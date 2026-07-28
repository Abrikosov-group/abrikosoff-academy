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
      userId: ordinarySession.user.id,
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
        permission: "admin:enter",
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
      permission: "dashboard:read",
      requestId: randomUUID(),
    });

    expect(context).toMatchObject({
      actor: {
        id: ordinarySession.user.id,
      },
      roles: ["owner"],
      adminVerificationMethod: "telegram_oidc",
    });
    expect(context.permissions.has("roles:write")).toBe(true);
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
    await expect(
      administrationService.getContext({
        tokenSha256: hashIdentityToken(adminSession.token),
        permission: "admin:enter",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
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
    const identityRepository = new PostgresIdentityRepository(pool);
    const identity = await identityRepository.upsertIdentity({
      methodType: "telegram",
      identifier: "admin-integration-idempotency",
      displayName: "Проверка идемпотентности",
      metadata: {},
      consent,
    });
    const idempotencyKey = randomUUID();

    await expect(
      runBootstrap({
        userId: identity.id,
        reason: "Первое точное назначение для проверки ключа",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining(
        "BOOTSTRAP_OWNER_ALREADY_EXISTS",
      ),
    });

    await expect(
      runBootstrap({
        userId: identity.id,
        reason: "Изменённая причина с тем же ключом команды",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining("IDEMPOTENCY_CONFLICT"),
    });
  });

  it("безопасно продолжает команду после истечения lease", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identity = await identityRepository.upsertIdentity({
      methodType: "telegram",
      identifier: "admin-integration-expired-lease",
      displayName: "Проверка восстановления команды",
      metadata: {},
      consent,
    });
    const idempotencyKey = randomUUID();
    const reason =
      "Восстановление назначения владельца после истечения lease";
    const requestSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          action: "admin.role.bootstrap_grant",
          reason,
          role: "owner",
          userId: identity.id,
        }),
      )
      .digest("hex");
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
        identity.id,
      ],
    );

    await expect(
      runBootstrap({
        userId: identity.id,
        reason,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining(
        "BOOTSTRAP_OWNER_ALREADY_EXISTS",
      ),
    });

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
      status: "rejected",
      attempt_count: 2,
      audit_events: "1",
    });
  });
});
