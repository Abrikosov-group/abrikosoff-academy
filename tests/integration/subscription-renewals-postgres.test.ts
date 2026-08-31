import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { processSubscriptionRenewals } from "../../scripts/lib/subscription-renewals.mjs";
import { PaymentService } from "@/modules/billing/application/payment-service";
import { PaymentProviderRouter } from "@/modules/billing/application/provider-router";
import {
  getSubscriptionSummary,
  PostgresPaymentRepository,
  setSubscriptionRenewal,
} from "@/modules/billing/infrastructure/postgres-payment-repository";
import { YooKassaPaymentProvider } from "@/modules/billing/infrastructure/providers/yookassa-payment-provider";

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
      payment_events: string;
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
          ) AS attempts,
          (
            SELECT count(*)
            FROM billing_payment_events events
            JOIN billing_payments payments ON payments.id = events.payment_id
            JOIN billing_orders orders ON orders.id = payments.order_id
            WHERE orders.subscription_id = $1
          ) AS payment_events
      `,
      [fixture.subscriptionId],
    );

    expect(subscription).toMatchObject({
      status: "active",
      autoRenew: true,
      currentPeriodEnd: "2042-02-28T10:00:00.000Z",
    });
    expect(counts.rows[0]).toEqual({
      orders: "1",
      grants: "1",
      attempts: "1",
      payment_events: "1",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, dueAt);
  });

  it("не повторяет POST после HTTP 5xx ни за пределами окна идемпотентности, ни на границе льготы", async () => {
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
    const unavailableProvider = vi.fn().mockResolvedValue(
      Response.json(
        { type: "error", description: "Тестовый HTTP 503" },
        { status: 503 },
      ),
    );

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
          now: () => new Date(dueAt.getTime() + 60 * 60_000),
          batchSize: 25,
          fetchImplementation: unavailableProvider,
        }),
      ).resolves.toEqual({
        processed: 0,
        succeeded: 0,
        rescheduled: 0,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(dueAt.getTime() + 25 * 60 * 60_000),
          batchSize: 25,
          fetchImplementation: unavailableProvider,
        }),
      ).resolves.toEqual({
        processed: 0,
        succeeded: 0,
        rescheduled: 0,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000),
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
      attempt_status: string;
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
            SELECT status
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
          ) AS attempt_status
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      orders: "1",
      attempts: "1",
      attempt_status: "reconciliation_required",
    });
    expect(unavailableProvider).toHaveBeenCalledTimes(1);
    await setSubscriptionRenewal(
      pool,
      fixture.userId,
      false,
      new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000),
    );
  });

  it("восстанавливает точную вторую попытку после отказа первой и неопределённого ответа второй", async () => {
    const dueAt = new Date("2043-01-15T10:00:00.000Z");
    const retryAt = new Date(dueAt.getTime() + 60 * 60_000);
    const webhookAt = new Date(dueAt.getTime() + 8 * 24 * 60 * 60_000);
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
          id: "renewal-first-canceled",
          status: "canceled",
          created_at: dueAt.toISOString(),
          payment_method: {
            id: `method-${fixture.userId}`,
            saved: true,
          },
        }),
      )
      .mockRejectedValueOnce(
        new Error("Соединение оборвалось после принятия второго платежа"),
      );

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: fetchProvider,
      });
      await processSubscriptionRenewals(client, {
        now: () => retryAt,
        batchSize: 1,
        fetchImplementation: fetchProvider,
      });
      await processSubscriptionRenewals(client, {
        now: () => webhookAt,
        batchSize: 1,
        fetchImplementation: fetchProvider,
      });

      const renewal = await pool.query<{
        order_id: string;
        attempt_id: string;
      }>(
        `
          SELECT order_id, id AS attempt_id
          FROM billing_subscription_renewal_attempts
          WHERE subscription_id = $1 AND attempt_number = 2
        `,
        [fixture.subscriptionId],
      );
      const orderId = renewal.rows[0].order_id;
      const attemptId = renewal.rows[0].attempt_id;
      const externalPaymentId = "late-renewal-payment";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () =>
          Response.json({
            id: externalPaymentId,
            status: "succeeded",
            amount: { value: "1500.00", currency: "RUB" },
            captured_at: webhookAt.toISOString(),
            metadata: {
              internal_order_id: orderId,
              renewal_attempt_id: attemptId,
            },
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      );
      const provider = new YooKassaPaymentProvider({
        shopId: "integration-shop",
        secretKey: "integration-secret",
        merchantAccountId: "renewal-test",
      });
      const service = new PaymentService({
        repository: new PostgresPaymentRepository(pool, () => webhookAt),
        router: new PaymentProviderRouter({
          providers: [provider],
          routes: [],
        }),
      });
      const rawBody = JSON.stringify({
        type: "notification",
        event: "payment.succeeded",
        object: { id: externalPaymentId, status: "succeeded" },
      });

      await expect(
        service.handleWebhook("yookassa", rawBody, new Headers()),
      ).resolves.toMatchObject({ outcome: "applied" });
      await expect(
        service.handleWebhook("yookassa", rawBody, new Headers()),
      ).resolves.toMatchObject({ outcome: "duplicate" });

      const counts = await pool.query<{
        payments: string;
        grants: string;
        payment_events: string;
        recovered_payment_events: string;
        attempt_statuses: string[];
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
              SELECT count(*)
              FROM billing_payment_events events
              JOIN billing_payments payments ON payments.id = events.payment_id
              JOIN billing_orders orders ON orders.id = payments.order_id
              WHERE orders.subscription_id = $1
            ) AS payment_events,
            (
              SELECT count(*)
              FROM billing_payment_events events
              JOIN billing_payments payments ON payments.id = events.payment_id
              WHERE payments.provider_operation_key = (
                SELECT idempotency_key
                FROM billing_subscription_renewal_attempts
                WHERE id = $2
              )
            ) AS recovered_payment_events,
            ARRAY(
              SELECT status
              FROM billing_subscription_renewal_attempts
              WHERE subscription_id = $1
              ORDER BY attempt_number
            ) AS attempt_statuses
        `,
        [fixture.subscriptionId, attemptId],
      );

      expect(counts.rows[0]).toEqual({
        payments: "2",
        grants: "1",
        payment_events: "2",
        recovered_payment_events: "1",
        attempt_statuses: ["canceled", "succeeded"],
      });
      expect(fetchProvider).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
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

  it("сериализует worker и поздний webhook в один согласованный результат", async () => {
    const dueAt = new Date("2043-02-15T10:00:00.000Z");
    const retryAt = new Date(dueAt.getTime() + 15 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const externalPaymentId = "worker-webhook-race-payment";

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: vi.fn().mockResolvedValue(
          Response.json({
            id: externalPaymentId,
            status: "pending",
            created_at: dueAt.toISOString(),
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () =>
          Response.json({
            id: externalPaymentId,
            status: "succeeded",
            amount: { value: "1500.00", currency: "RUB" },
            captured_at: retryAt.toISOString(),
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      );
      const provider = new YooKassaPaymentProvider({
        shopId: "integration-shop",
        secretKey: "integration-secret",
        merchantAccountId: "renewal-test",
      });
      const service = new PaymentService({
        repository: new PostgresPaymentRepository(pool, () => retryAt),
        router: new PaymentProviderRouter({
          providers: [provider],
          routes: [],
        }),
      });
      const rawBody = JSON.stringify({
        type: "notification",
        event: "payment.succeeded",
        object: { id: externalPaymentId, status: "succeeded" },
      });
      const workerFetch = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({
          id: externalPaymentId,
          status: "pending",
          created_at: dueAt.toISOString(),
          payment_method: {
            id: `method-${fixture.userId}`,
            saved: true,
          },
        });
      });

      await Promise.all([
        processSubscriptionRenewals(client, {
          now: () => retryAt,
          batchSize: 1,
          fetchImplementation: workerFetch,
        }),
        service.handleWebhook("yookassa", rawBody, new Headers()),
      ]);
    } finally {
      vi.unstubAllGlobals();
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    const result = await pool.query<{
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

    expect(result.rows[0]).toEqual({
      payments: "1",
      grants: "1",
      attempt_status: "succeeded",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, retryAt);
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
      payment_events: string;
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
          ) AS attempt_status,
          (
            SELECT count(*)
            FROM billing_payment_events events
            JOIN billing_payments payments ON payments.id = events.payment_id
            JOIN billing_orders orders ON orders.id = payments.order_id
            WHERE orders.subscription_id = $1
          ) AS payment_events
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      payments: "1",
      grants: "1",
      attempt_status: "succeeded",
      payment_events: "2",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
  });

  it("закрывает поздно отменённую попытку и планирует отдельную следующую", async () => {
    const dueAt = new Date("2043-03-15T10:00:00.000Z");
    const webhookAt = new Date(dueAt.getTime() + 30 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const fetchProvider = vi.fn().mockRejectedValue(
      new Error("Соединение оборвалось после принятия платежа"),
    );

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: fetchProvider,
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    const renewal = await pool.query<{ id: string; order_id: string }>(
      `
        SELECT id, order_id
        FROM billing_subscription_renewal_attempts
        WHERE subscription_id = $1 AND attempt_number = 1
      `,
      [fixture.subscriptionId],
    );
    const externalPaymentId = "late-canceled-renewal";

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () =>
          Response.json({
            id: externalPaymentId,
            status: "canceled",
            amount: { value: "1500.00", currency: "RUB" },
            created_at: webhookAt.toISOString(),
            metadata: {
              internal_order_id: renewal.rows[0].order_id,
              renewal_attempt_id: renewal.rows[0].id,
            },
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      );
      const provider = new YooKassaPaymentProvider({
        shopId: "integration-shop",
        secretKey: "integration-secret",
        merchantAccountId: "renewal-test",
      });
      const service = new PaymentService({
        repository: new PostgresPaymentRepository(pool, () => webhookAt),
        router: new PaymentProviderRouter({
          providers: [provider],
          routes: [],
        }),
      });
      const rawBody = JSON.stringify({
        type: "notification",
        event: "payment.canceled",
        object: { id: externalPaymentId, status: "canceled" },
      });

      await expect(
        service.handleWebhook("yookassa", rawBody, new Headers()),
      ).resolves.toMatchObject({ outcome: "applied" });
      await expect(
        service.handleWebhook("yookassa", rawBody, new Headers()),
      ).resolves.toMatchObject({ outcome: "duplicate" });
    } finally {
      vi.unstubAllGlobals();
    }

    const counts = await pool.query<{
      order_status: string;
      payments: string;
      grants: string;
      payment_events: string;
      attempt_numbers: number[];
      attempt_statuses: string[];
    }>(
      `
        SELECT
          (
            SELECT status
            FROM billing_orders
            WHERE subscription_id = $1 AND renewal_sequence = 1
          ) AS order_status,
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
            SELECT count(*)
            FROM billing_payment_events events
            JOIN billing_payments payments ON payments.id = events.payment_id
            JOIN billing_orders orders ON orders.id = payments.order_id
            WHERE orders.subscription_id = $1
          ) AS payment_events,
          ARRAY(
            SELECT attempt_number
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
            ORDER BY attempt_number
          ) AS attempt_numbers,
          ARRAY(
            SELECT status
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
            ORDER BY attempt_number
          ) AS attempt_statuses
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      order_status: "pending",
      payments: "1",
      grants: "0",
      payment_events: "1",
      attempt_numbers: [1, 2],
      attempt_statuses: ["canceled", "retry_scheduled"],
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
  });

  it("отключает будущие списания, но принимает поздний успех уже отправленной попытки", async () => {
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
    const renewal = await pool.query<{
      id: string;
      order_id: string;
      status: string;
    }>(
      `
        SELECT id, order_id, status
        FROM billing_subscription_renewal_attempts
        WHERE subscription_id = $1
      `,
      [fixture.subscriptionId],
    );
    expect(renewal.rows).toMatchObject([
      { status: "reconciliation_required" },
    ]);

    const webhookAt = new Date(dueAt.getTime() + 3 * 60 * 60_000);
    const externalPaymentId = "late-success-after-renewal-disabled";

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            id: externalPaymentId,
            status: "succeeded",
            amount: { value: "1500.00", currency: "RUB" },
            captured_at: webhookAt.toISOString(),
            metadata: {
              internal_order_id: renewal.rows[0].order_id,
              renewal_attempt_id: renewal.rows[0].id,
            },
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      );
      const provider = new YooKassaPaymentProvider({
        shopId: "integration-shop",
        secretKey: "integration-secret",
        merchantAccountId: "renewal-test",
      });
      const service = new PaymentService({
        repository: new PostgresPaymentRepository(pool, () => webhookAt),
        router: new PaymentProviderRouter({
          providers: [provider],
          routes: [],
        }),
      });
      const rawBody = JSON.stringify({
        type: "notification",
        event: "payment.succeeded",
        object: { id: externalPaymentId, status: "succeeded" },
      });

      await expect(
        service.handleWebhook("yookassa", rawBody, new Headers()),
      ).resolves.toMatchObject({ outcome: "applied" });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(await getSubscriptionSummary(pool, fixture.userId)).toMatchObject({
      status: "active",
      autoRenew: false,
      cancelAtPeriodEnd: true,
    });
    await expect(
      pool.query(
        `
          SELECT status
          FROM billing_subscription_renewal_attempts
          WHERE subscription_id = $1
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "succeeded" }] });
  });

  it("завершает льготу с известным pending без нового POST и без повторного события", async () => {
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
    const unavailableProvider = vi.fn().mockResolvedValue(
      Response.json({
        id: "pending-at-grace-boundary",
        status: "pending",
        created_at: dueAt.toISOString(),
        payment_method: {
          id: `method-${fixture.userId}`,
          saved: true,
        },
      }),
    );

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
      autoRenew: true,
      cancelAtPeriodEnd: false,
    });
    expect(unavailableProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
    ]);
    await expect(
      pool.query<{
        status: string;
        expired_events: string;
      }>(
        `
          SELECT
            attempts.status,
            (
              SELECT count(*)
              FROM billing_subscription_events events
              WHERE events.subscription_id = $1
                AND events.event_type = 'subscription.expired'
            ) AS expired_events
          FROM billing_subscription_renewal_attempts attempts
          WHERE attempts.subscription_id = $1
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: "reconciliation_required", expired_events: "1" }],
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, graceEnd);
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
