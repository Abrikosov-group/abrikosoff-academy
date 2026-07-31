import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { EffectiveAccessService } from "@/modules/access/application/effective-access-service";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { PostgresEffectiveAccessRepository } from "@/modules/access/infrastructure/postgres-effective-access-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const at = new Date("2041-08-30T12:00:00.000Z");
const pool = new Pool({
  connectionString: testDatabaseUrl,
  application_name: "academy-effective-access-integration-tests",
  max: 4,
});
const repository = new PostgresEffectiveAccessRepository(pool);
const service = new EffectiveAccessService(repository);

async function insertUser(displayName: string) {
  const userId = randomUUID();

  await pool.query(
    `
      INSERT INTO identity_users (
        id,
        display_name,
        status
      )
      VALUES ($1, $2, 'active')
    `,
    [userId, displayName],
  );

  return userId;
}

async function insertOrder(userId: string, createdAt: Date) {
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
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'monthly',
        'ip-fedotova',
        'RU',
        150000,
        'RUB',
        'paid',
        $3,
        'demo',
        'effective-access-integration',
        $4,
        'integration',
        $4,
        $4
      )
    `,
    [orderId, userId, randomUUID(), createdAt],
  );

  return orderId;
}

async function insertPaidGrant(input: {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  status?: "granted" | "revoked";
  createdAt?: Date;
}) {
  const createdAt = input.createdAt ?? at;
  const orderId = await insertOrder(input.userId, createdAt);
  const status = input.status ?? "granted";

  await pool.query(
    `
      INSERT INTO billing_access_grants (
        order_id,
        customer_id,
        plan_id,
        status,
        period_start,
        period_end,
        granted_at,
        revoked_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'monthly',
        $3::text,
        $4::timestamptz,
        $5::timestamptz,
        $6::timestamptz,
        CASE
          WHEN $3::text = 'revoked'
            THEN $6::timestamptz
          ELSE NULL
        END,
        $6::timestamptz,
        $6::timestamptz
      )
    `,
    [
      orderId,
      input.userId,
      status,
      input.periodStart,
      input.periodEnd,
      createdAt,
    ],
  );

  return orderId;
}

async function insertSubscription(input: {
  userId: string;
  status:
    | "pending"
    | "active"
    | "grace_period"
    | "canceled"
    | "expired";
  periodStart: Date;
  periodEnd: Date;
}) {
  await pool.query(
    `
      INSERT INTO billing_subscriptions (
        id,
        customer_id,
        plan_id,
        status,
        current_period_start,
        current_period_end,
        auto_renew,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'monthly',
        $3,
        $4,
        $5,
        false,
        $6,
        $6
      )
    `,
    [
      randomUUID(),
      input.userId,
      input.status,
      input.periodStart,
      input.periodEnd,
      new Date(at.getTime() - 60_000),
    ],
  );
}

async function insertSucceededGrantCommand(
  actorUserId: string,
  customerId: string,
  completedAt: Date,
) {
  const commandId = randomUUID();
  const requestHash = createHash("sha256")
    .update(commandId)
    .digest("hex");

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
        created_at,
        updated_at,
        completed_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'access.manual.grant',
        $4,
        $5,
        'identity_user',
        $6,
        'internal',
        'succeeded',
        200,
        '{}'::jsonb,
        $7,
        $7,
        $7
      )
    `,
    [
      commandId,
      `user:${actorUserId}`,
      actorUserId,
      randomUUID(),
      requestHash,
      customerId,
      completedAt,
    ],
  );

  return commandId;
}

