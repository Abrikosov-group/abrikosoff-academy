import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  GrantManualAccessService,
  normalizeGrantManualAccessInput,
  RevokeManualAccessService,
} from "@/modules/administration/application/manual-access-service";
import { AdministrationAccessReadService } from "@/modules/administration/application/administration-access-read-service";
import { AdministrationStudentReadService } from "@/modules/administration/application/administration-student-read-service";
import { configuredPermissionsForRole } from "@/modules/administration/domain/permissions";
import type { AdminContext } from "@/modules/administration/domain/types";
import { PostgresAdministrationCommandRepository } from "@/modules/administration/infrastructure/postgres-administration-command-repository";
import { PostgresAdministrationAccessReadRepository } from "@/modules/administration/infrastructure/postgres-administration-access-read-repository";
import { PostgresAdministrationStudentReadRepository } from "@/modules/administration/infrastructure/postgres-administration-student-read-repository";
import { PostgresIdentityAdministrationRepository } from "@/modules/identity/infrastructure/postgres-identity-administration-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const pool = new Pool({
  connectionString: testDatabaseUrl,
  application_name: "academy-manual-access-integration-tests",
  max: 6,
});
const createdUserIds: string[] = [];

async function insertUser(displayName: string, status = "active") {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO identity_users (id, display_name, status)
      VALUES ($1, $2, $3)
    `,
    [id, displayName, status],
  );
  createdUserIds.push(id);
  return id;
}

function context(actorUserId: string): AdminContext {
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
    sessionId: randomUUID(),
    roles: ["owner"],
    permissions: configuredPermissionsForRole("owner"),
    adminVerifiedAt: new Date(),
    adminVerificationMethod: "telegram_oidc",
    requestId: randomUUID(),
  };
}

function services(config = {
  manualAccessGrantingEnabled: true,
  effectiveAccessMode: "v2" as const,
}) {
  const identityRepository =
    new PostgresIdentityAdministrationRepository();
  const repository = new PostgresAdministrationCommandRepository(
    pool,
    identityRepository,
    identityRepository,
  );
  return {
    grant: new GrantManualAccessService(repository, config),
    revoke: new RevokeManualAccessService(repository),
  };
}

async function insertPaidGrant(input: {
  customerId: string;
  periodStart: Date;
  periodEnd: Date;
}) {
  const orderId = randomUUID();
  const createdAt = new Date();
  await pool.query(
    `
      INSERT INTO billing_orders (
        id, customer_id, plan_id, legal_entity_id, country_code,
        amount_minor, currency, status, idempotency_key,
        selected_provider, merchant_account_id, offer_accepted_at,
        offer_version, created_at, updated_at
      ) VALUES (
        $1, $2, 'monthly', 'ip-fedotova', 'RU', 150000, 'RUB',
        'paid', $3, 'demo', 'manual-access-integration', $4,
        'integration', $4, $4
      )
    `,
    [orderId, input.customerId, randomUUID(), createdAt],
  );
  await pool.query(
    `
      INSERT INTO billing_access_grants (
        order_id, customer_id, plan_id, status, period_start,
        period_end, granted_at, created_at, updated_at
      ) VALUES ($1, $2, 'monthly', 'granted', $3, $4, $5, $5, $5)
    `,
    [
      orderId,
      input.customerId,
      input.periodStart,
      input.periodEnd,
      createdAt,
    ],
  );
  return orderId;
}

async function insertGracePeriod(input: {
  customerId: string;
  periodStart: Date;
  periodEnd: Date;
  subscriptionId?: string;
  status?: "active" | "expired" | "revoked";
}) {
  const subscriptionId = input.subscriptionId ?? randomUUID();
  if (!input.subscriptionId) {
    await pool.query(
      `
        INSERT INTO billing_subscriptions (
          id, customer_id, plan_id, status, current_period_start,
          current_period_end, auto_renew, cancel_at_period_end,
          created_at, updated_at
        ) VALUES ($1, $2, 'monthly', 'grace_period', $3, $4, false, false, $3, $3)
      `,
      [subscriptionId, input.customerId, input.periodStart, input.periodEnd],
    );
  }
  const graceId = randomUUID();
  await pool.query(
    `
      INSERT INTO billing_access_grace_periods (
        id, subscription_id, customer_id, status, period_start,
        period_end, created_at, updated_at, revoked_at
      ) VALUES (
        $1, $2, $3, $6::text, $4, $5, $4, $4,
        CASE
          WHEN $6::text = 'active' THEN NULL
          ELSE $5::timestamptz
        END
      )
    `,
    [
      graceId,
      subscriptionId,
      input.customerId,
      input.periodStart,
      input.periodEnd,
      input.status ?? "active",
    ],
  );
  return { graceId, subscriptionId };
}

function futurePeriod(offsetDays = 1, durationDays = 20) {
  const start = new Date(Date.now() + offsetDays * 86_400_000);
  const end = new Date(start.getTime() + durationDays * 86_400_000);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

describe("ручной доступ с PostgreSQL", () => {
  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await pool.query(
        "ALTER TABLE admin_audit_events DISABLE TRIGGER admin_audit_events_append_only",
      );
      try {
        await pool.query(
          "DELETE FROM admin_audit_events WHERE actor_user_id = ANY($1::uuid[])",
          [createdUserIds],
        );
      } finally {
        await pool.query(
          "ALTER TABLE admin_audit_events ENABLE TRIGGER admin_audit_events_append_only",
        );
      }
      await pool.query(
        "ALTER TABLE access_manual_grants DISABLE TRIGGER access_manual_grants_protect_history",
      );
      try {
        await pool.query(
          "DELETE FROM access_manual_grants WHERE customer_id = ANY($1::uuid[])",
          [createdUserIds],
        );
      } finally {
        await pool.query(
          "ALTER TABLE access_manual_grants ENABLE TRIGGER access_manual_grants_protect_history",
        );
      }
      await pool.query(
        "ALTER TABLE admin_command_executions DISABLE TRIGGER admin_command_executions_protect_journal",
      );
      try {
        await pool.query(
          "DELETE FROM admin_command_executions WHERE actor_user_id = ANY($1::uuid[])",
          [createdUserIds],
        );
      } finally {
        await pool.query(
          "ALTER TABLE admin_command_executions ENABLE TRIGGER admin_command_executions_protect_journal",
        );
      }
      await pool.query(
        "DELETE FROM billing_access_grace_periods WHERE customer_id = ANY($1::uuid[])",
        [createdUserIds],
      );
      await pool.query(
        "DELETE FROM billing_access_grants WHERE customer_id = ANY($1::uuid[])",
        [createdUserIds],
      );
      await pool.query(
        "DELETE FROM billing_payments WHERE order_id IN (SELECT id FROM billing_orders WHERE customer_id = ANY($1::uuid[]))",
        [createdUserIds],
      );
      await pool.query(
        "DELETE FROM billing_subscriptions WHERE customer_id = ANY($1::uuid[])",
        [createdUserIds],
      );
      await pool.query(
        "DELETE FROM billing_orders WHERE customer_id = ANY($1::uuid[])",
        [createdUserIds],
      );
      await pool.query(
        "DELETE FROM identity_methods WHERE user_id = ANY($1::uuid[])",
        [createdUserIds],
      );
      await pool.query(
        "DELETE FROM identity_users WHERE id = ANY($1::uuid[])",
        [createdUserIds],
      );
    }
    await pool.end();
  });

  it("атомарно создаёт грант, command result и один audit, а replay не дублирует их", async () => {
    const actorUserId = await insertUser("Владелец ручного доступа");
    const customerId = await insertUser("Ученик ручного доступа");
    const service = services().grant;
    const input = {
      context: context(actorUserId),
      targetUserId: customerId,
      ...futurePeriod(),
      reason: "Доступ по решению владельца Академии",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };

    const first = await service.execute(input);
    const replay = await service.execute({
      ...input,
      context: { ...input.context, requestId: randomUUID() },
    });
    expect(replay).toMatchObject({
      grantId: first.grantId,
      status: "granted",
    });
    const persisted = await pool.query<{
      grants: number;
      executions: number;
      audits: number;
    }>(
      `
        SELECT
          (SELECT count(*)::integer FROM access_manual_grants WHERE id = $1) AS grants,
          (SELECT count(*)::integer FROM admin_command_executions WHERE principal_key = $2 AND action = 'access.manual.grant' AND idempotency_key = $3) AS executions,
          (SELECT count(*)::integer FROM admin_audit_events WHERE command_execution_id = (SELECT command_execution_id FROM access_manual_grants WHERE id = $1)) AS audits
      `,
      [first.grantId, `user:${actorUserId}`, input.idempotencyKey],
    );
    expect(persisted.rows[0]).toEqual({ grants: 1, executions: 1, audits: 1 });
    await expect(
      service.execute({
        ...input,
        reason: "Та же команда с изменённой причиной доступа",
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
    );
  });

  it("при конкурентном повторе одного ключа создаёт ровно один грант", async () => {
    const actorUserId = await insertUser("Владелец конкурентной выдачи");
    const customerId = await insertUser("Ученик конкурентной выдачи");
    const input = {
      context: context(actorUserId),
      targetUserId: customerId,
      ...futurePeriod(),
      reason: "Один ручной период при конкурентном повторе",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };
    const attempts = await Promise.allSettled([
      services().grant.execute(input),
      services().grant.execute({
        ...input,
        context: { ...input.context, requestId: randomUUID() },
      }),
    ]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
    const persisted = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM access_manual_grants WHERE customer_id = $1",
      [customerId],
    );
    expect(persisted.rows[0]?.count).toBe(1);
  });

  it("разрешает пересечения и сообщает их число", async () => {
    const actorUserId = await insertUser("Владелец пересечений");
    const customerId = await insertUser("Ученик пересечений");
    const service = services().grant;
    const period = futurePeriod(2, 10);
    await service.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      ...period,
      reason: "Первый ручной период для проверки пересечения",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    const second = await service.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      periodStart: new Date(Date.parse(period.periodStart) + 86_400_000).toISOString(),
      periodEnd: new Date(Date.parse(period.periodEnd) + 86_400_000).toISOString(),
      reason: "Второй ручной период для проверки пересечения",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    expect(second.overlapCount).toBe(1);
    const count = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM access_manual_grants WHERE customer_id = $1",
      [customerId],
    );
    expect(count.rows[0]?.count).toBe(2);
  });

  it("отзывает только выбранный manual, сохраняет другой источник и replay", async () => {
    const actorUserId = await insertUser("Владелец отзыва");
    const customerId = await insertUser("Ученик отзыва");
    const { grant, revoke } = services();
    const period = futurePeriod(-1, 20);
    const first = await grant.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      ...period,
      reason: "Первый действующий ручной период для отзыва",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    const second = await grant.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      ...period,
      reason: "Второй действующий ручной период сохраняет доступ",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    const revokeInput = {
      context: context(actorUserId),
      targetUserId: customerId,
      grantId: first.grantId as string,
      reason: "Первый период был выдан по ошибке",
      idempotencyKey: `revoke_${randomUUID().replaceAll("-", "")}`,
    };
    const result = await revoke.execute(revokeInput);
    const replay = await revoke.execute({
      ...revokeInput,
      context: { ...revokeInput.context, requestId: randomUUID() },
    });
    expect(result.effectiveAccess.canReadCourses).toBe(true);
    expect(replay).toMatchObject({ grantId: first.grantId, status: "revoked" });
    const grants = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM access_manual_grants WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[first.grantId, second.grantId]],
    );
    expect(grants.rows).toEqual(
      expect.arrayContaining([
        { id: first.grantId, status: "revoked" },
        { id: second.grantId, status: "granted" },
      ]),
    );
    await expect(
      revoke.execute({
        ...revokeInput,
        context: { ...revokeInput.context, requestId: randomUUID() },
        idempotencyKey: `revoke_${randomUUID().replaceAll("-", "")}`,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "MANUAL_ACCESS_GRANT_ALREADY_REVOKED",
      }),
    );
  });

  it("не принимает оплаченный грант как ручной и не меняет Billing", async () => {
    const actorUserId = await insertUser("Владелец защиты Billing");
    const customerId = await insertUser("Ученик защиты Billing");
    const period = futurePeriod(-1, 20);
    const orderId = await insertPaidGrant({
      customerId,
      periodStart: new Date(period.periodStart),
      periodEnd: new Date(period.periodEnd),
    });
    await expect(
      services().revoke.execute({
        context: context(actorUserId),
        targetUserId: customerId,
        grantId: orderId,
        reason: "Проверка запрета отзыва оплаченного основания",
        idempotencyKey: `revoke_${randomUUID().replaceAll("-", "")}`,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "MANUAL_ACCESS_GRANT_NOT_FOUND" }),
    );
    const billing = await pool.query<{
      order_status: string;
      grant_status: string;
      payment_count: number;
      subscription_count: number;
    }>(
      `
        SELECT
          (SELECT status FROM billing_orders WHERE id = $1) AS order_status,
          (SELECT status FROM billing_access_grants WHERE order_id = $1) AS grant_status,
          (SELECT count(*)::integer FROM billing_payments WHERE order_id = $1) AS payment_count,
          (SELECT count(*)::integer FROM billing_subscriptions WHERE customer_id = $2) AS subscription_count
      `,
      [orderId, customerId],
    );
    expect(billing.rows[0]).toEqual({
      order_status: "paid",
      grant_status: "granted",
      payment_count: 0,
      subscription_count: 0,
    });
  });

  it("сохраняет отзыв при выключенной новой выдаче", async () => {
    const actorUserId = await insertUser("Владелец выключенной выдачи");
    const customerId = await insertUser("Ученик выключенной выдачи");
    const enabled = services();
    const originalGrantInput = {
      context: context(actorUserId),
      targetUserId: customerId,
      ...futurePeriod(-1, 20),
      reason: "Действующий ручной период до выключения выдачи",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };
    const granted = await enabled.grant.execute(originalGrantInput);
    const disabled = services({
      manualAccessGrantingEnabled: false,
      effectiveAccessMode: "v2",
    });
    await expect(
      disabled.grant.execute({
        ...originalGrantInput,
        context: { ...originalGrantInput.context, requestId: randomUUID() },
      }),
    ).resolves.toMatchObject({ grantId: granted.grantId });
    const blockedKey = `grant_${randomUUID().replaceAll("-", "")}`;
    await expect(
      disabled.grant.execute({
        context: context(actorUserId),
        targetUserId: customerId,
        ...futurePeriod(),
        reason: "Новая выдача после отключения флага",
        idempotencyKey: blockedKey,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "MANUAL_ACCESS_GRANTING_DISABLED" }),
    );
    await expect(
      disabled.revoke.execute({
        context: context(actorUserId),
        targetUserId: customerId,
        grantId: granted.grantId,
        reason: "Отзыв ранее созданного ручного периода",
        idempotencyKey: `revoke_${randomUUID().replaceAll("-", "")}`,
      }),
    ).resolves.toMatchObject({ status: "revoked" });
    const blockedExecution = await pool.query<{ count: number }>(
      `
        SELECT count(*)::integer AS count
        FROM admin_command_executions
        WHERE principal_key = $1
          AND action = 'access.manual.grant'
          AND idempotency_key = $2
      `,
      [`user:${actorUserId}`, blockedKey],
    );
    expect(blockedExecution.rows[0]?.count).toBe(0);
  });

  it("сохраняет предметные отказы после reservation как rejected с одним audit", async () => {
    const actorUserId = await insertUser("Владелец отказа");
    const missingCustomerId = randomUUID();
    const service = services().grant;
    const input = {
      context: context(actorUserId),
      targetUserId: missingCustomerId,
      ...futurePeriod(),
      reason: "Проверка отсутствующего ученика в команде",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };
    await expect(service.execute(input)).rejects.toEqual(
      expect.objectContaining({ code: "USER_NOT_FOUND", httpStatus: 404 }),
    );
    await expect(service.execute(input)).rejects.toEqual(
      expect.objectContaining({ code: "USER_NOT_FOUND", httpStatus: 404 }),
    );
    const terminal = await pool.query<{
      status: string;
      result_status: number;
      error_code: string;
      audits: number;
    }>(
      `
        SELECT
          execution.status,
          execution.result_status,
          execution.error_code,
          count(audit.id)::integer AS audits
        FROM admin_command_executions execution
        LEFT JOIN admin_audit_events audit ON audit.command_execution_id = execution.id
        WHERE execution.principal_key = $1
          AND execution.action = 'access.manual.grant'
          AND execution.idempotency_key = $2
        GROUP BY execution.id
      `,
      [`user:${actorUserId}`, input.idempotencyKey],
    );
    expect(terminal.rows[0]).toEqual({
      status: "rejected",
      result_status: 404,
      error_code: "USER_NOT_FOUND",
      audits: 1,
    });
  });

  it("откатывает выдачу и отзыв при недоступном audit", async () => {
    const actorUserId = await insertUser("Владелец атомарного аудита");
    const customerId = await insertUser("Ученик атомарного аудита");
    const service = services();
    const grantInput = {
      context: context(actorUserId),
      targetUserId: customerId,
      ...futurePeriod(-1, 20),
      reason: "Проверка отката ручной выдачи без аудита",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };

    await pool.query(`
      CREATE OR REPLACE FUNCTION test_reject_manual_access_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced manual access audit failure';
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER test_reject_manual_access_audit
      BEFORE INSERT ON admin_audit_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_manual_access_audit()
    `);
    try {
      await expect(service.grant.execute(grantInput)).rejects.toEqual(
        expect.objectContaining({ code: "COMMAND_RECOVERY_REQUIRED" }),
      );
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_reject_manual_access_audit ON admin_audit_events",
      );
    }
    const rolledBackGrant = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM access_manual_grants WHERE customer_id = $1",
      [customerId],
    );
    expect(rolledBackGrant.rows[0]?.count).toBe(0);

    const granted = await service.grant.execute({
      ...grantInput,
      context: { ...grantInput.context, requestId: randomUUID() },
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    await pool.query(`
      CREATE TRIGGER test_reject_manual_access_audit
      BEFORE INSERT ON admin_audit_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_manual_access_audit()
    `);
    try {
      await expect(
        service.revoke.execute({
          context: context(actorUserId),
          targetUserId: customerId,
          grantId: granted.grantId,
          reason: "Проверка отката ручного отзыва без аудита",
          idempotencyKey: `revoke_${randomUUID().replaceAll("-", "")}`,
        }),
      ).rejects.toEqual(
        expect.objectContaining({ code: "COMMAND_RECOVERY_REQUIRED" }),
      );
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_reject_manual_access_audit ON admin_audit_events",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_reject_manual_access_audit()",
      );
    }
    const rolledBackRevoke = await pool.query<{ status: string }>(
      "SELECT status FROM access_manual_grants WHERE id = $1",
      [granted.grantId],
    );
    expect(rolledBackRevoke.rows[0]?.status).toBe("granted");
  });

  it("показывает manual и grace раздельно без раскрытия Billing-полей", async () => {
    const actorUserId = await insertUser("Владелец read-модели");
    const customerId = await insertUser("Ученик read-модели");
    const at = new Date();
    const service = services();
    const manual = await service.grant.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      periodStart: new Date(at.getTime() - 86_400_000).toISOString(),
      periodEnd: new Date(at.getTime() + 5 * 86_400_000).toISOString(),
      reason: "Ручное основание рядом с льготным периодом",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    await service.revoke.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      grantId: manual.grantId,
      reason: "Ручное основание заменено льготным периодом",
      idempotencyKey: `revoke_${randomUUID().replaceAll("-", "")}`,
    });
    const grace = await insertGracePeriod({
      customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 2 * 86_400_000),
    });
    const limitedPermissions = new Set(["users.read", "access.read"] as const);
    const studentRead = new AdministrationStudentReadService(
      new PostgresAdministrationStudentReadRepository(pool),
    );
    const detail = await studentRead.findStudentDetail({
      userId: customerId,
      permissions: limitedPermissions,
      at,
    });
    expect(detail).toMatchObject({
      billingContextVisible: false,
      effectiveAccess: { state: "active" },
      manualGrants: [expect.objectContaining({ id: manual.grantId, status: "revoked" })],
      gracePeriods: [
        expect.objectContaining({
          id: grace.graceId,
          source: "grace",
          effectiveNow: true,
        }),
      ],
    });
    expect(detail?.gracePeriods[0]).not.toHaveProperty("subscriptionId");

    const accessRead = new AdministrationAccessReadService(
      new PostgresAdministrationAccessReadRepository(pool),
    );
    const page = await accessRead.listAccess({
      query: customerId,
      permissions: limitedPermissions,
      at,
    });
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "manual",
          state: "revoked",
          accessRemainsAfterRevoke: true,
        }),
        expect.objectContaining({ source: "grace", state: "active" }),
      ]),
    );
  });

  it("завершает восстановленную выдачу, если период истёк до повтора", async () => {
    const actorUserId = await insertUser("Владелец восстановления периода");
    const customerId = await insertUser("Ученик восстановления периода");
    const identityRepository = new PostgresIdentityAdministrationRepository();
    const repository = new PostgresAdministrationCommandRepository(
      pool,
      identityRepository,
      identityRepository,
    );
    const service = new GrantManualAccessService(repository, {
      manualAccessGrantingEnabled: true,
      effectiveAccessMode: "v2",
    });
    const periodStart = new Date(Date.now() - 60_000).toISOString();
    const periodEnd = new Date(Date.now() + 250).toISOString();
    const input = {
      context: context(actorUserId),
      targetUserId: customerId,
      periodStart,
      periodEnd,
      reason: "Восстановление короткой команды после истечения периода",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };
    const command = normalizeGrantManualAccessInput(input);
    const reservation = await repository.reserveInternalCommand(command);
    expect(reservation.state).toBe("reserved");
    if (reservation.state !== "reserved") throw new Error("reservation failed");
    await pool.query(
      `
        UPDATE admin_command_executions
        SET lease_expires_at = statement_timestamp() - interval '1 second',
            updated_at = statement_timestamp()
        WHERE id = $1
      `,
      [reservation.executionId],
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(service.execute(input)).rejects.toEqual(
      expect.objectContaining({
        code: "ADMIN_COMMAND_INVALID_REQUEST",
        httpStatus: 400,
      }),
    );
    const terminal = await pool.query<{
      status: string;
      result_status: number;
      error_code: string;
      audits: number;
    }>(
      `
        SELECT
          execution.status,
          execution.result_status,
          execution.error_code,
          count(audit.id)::integer AS audits
        FROM admin_command_executions execution
        LEFT JOIN admin_audit_events audit
          ON audit.command_execution_id = execution.id
        WHERE execution.id = $1
        GROUP BY execution.id
      `,
      [reservation.executionId],
    );
    expect(terminal.rows[0]).toEqual({
      status: "rejected",
      result_status: 400,
      error_code: "ADMIN_COMMAND_INVALID_REQUEST",
      audits: 1,
    });
  });

  it("перепроверяет окончание периода после customer lock", async () => {
    const actorUserId = await insertUser("Владелец блокировки периода");
    const customerId = await insertUser("Ученик блокировки периода");
    const periodEnd = new Date(Date.now() + 700).toISOString();
    const input = {
      context: context(actorUserId),
      targetUserId: customerId,
      periodStart: new Date(Date.now() - 60_000).toISOString(),
      periodEnd,
      reason: "Проверка окончания периода после ожидания блокировки",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    };
    const lockClient = await pool.connect();
    await lockClient.query("BEGIN");
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 2147483647))",
      [customerId],
    );
    const execution = services().grant.execute(input).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );

    await new Promise((resolve) => setTimeout(resolve, 850));
    await lockClient.query("COMMIT");
    lockClient.release();

    const outcome = await execution;
    expect(outcome.error).toEqual(
      expect.objectContaining({
        code: "ADMIN_COMMAND_INVALID_REQUEST",
        httpStatus: 400,
      }),
    );
    expect(outcome.value).toBeUndefined();
    const grants = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM access_manual_grants WHERE customer_id = $1",
      [customerId],
    );
    expect(grants.rows[0]?.count).toBe(0);
  });

  it("различает завершённый grace и активную историю одной подписки", async () => {
    const customerId = await insertUser("Ученик истории grace");
    const at = new Date();
    const expired = await insertGracePeriod({
      customerId,
      periodStart: new Date(at.getTime() - 4 * 86_400_000),
      periodEnd: new Date(at.getTime() - 2 * 86_400_000),
      status: "expired",
    });
    const active = await insertGracePeriod({
      customerId,
      subscriptionId: expired.subscriptionId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 2 * 86_400_000),
      status: "active",
    });
    const studentRead = new AdministrationStudentReadService(
      new PostgresAdministrationStudentReadRepository(pool),
    );
    const detail = await studentRead.findStudentDetail({
      userId: customerId,
      permissions: new Set(["users.read", "access.read"] as const),
      at,
    });

    expect(detail?.gracePeriods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expired.graceId, effectiveNow: false }),
        expect.objectContaining({ id: active.graceId, effectiveNow: true }),
      ]),
    );
  });

  it("показывает единственный завершённый grace как завершённый доступ", async () => {
    const customerId = await insertUser("Ученик завершённого grace");
    const at = new Date();
    await insertGracePeriod({
      customerId,
      periodStart: new Date(at.getTime() - 3 * 86_400_000),
      periodEnd: new Date(at.getTime() - 86_400_000),
      status: "expired",
    });
    const studentRead = new AdministrationStudentReadService(
      new PostgresAdministrationStudentReadRepository(pool),
    );
    const page = await studentRead.listStudents({
      filters: { query: customerId, access: "expired", limit: 50 },
      displayTimeZone: "Europe/Moscow",
      permissions: configuredPermissionsForRole("owner"),
      at,
    });

    expect(page.items).toEqual([
      expect.objectContaining({ id: customerId, accessState: "expired" }),
    ]);
  });

  it("использует единые учётные идентификаторы в поиске доступов", async () => {
    const actorUserId = await insertUser("Владелец поиска доступов");
    const customerId = await insertUser("Ученик поиска доступов");
    const receiptEmail = `receipt-${randomUUID()}@example.test`;
    const telegramUserId = `${Date.now()}773`;
    await pool.query(
      "UPDATE identity_users SET receipt_email = $2 WHERE id = $1",
      [customerId, receiptEmail],
    );
    await pool.query(
      `
        INSERT INTO identity_methods (
          id, user_id, method_type, identifier, verified_at, metadata
        ) VALUES ($1, $2, 'telegram', $3, statement_timestamp(), $4::jsonb)
      `,
      [
        randomUUID(),
        customerId,
        `telegram-sub-${randomUUID()}`,
        JSON.stringify({
          telegramUserId,
          username: `access_search_${Date.now()}`,
        }),
      ],
    );
    await services().grant.execute({
      context: context(actorUserId),
      targetUserId: customerId,
      ...futurePeriod(-1, 3),
      reason: "Основание для проверки единого поиска доступов",
      idempotencyKey: `grant_${randomUUID().replaceAll("-", "")}`,
    });
    const accessRead = new AdministrationAccessReadService(
      new PostgresAdministrationAccessReadRepository(pool),
    );
    const ownerPermissions = configuredPermissionsForRole("owner");

    for (const query of [receiptEmail, telegramUserId]) {
      const page = await accessRead.listAccess({
        query,
        permissions: ownerPermissions,
        at: new Date(),
      });
      expect(page.items.map((item) => item.customerId), `поиск по ${query}`).toContain(
        customerId,
      );
    }
    const withoutPaymentContext = await accessRead.listAccess({
      query: receiptEmail,
      permissions: new Set(["access.read", "users.read"] as const),
      at: new Date(),
    });
    expect(withoutPaymentContext.items).toHaveLength(0);
  });
});
