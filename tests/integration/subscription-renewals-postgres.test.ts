import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { processSubscriptionRenewals } from "../../scripts/lib/subscription-renewals.mjs";
import {
  getSubscriptionSummary,
  PostgresPaymentRepository,
  setSubscriptionRenewal,
} from "@/modules/billing/infrastructure/postgres-payment-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

const pool = new Pool({
  connectionString: testDatabaseUrl,
  application_name: "academy-subscription-renewals-integration-tests",
  max: 2,
});

async function createRecurringSubscription(input: {
  provider: "demo" | "yookassa";
  periodEnd: Date;
}) {
  const userId = randomUUID();
  const orderId = randomUUID();
  const mandateId = randomUUID();
  const subscriptionId = randomUUID();
  const acceptedAt = new Date(input.periodEnd.getTime() - 31 * 86_400_000);

  await pool.query(
    `
      INSERT INTO identity_users (id, display_name, receipt_email)
      VALUES ($1, 'Проверка автопродления', $2)
    `,
    [userId, `renewal-${userId}@example.test`],
  );
  await pool.query(
    `
      INSERT INTO billing_orders (
        id, customer_id, plan_id, legal_entity_id, country_code,
        amount_minor, currency, status, idempotency_key,
        selected_provider, merchant_account_id, billing_mode,
        renewal_sequence, offer_accepted_at, offer_version,
        recurring_consent_accepted_at, recurring_consent_offer_version,
        receipt_email
      )
      VALUES (
        $1, $2, 'monthly', 'ip-fedotova', 'RU', 150000, 'RUB', 'paid',
        $3, $4, 'renewal-test', 'recurring', 0, $5, '2026-08-31',
        $5, '2026-08-31', $6
      )
    `,
    [
      orderId,
      userId,
      `initial-${orderId}`,
      input.provider,
      acceptedAt,
      `renewal-${userId}@example.test`,
    ],
  );
  await pool.query(
    `
      INSERT INTO billing_payment_mandates (
        id, customer_id, provider, merchant_account_id,
        provider_payment_method_token, status, consent_accepted_at,
        consent_offer_version, activated_at
      )
      VALUES ($1, $2, $3, 'renewal-test', $4, 'active', $5, '2026-08-31', $5)
    `,
    [mandateId, userId, input.provider, `method-${userId}`, acceptedAt],
  );
  await pool.query(
    `
      INSERT INTO billing_subscriptions (
        id, customer_id, plan_id, status, current_period_start,
        current_period_end, auto_renew, mandate_id,
        activated_by_order_id, cancel_at_period_end, renewal_due_at
      )
      VALUES (
        $1, $2, 'monthly', 'active', $3, $4, true, $5, $6, false, $4
      )
    `,
    [subscriptionId, userId, acceptedAt, input.periodEnd, mandateId, orderId],
  );

  return { userId, subscriptionId, periodEnd: input.periodEnd };
}

afterAll(async () => {
  await pool.end();
});