async function insertManualGrant(input: {
  actorUserId: string;
  customerId: string;
  periodStart: Date;
  periodEnd: Date;
  grantedAt?: Date;
  createdAt?: Date;
  grantReason?: string;
}) {
  const grantedAt = input.grantedAt ?? at;
  const createdAt = input.createdAt ?? grantedAt;
  const commandId = await insertSucceededGrantCommand(
    input.actorUserId,
    input.customerId,
    createdAt,
  );
  const grantId = randomUUID();

  await pool.query(
    `
      INSERT INTO access_manual_grants (
        id,
        customer_id,
        status,
        period_start,
        period_end,
        grant_reason,
        granted_by_user_id,
        granted_at,
        command_execution_id,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'granted',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $9
      )
    `,
    [
      grantId,
      input.customerId,
      input.periodStart,
      input.periodEnd,
      input.grantReason ??
        "Ручной доступ для integration-проверки resolver",
      input.actorUserId,
      grantedAt,
      commandId,
      createdAt,
    ],
  );

  return { commandId, grantId };
}

describe("эффективный доступ с PostgreSQL", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("создаёт совместимую схему и разрешает shadow до первого ручного гранта", async () => {
    const indexes = await pool.query<{ indexname: string }>(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'access_manual_grants'
      `,
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "access_manual_grants_customer_period_idx",
        "access_manual_grants_period_end_idx",
      ]),
    );
    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "shadow",
        manualAccessGrantingEnabled: false,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      label: "активного",
      status: "active" as const,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      grantStatus: "granted" as const,
    },
    {
      label: "льготного",
      status: "grace_period" as const,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      grantStatus: "granted" as const,
    },
    {
      label: "ожидающего",
      status: "pending" as const,
      periodStart: new Date(at.getTime() + 1),
      periodEnd: new Date(at.getTime() + 60_000),
      grantStatus: "granted" as const,
    },
    {
      label: "завершённого",
      status: "expired" as const,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: at,
      grantStatus: "granted" as const,
    },
    {
      label: "отменённого",
      status: "canceled" as const,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      grantStatus: "revoked" as const,
    },
  ])(
    "сохраняет прежнее paid-решение для $label периода",
    async ({ status, periodStart, periodEnd, grantStatus }) => {
      const userId = await insertUser(
        `Paid-регрессия ${status} ${randomUUID()}`,
      );

      await insertSubscription({
        userId,
        status,
        periodStart,
        periodEnd,
      });
      await insertPaidGrant({
        userId,
        periodStart,
        periodEnd,
        status: grantStatus,
        createdAt: new Date(at.getTime() - 60_000),
      });

      const [legacySubscription, effectiveAccess] =
        await Promise.all([
          getSubscriptionSummary(pool, userId),
          service.getEffectiveAccess(userId, at),
        ]);

      expect(effectiveAccess.canReadCourses).toBe(
        hasCurrentSubscriptionAccess(legacySubscription, at),
      );
    },
  );

  it("объединяет только действующие paid и manual основания на точных границах", async () => {
    const actorUserId = await insertUser(
      "Владелец resolver integration-теста",
    );
    const customerId = await insertUser(
      "Ученик resolver integration-теста",
    );
    const activePaidId = await insertPaidGrant({
      userId: customerId,
      periodStart: at,
      periodEnd: new Date(at.getTime() + 60 * 60_000),
      createdAt: new Date(at.getTime() - 60_000),
    });

    await insertPaidGrant({
      userId: customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: at,
      createdAt: new Date(at.getTime() - 60_000),
    });
    await insertPaidGrant({
      userId: customerId,
      periodStart: new Date(at.getTime() + 1),
      periodEnd: new Date(at.getTime() + 60_000),
      createdAt: new Date(at.getTime() - 60_000),
    });
    await insertPaidGrant({
      userId: customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      status: "revoked",
      createdAt: new Date(at.getTime() - 60_000),
    });

    const activeManual = await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: new Date(at.getTime() - 2 * 60 * 60_000),
      periodEnd: new Date(at.getTime() + 2 * 60 * 60_000),
      grantedAt: new Date(at.getTime() - 60_000),
    });
    await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: at,
      grantedAt: new Date(at.getTime() - 60_000),
    });
    await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: new Date(at.getTime() + 1),
      periodEnd: new Date(at.getTime() + 60_000),
      grantedAt: new Date(at.getTime() - 60_000),
    });
    const revokedManual = await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      grantedAt: new Date(at.getTime() - 60_000),
    });
    await pool.query(
      `
        UPDATE access_manual_grants
        SET
          status = 'revoked',
          revoked_by_user_id = $2,
          revoke_reason = 'Ручной доступ отозван integration-тестом',
          revoked_at = $3,
          updated_at = $3
        WHERE id = $1
      `,
      [
        revokedManual.grantId,
        actorUserId,
        new Date(at.getTime() - 1),
      ],
    );
    await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      grantedAt: new Date(at.getTime() - 60_000),
      createdAt: new Date(at.getTime() + 1),
    });

    await expect(
      service.getEffectiveAccess(customerId, at),
    ).resolves.toEqual({
      evaluatedAt: at.toISOString(),
      canReadCourses: true,
      activePeriod: {
        start: new Date(
          at.getTime() - 2 * 60 * 60_000,
        ).toISOString(),
        end: new Date(
          at.getTime() + 2 * 60 * 60_000,
        ).toISOString(),
      },
      activeBases: [
        {
          id: activePaidId,
          source: "paid",
          planId: "monthly",
          periodStart: at.toISOString(),
          periodEnd: new Date(
            at.getTime() + 60 * 60_000,
          ).toISOString(),
        },
        {
          id: activeManual.grantId,
          source: "manual",
          periodStart: new Date(
            at.getTime() - 2 * 60 * 60_000,
          ).toISOString(),
          periodEnd: new Date(
            at.getTime() + 2 * 60 * 60_000,
          ).toISOString(),
        },
      ],
    });

    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "shadow",
        manualAccessGrantingEnabled: false,
      }),
    ).rejects.toThrowError(
      "Режим legacy или shadow запрещён после появления ручного гранта.",
    );
    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "legacy_paid_plus_manual",
        manualAccessGrantingEnabled: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("сохраняет paid и manual основания до точного момента отзыва", async () => {
    const actorUserId = await insertUser(
      "Владелец проверки исторического доступа",
    );
    const customerId = await insertUser(
      "Ученик проверки исторического доступа",
    );
    const periodStart = new Date(at.getTime() - 60_000);
    const periodEnd = new Date(at.getTime() + 60_000);
    const revokedAt = new Date(at.getTime() + 1);
    const paidGrantId = await insertPaidGrant({
      userId: customerId,
      periodStart,
      periodEnd,
      createdAt: periodStart,
    });
    const manualGrant = await insertManualGrant({
      actorUserId,
      customerId,
      periodStart,
      periodEnd,
      grantedAt: periodStart,
    });

    await pool.query(
      `
        UPDATE billing_access_grants
        SET
          status = 'revoked',
          revoked_at = $2,
          updated_at = $2
        WHERE order_id = $1
      `,
      [paidGrantId, revokedAt],
    );
    await pool.query(
      `
        UPDATE access_manual_grants
        SET
          status = 'revoked',
          revoked_by_user_id = $2,
          revoke_reason = 'Доступ отозван после проверяемого момента',
          revoked_at = $3,
          updated_at = $3
        WHERE id = $1
      `,
      [manualGrant.grantId, actorUserId, revokedAt],
    );

    const beforeRevocation = await service.getEffectiveAccess(
      customerId,
      at,
    );

    expect(beforeRevocation.canReadCourses).toBe(true);
    expect(beforeRevocation.activeBases).toHaveLength(2);
    expect(beforeRevocation.activeBases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paidGrantId,
          source: "paid",
        }),
        expect.objectContaining({
          id: manualGrant.grantId,
          source: "manual",
        }),
      ]),
    );
    await expect(
      service.getEffectiveAccess(customerId, revokedAt),
    ).resolves.toEqual({
      evaluatedAt: revokedAt.toISOString(),
      canReadCourses: false,
      activePeriod: null,
      activeBases: [],
    });
  });

  it("защищает происхождение и жизненный цикл ручного гранта", async () => {
    const actorUserId = await insertUser(
      "Владелец проверки истории гранта",
    );
    const customerId = await insertUser(
      "Ученик проверки истории гранта",
    );
    const grant = await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: new Date(at.getTime() - 60_000),
      periodEnd: new Date(at.getTime() + 60_000),
      grantedAt: new Date(at.getTime() - 60_000),
    });

    await expect(
      pool.query(
        `
          UPDATE access_manual_grants
          SET grant_reason = 'Попытка заменить исходную причину гранта'
          WHERE id = $1
        `,
        [grant.grantId],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    const revokedAt = new Date(at.getTime() + 1);
    await pool.query(
      `
        UPDATE access_manual_grants
        SET
          status = 'revoked',
          revoked_by_user_id = $2,
          revoke_reason = 'Основание для доступа завершено владельцем',
          revoked_at = $3,
          updated_at = $3
        WHERE id = $1
      `,
      [grant.grantId, actorUserId, revokedAt],
    );

    await expect(
      pool.query(
        `
          UPDATE access_manual_grants
          SET revoke_reason = 'Повторное изменение причины отзыва запрещено'
          WHERE id = $1
        `,
        [grant.grantId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(
        "DELETE FROM access_manual_grants WHERE id = $1",
        [grant.grantId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query("TRUNCATE access_manual_grants"),
    ).rejects.toMatchObject({ code: "55000" });

    const state = await pool.query<{
      status: string;
      revoke_reason: string | null;
      revoked_at: Date | null;
    }>(
      `
        SELECT status, revoke_reason, revoked_at
        FROM access_manual_grants
        WHERE id = $1
      `,
      [grant.grantId],
    );

    expect(state.rows).toEqual([
      {
        status: "revoked",
        revoke_reason:
          "Основание для доступа завершено владельцем",
        revoked_at: revokedAt,
      },
    ]);
  });

  it("отклоняет некорректный период, причину, исходное состояние и повтор команды", async () => {
    const actorUserId = await insertUser(
      "Владелец проверки ограничений гранта",
    );
    const customerId = await insertUser(
      "Ученик проверки ограничений гранта",
    );

    await expect(
      insertManualGrant({
        actorUserId,
        customerId,
        periodStart: at,
        periodEnd: at,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insertManualGrant({
        actorUserId,
        customerId,
        periodStart: at,
        periodEnd: new Date(at.getTime() + 60_000),
        grantReason: "Коротко",
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const validGrant = await insertManualGrant({
      actorUserId,
      customerId,
      periodStart: at,
      periodEnd: new Date(at.getTime() + 60_000),
    });

    await expect(
      pool.query(
        `
          INSERT INTO access_manual_grants (
            id,
            customer_id,
            status,
            period_start,
            period_end,
            grant_reason,
            granted_by_user_id,
            granted_at,
            command_execution_id,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            'granted',
            $3,
            $4,
            'Повтор той же команды для другого гранта запрещён',
            $5,
            $3,
            $6,
            $3,
            $3
          )
        `,
        [
          randomUUID(),
          customerId,
          at,
          new Date(at.getTime() + 60_000),
          actorUserId,
          validGrant.commandId,
        ],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const revokedCommandId = await insertSucceededGrantCommand(
      actorUserId,
      customerId,
      at,
    );

    await expect(
      pool.query(
        `
          INSERT INTO access_manual_grants (
            id,
            customer_id,
            status,
            period_start,
            period_end,
            grant_reason,
            granted_by_user_id,
            granted_at,
            revoked_by_user_id,
            revoke_reason,
            revoked_at,
            command_execution_id,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            'revoked',
            $3,
            $4,
            'Попытка создать грант сразу отозванным',
            $5,
            $3,
            $5,
            'Исходное отозванное состояние запрещено',
            $3,
            $6,
            $3,
            $3
          )
        `,
        [
          randomUUID(),
          customerId,
          at,
          new Date(at.getTime() + 60_000),
          actorUserId,
          revokedCommandId,
        ],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