describe("автоматическое продление подписок с PostgreSQL", () => {
  it("идемпотентно создаёт новый оплаченный период", async () => {
    const dueAt = new Date("2042-01-31T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "demo",
      periodEnd: dueAt,
    });
    const client = await pool.connect();

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 5,
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 1,
        rescheduled: 0,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 5,
        }),
      ).resolves.toEqual({
        processed: 0,
        succeeded: 0,
        rescheduled: 0,
        failed: 0,
      });
    } finally {
      client.release();
    }

    const subscription = await getSubscriptionSummary(pool, fixture.userId);
    const counts = await pool.query<{
      orders: string;
      grants: string;
      attempts: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM billing_orders WHERE subscription_id = $1) AS orders,
          (
            SELECT count(*)
            FROM billing_access_grants grants
            JOIN billing_orders orders ON orders.id = grants.order_id
            WHERE orders.subscription_id = $1
          ) AS grants,
          (
            SELECT count(*)
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempts
      `,
      [fixture.subscriptionId],
    );

    expect(subscription).toMatchObject({
      status: "active",
      autoRenew: true,
      currentPeriodEnd: "2042-02-28T10:00:00.000Z",
    });
    expect(counts.rows[0]).toEqual({ orders: "1", grants: "1", attempts: "1" });
    await setSubscriptionRenewal(pool, fixture.userId, false, dueAt);
  });

  it("не создаёт вторую операцию после временного отказа", async () => {
    const dueAt = new Date("2043-01-01T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const unavailableProvider = vi
      .fn()
      .mockRejectedValue(new Error("Тестовый временный отказ провайдера"));

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 25,
          fetchImplementation: unavailableProvider,
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 0,
        rescheduled: 1,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(dueAt.getTime() + 15 * 60_000),
          batchSize: 25,
          fetchImplementation: unavailableProvider,
        }),
      ).resolves.toEqual({
        processed: 0,
        succeeded: 0,
        rescheduled: 0,
        failed: 0,
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    const counts = await pool.query<{
      orders: string;
      attempts: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM billing_orders WHERE subscription_id = $1) AS orders,
          (
            SELECT count(*)
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempts
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({ orders: "1", attempts: "1" });
    expect(unavailableProvider).toHaveBeenCalledTimes(1);
    await setSubscriptionRenewal(
      pool,
      fixture.userId,
      false,
      new Date(dueAt.getTime() + 15 * 60_000),
    );
  });

  it("сериализует параллельные worker для одного периода", async () => {
    const dueAt = new Date("2043-02-01T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "demo",
      periodEnd: dueAt,
    });
    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    let results;

    try {
      results = await Promise.all([
        processSubscriptionRenewals(firstClient, {
          now: () => dueAt,
          batchSize: 25,
        }),
        processSubscriptionRenewals(secondClient, {
          now: () => dueAt,
          batchSize: 25,
        }),
      ]);
    } finally {
      firstClient.release();
      secondClient.release();
    }

    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    const counts = await pool.query<{
      orders: string;
      attempts: string;
      grants: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM billing_orders WHERE subscription_id = $1) AS orders,
          (
            SELECT count(*)
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempts,
          (
            SELECT count(*)
            FROM billing_access_grants grants
            JOIN billing_orders orders ON orders.id = grants.order_id
            WHERE orders.subscription_id = $1
          ) AS grants
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      orders: "1",
      attempts: "1",
      grants: "1",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, dueAt);
  });

  it("сохраняет pending и продолжает его через GET без второго POST", async () => {
    const dueAt = new Date("2043-03-01T10:00:00.000Z");
    const afterIdempotencyWindow = new Date(
      dueAt.getTime() + 25 * 60 * 60_000,
    );
    const webhookAt = new Date(afterIdempotencyWindow.getTime() + 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const fetchProvider = vi.fn().mockResolvedValue(
      Response.json({
        id: "pending-renewal-payment",
        status: "pending",
        created_at: dueAt.toISOString(),
        payment_method: {
          id: `method-${fixture.userId}`,
          saved: true,
        },
      }),
    );

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 25,
          fetchImplementation: fetchProvider,
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 0,
        rescheduled: 1,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => afterIdempotencyWindow,
          batchSize: 25,
          fetchImplementation: fetchProvider,
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 0,
        rescheduled: 1,
        failed: 0,
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    expect(fetchProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "GET",
    ]);
    expect(fetchProvider.mock.calls[1]?.[0]).toBe(
      "https://api.yookassa.ru/v3/payments/pending-renewal-payment",
    );

    const paymentRepository = new PostgresPaymentRepository(
      pool,
      () => webhookAt,
    );
    await expect(
      paymentRepository.applyPaymentEvent({
        provider: "yookassa",
        merchantAccountId: "renewal-test",
        externalEventId: "pending-renewal-succeeded",
        eventType: "payment.succeeded",
        externalPaymentId: "pending-renewal-payment",
        status: "succeeded",
        occurredAt: webhookAt.toISOString(),
        payloadSha256: "d".repeat(64),
        payload: { event: "payment.succeeded" },
      }),
    ).resolves.toMatchObject({ outcome: "applied" });

    const counts = await pool.query<{
      payments: string;
      grants: string;
      attempt_status: string;
    }>(
      `
        SELECT
          (
            SELECT count(*)
            FROM billing_payments payments
            JOIN billing_orders orders ON orders.id = payments.order_id
            WHERE orders.subscription_id = $1
          ) AS payments,
          (
            SELECT count(*)
            FROM billing_access_grants grants
            JOIN billing_orders orders ON orders.id = grants.order_id
            WHERE orders.subscription_id = $1
          ) AS grants,
          (
            SELECT status
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempt_status
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      payments: "1",
      grants: "1",
      attempt_status: "succeeded",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
  });

  it("создаёт отдельную финансовую попытку после подтверждённого отказа", async () => {
    const dueAt = new Date("2043-03-15T10:00:00.000Z");
    const retryAt = new Date(dueAt.getTime() + 60 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const fetchProvider = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "renewal-canceled-first",
          status: "canceled",
          created_at: dueAt.toISOString(),
          payment_method: {
            id: `method-${fixture.userId}`,
            saved: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "renewal-succeeded-second",
          status: "succeeded",
          captured_at: retryAt.toISOString(),
          payment_method: {
            id: `method-${fixture.userId}`,
            saved: true,
          },
        }),
      );

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 25,
          fetchImplementation: fetchProvider,
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 0,
        rescheduled: 1,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => retryAt,
          batchSize: 25,
          fetchImplementation: fetchProvider,
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 1,
        rescheduled: 0,
        failed: 0,
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    const operationKeys = fetchProvider.mock.calls.map(
      (call) => call[1]?.headers?.["Idempotence-Key"],
    );
    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[0]).not.toBe(operationKeys[1]);

    const counts = await pool.query<{
      orders: string;
      payments: string;
      grants: string;
      attempt_number: number;
      attempt_status: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM billing_orders WHERE subscription_id = $1) AS orders,
          (
            SELECT count(*)
            FROM billing_payments payments
            JOIN billing_orders orders ON orders.id = payments.order_id
            WHERE orders.subscription_id = $1
          ) AS payments,
          (
            SELECT count(*)
            FROM billing_access_grants grants
            JOIN billing_orders orders ON orders.id = grants.order_id
            WHERE orders.subscription_id = $1
          ) AS grants,
          (
            SELECT attempt_number
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempt_number,
          (
            SELECT status
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempt_status
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      orders: "1",
      payments: "2",
      grants: "1",
      attempt_number: 2,
      attempt_status: "succeeded",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, retryAt);
  });

  it("отключает продление во время льготного периода", async () => {
    const dueAt = new Date("2043-04-01T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const unavailableProvider = vi
      .fn()
      .mockRejectedValue(new Error("Тестовый временный отказ провайдера"));

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: unavailableProvider,
      });
      const disabled = await setSubscriptionRenewal(
        pool,
        fixture.userId,
        false,
        new Date(dueAt.getTime() + 5 * 60_000),
      );

      expect(disabled).toMatchObject({
        status: "grace_period",
        autoRenew: false,
        cancelAtPeriodEnd: true,
        gracePeriodEnd: new Date(
          dueAt.getTime() + 7 * 24 * 60 * 60_000,
        ).toISOString(),
      });

      unavailableProvider.mockClear();
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(dueAt.getTime() + 2 * 60 * 60_000),
          batchSize: 25,
          fetchImplementation: unavailableProvider,
        }),
      ).resolves.toEqual({
        processed: 0,
        succeeded: 0,
        rescheduled: 0,
        failed: 0,
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    expect(unavailableProvider).not.toHaveBeenCalled();
    await expect(
      pool.query(
        `
          SELECT status
          FROM billing_subscription_renewal_attempts
          WHERE subscription_id = $1
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "canceled" }] });
  });

  it("сохраняет доступ семь дней при временной ошибке и затем завершает льготу", async () => {
    const dueAt = new Date("2042-03-01T10:00:00.000Z");
    const graceEnd = new Date("2042-03-08T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const unavailableProvider = async () => {
      throw new Error("Тестовый временный отказ провайдера");
    };

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: unavailableProvider,
      });

      expect(await getSubscriptionSummary(pool, fixture.userId)).toMatchObject({
        status: "grace_period",
        autoRenew: true,
        gracePeriodEnd: graceEnd.toISOString(),
      });

      await processSubscriptionRenewals(client, {
        now: () => graceEnd,
        batchSize: 1,
        fetchImplementation: unavailableProvider,
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    expect(await getSubscriptionSummary(pool, fixture.userId)).toMatchObject({
      status: "past_due",
      autoRenew: false,
      cancelAtPeriodEnd: true,
    });
  });

  it("отключает следующее списание и сохраняет оплаченный срок", async () => {
    const periodEnd = new Date("2042-06-01T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "demo",
      periodEnd,
    });

    const disabled = await setSubscriptionRenewal(
      pool,
      fixture.userId,
      false,
      new Date("2042-05-01T10:00:00.000Z"),
    );

    expect(disabled).toMatchObject({
      status: "active",
      currentPeriodEnd: periodEnd.toISOString(),
      autoRenew: false,
      cancelAtPeriodEnd: true,
      recurringAvailable: true,
    });
  });
});
