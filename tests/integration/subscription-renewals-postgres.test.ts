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

  return {
    userId,
    subscriptionId,
    mandateId,
    periodEnd: input.periodEnd,
  };
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

  it("возобновляет автопродление во время действующей льготы", async () => {
    const dueAt = new Date("2042-02-28T10:00:00.000Z");
    const reenabledAt = new Date(dueAt.getTime() + 60 * 60_000);
    const graceEnd = new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "demo",
      periodEnd: dueAt,
    });

    await pool.query(
      `
        UPDATE billing_subscriptions
        SET
          status = 'grace_period',
          auto_renew = false,
          cancel_at_period_end = true,
          canceled_at = $2,
          renewal_due_at = NULL
        WHERE id = $1
      `,
      [fixture.subscriptionId, dueAt],
    );
    await pool.query(
      `
        INSERT INTO billing_access_grace_periods (
          subscription_id, customer_id, status, period_start, period_end
        )
        VALUES ($1, $2, 'active', $3, $4)
      `,
      [fixture.subscriptionId, fixture.userId, dueAt, graceEnd],
    );

    try {
      await expect(
        setSubscriptionRenewal(pool, fixture.userId, true, reenabledAt),
      ).resolves.toMatchObject({
        status: "grace_period",
        autoRenew: true,
        cancelAtPeriodEnd: false,
        renewalDueAt: dueAt.toISOString(),
        gracePeriodEnd: graceEnd.toISOString(),
      });

      const client = await pool.connect();
      try {
        await expect(
          processSubscriptionRenewals(client, {
            now: () => reenabledAt,
            batchSize: 1,
          }),
        ).resolves.toEqual({
          processed: 1,
          succeeded: 1,
          rescheduled: 0,
          failed: 0,
        });
      } finally {
        client.release();
      }

      await expect(
        getSubscriptionSummary(pool, fixture.userId),
      ).resolves.toMatchObject({
        status: "active",
        autoRenew: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2042-03-28T10:00:00.000Z",
      });
      await expect(
        pool.query<{ status: string }>(
          `
            SELECT status
            FROM billing_access_grace_periods
            WHERE subscription_id = $1
          `,
          [fixture.subscriptionId],
        ),
      ).resolves.toMatchObject({ rows: [{ status: "revoked" }] });
    } finally {
      await setSubscriptionRenewal(
        pool,
        fixture.userId,
        false,
        reenabledAt,
      );
    }
  });

  it("сохраняет новый токен способа оплаты в активном мандате", async () => {
    const dueAt = new Date("2042-02-28T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    const updatedPaymentMethodToken = `updated-method-${fixture.userId}`;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 1,
          fetchImplementation: vi.fn().mockResolvedValue(
            Response.json({
              id: "renewal-with-updated-payment-method",
              status: "succeeded",
              captured_at: dueAt.toISOString(),
              payment_method: {
                id: updatedPaymentMethodToken,
                saved: true,
              },
            }),
          ),
        }),
      ).resolves.toMatchObject({ succeeded: 1 });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    await expect(
      pool.query<{
        provider_payment_method_token: string;
        last_used_at: Date;
      }>(
        `
          SELECT
            mandates.provider_payment_method_token,
            mandates.last_used_at
          FROM billing_subscriptions subscriptions
          JOIN billing_payment_mandates mandates
            ON mandates.id = subscriptions.mandate_id
          WHERE subscriptions.id = $1
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          provider_payment_method_token: updatedPaymentMethodToken,
          last_used_at: dueAt,
        },
      ],
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, dueAt);
  });

  it("сохраняет успешный платёж при конфликте мандата", async () => {
    const dueAt = new Date("2042-03-01T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    const externalPaymentId = "renewal-with-revoked-mandate";
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 1,
          fetchImplementation: vi.fn().mockImplementation(async () => {
            await pool.query(
              `
                UPDATE billing_payment_mandates
                SET status = 'revoked', revoked_at = $2, updated_at = now()
                WHERE id = $1
              `,
              [fixture.mandateId, dueAt],
            );

            return Response.json({
              id: externalPaymentId,
              status: "succeeded",
              captured_at: dueAt.toISOString(),
              payment_method: {
                id: `replacement-${fixture.userId}`,
                saved: true,
              },
            });
          }),
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 1,
        rescheduled: 0,
        failed: 0,
      });

      await expect(
        pool.query<{
          payment_status: string;
          external_payment_id: string;
          order_status: string;
          attempt_status: string;
          subscription_status: string;
          auto_renew: boolean;
          cancel_at_period_end: boolean;
          renewal_error_code: string;
          grants: string;
        }>(
          `
            SELECT
              payments.status AS payment_status,
              payments.external_payment_id,
              orders.status AS order_status,
              attempts.status AS attempt_status,
              subscriptions.status AS subscription_status,
              subscriptions.auto_renew,
              subscriptions.cancel_at_period_end,
              subscriptions.renewal_error_code,
              (
                SELECT count(*)
                FROM billing_access_grants grants
                WHERE grants.order_id = orders.id
                  AND grants.status = 'granted'
              ) AS grants
            FROM billing_subscription_renewal_attempts attempts
            JOIN billing_orders orders ON orders.id = attempts.order_id
            JOIN billing_payments payments ON payments.order_id = orders.id
            JOIN billing_subscriptions subscriptions
              ON subscriptions.id = attempts.subscription_id
            WHERE attempts.subscription_id = $1
          `,
          [fixture.subscriptionId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            payment_status: "succeeded",
            external_payment_id: externalPaymentId,
            order_status: "paid",
            attempt_status: "succeeded",
            subscription_status: "active",
            auto_renew: false,
            cancel_at_period_end: true,
            renewal_error_code: "PAYMENT_METHOD_NOT_SAVED",
            grants: "1",
          },
        ],
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
      await setSubscriptionRenewal(pool, fixture.userId, false, dueAt);
    }
  });

  it("сохраняет полный возврат при позднем успехе той же попытки", async () => {
    const dueAt = new Date("2042-02-01T10:00:00.000Z");
    const refundAt = new Date(dueAt.getTime() + 60 * 60_000);
    const lateWebhookAt = new Date(refundAt.getTime() + 60 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const externalPaymentId = "refunded-renewal-with-late-success";

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: vi.fn().mockResolvedValue(
          Response.json({
            id: externalPaymentId,
            status: "succeeded",
            captured_at: dueAt.toISOString(),
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    const renewal = await pool.query<{
      id: string;
      order_id: string;
    }>(
      `
        SELECT id, order_id
        FROM billing_subscription_renewal_attempts
        WHERE subscription_id = $1 AND attempt_number = 1
      `,
      [fixture.subscriptionId],
    );
    const refundRepository = new PostgresPaymentRepository(
      pool,
      () => refundAt,
    );

    await expect(
      refundRepository.applyRefundEvent({
        provider: "yookassa",
        merchantAccountId: "renewal-test",
        externalEventId: "full-refund-before-late-renewal-success",
        eventType: "refund.succeeded",
        externalPaymentId,
        externalRefundId: "full-refund-renewal-payment",
        status: "succeeded",
        money: { amountMinor: 150_000, currency: "RUB" },
        occurredAt: refundAt.toISOString(),
        payloadSha256: "8".repeat(64),
        payload: { event: "refund.succeeded" },
      }),
    ).resolves.toMatchObject({
      outcome: "applied",
      checkout: { status: "refunded" },
    });

    const lateRepository = new PostgresPaymentRepository(
      pool,
      () => lateWebhookAt,
    );
    const lateEvent = {
      provider: "yookassa" as const,
      merchantAccountId: "renewal-test",
      externalEventId: "late-success-after-full-renewal-refund",
      eventType: "payment.succeeded",
      externalPaymentId,
      status: "succeeded" as const,
      paymentMethodToken: `method-${fixture.userId}`,
      paymentMethodSaved: true,
      occurredAt: lateWebhookAt.toISOString(),
      payloadSha256: "9".repeat(64),
      payload: { event: "payment.succeeded" },
      internalOrderId: renewal.rows[0].order_id,
      internalRenewalAttemptId: renewal.rows[0].id,
      money: { amountMinor: 150_000, currency: "RUB" as const },
    };

    await expect(
      lateRepository.applyRecoveredRenewalPaymentEvent(lateEvent),
    ).resolves.toMatchObject({
      outcome: "applied",
      checkout: { status: "refunded" },
    });
    await expect(
      lateRepository.applyRecoveredRenewalPaymentEvent(lateEvent),
    ).resolves.toMatchObject({
      outcome: "duplicate",
      checkout: { status: "refunded" },
    });

    await expect(
      pool.query<{
        payment_status: string;
        order_status: string;
        grant_status: string;
        subscription_status: string;
        payment_events: string;
        subscription_events: string;
        grants: string;
      }>(
        `
          SELECT
            payments.status AS payment_status,
            orders.status AS order_status,
            grants.status AS grant_status,
            subscriptions.status AS subscription_status,
            (
              SELECT count(*)
              FROM billing_payment_events
              WHERE payment_id = payments.id
            ) AS payment_events,
            (
              SELECT count(*)
              FROM billing_subscription_events
              WHERE subscription_id = subscriptions.id
            ) AS subscription_events,
            (
              SELECT count(*)
              FROM billing_access_grants
              WHERE order_id = orders.id
            ) AS grants
          FROM billing_orders orders
          JOIN billing_payments payments ON payments.order_id = orders.id
          JOIN billing_access_grants grants ON grants.order_id = orders.id
          JOIN billing_subscriptions subscriptions
            ON subscriptions.id = orders.subscription_id
          WHERE orders.id = $1
        `,
        [renewal.rows[0].order_id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          payment_status: "refunded",
          order_status: "refunded",
          grant_status: "revoked",
          subscription_status: "canceled",
          payment_events: "2",
          subscription_events: "1",
          grants: "1",
        },
      ],
    });
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

  it("не повторяет POST после принятого ответа и сбоя сохранения", async () => {
    const dueAt = new Date("2043-01-10T10:00:00.000Z");
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const acceptedPayment = vi.fn().mockResolvedValue(
      Response.json({
        id: "accepted-before-db-failure",
        status: "succeeded",
        captured_at: dueAt.toISOString(),
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
          batchSize: 1,
          fetchImplementation: acceptedPayment,
          completeRenewalImplementation: async () => {
            throw new Error("TEST_DB_WRITE_FAILED");
          },
        }),
      ).resolves.toEqual({
        processed: 1,
        succeeded: 0,
        rescheduled: 1,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(dueAt.getTime() + 25 * 60 * 60_000),
          batchSize: 1,
          fetchImplementation: acceptedPayment,
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

    expect(acceptedPayment).toHaveBeenCalledTimes(1);
    await expect(
      pool.query<{
        attempt_status: string;
        subscription_status: string;
        grace_periods: string;
        payments: string;
        grants: string;
      }>(
        `
          SELECT
            (
              SELECT status
              FROM billing_subscription_renewal_attempts
              WHERE subscription_id = $1
            ) AS attempt_status,
            (
              SELECT status
              FROM billing_subscriptions
              WHERE id = $1
            ) AS subscription_status,
            (
              SELECT count(*)
              FROM billing_access_grace_periods
              WHERE subscription_id = $1 AND status = 'active'
            ) AS grace_periods,
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
            ) AS grants
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_status: "reconciliation_required",
          subscription_status: "grace_period",
          grace_periods: "1",
          payments: "0",
          grants: "0",
        },
      ],
    });
    await setSubscriptionRenewal(
      pool,
      fixture.userId,
      false,
      new Date(dueAt.getTime() + 25 * 60 * 60_000),
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

      const firstAttempt = await pool.query<{
        id: string;
        order_id: string;
      }>(
        `
          SELECT id, order_id
          FROM billing_subscription_renewal_attempts
          WHERE subscription_id = $1 AND attempt_number = 1
        `,
        [fixture.subscriptionId],
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () =>
          Response.json({
            id: "renewal-first-canceled",
            status: "canceled",
            amount: { value: "1500.00", currency: "RUB" },
            created_at: dueAt.toISOString(),
            metadata: {
              internal_order_id: firstAttempt.rows[0].order_id,
              renewal_attempt_id: firstAttempt.rows[0].id,
            },
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      );
      await expect(
        service.handleWebhook(
          "yookassa",
          JSON.stringify({
            type: "notification",
            event: "payment.canceled",
            object: { id: "renewal-first-canceled", status: "canceled" },
          }),
          new Headers(),
        ),
      ).resolves.toMatchObject({ outcome: "applied" });

      const counts = await pool.query<{
        order_status: string;
        payments: string;
        grants: string;
        payment_events: string;
        recovered_payment_events: string;
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
        order_status: "paid",
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

  it("завершает известный pending поздней отменой без второго POST", async () => {
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

    const renewal = await pool.query<{ id: string; order_id: string }>(
      `
        SELECT id, order_id
        FROM billing_subscription_renewal_attempts
        WHERE subscription_id = $1 AND attempt_number = 1
      `,
      [fixture.subscriptionId],
    );
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () =>
          Response.json({
            id: "pending-renewal-payment",
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
      const service = new PaymentService({
        repository: new PostgresPaymentRepository(pool, () => webhookAt),
        router: new PaymentProviderRouter({
          providers: [
            new YooKassaPaymentProvider({
              shopId: "integration-shop",
              secretKey: "integration-secret",
              merchantAccountId: "renewal-test",
            }),
          ],
          routes: [],
        }),
      });
      const rawBody = JSON.stringify({
        type: "notification",
        event: "payment.canceled",
        object: { id: "pending-renewal-payment", status: "canceled" },
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
      payments: string;
      grants: string;
      attempt_statuses: string[];
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
          ARRAY(
            SELECT status
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1
            ORDER BY attempt_number
          ) AS attempt_statuses,
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
      grants: "0",
      attempt_statuses: ["canceled", "retry_scheduled"],
      payment_events: "2",
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
  });

  it("сохраняет pending при поздней отмене старой попытки с уже созданным повтором", async () => {
    const dueAt = new Date("2043-03-10T10:00:00.000Z");
    const webhookAt = new Date(dueAt.getTime() + 5 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const externalPaymentId = "old-canceled-renewal-with-open-retry";

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: vi.fn().mockResolvedValue(
          Response.json({
            id: externalPaymentId,
            status: "canceled",
            created_at: dueAt.toISOString(),
            payment_method: {
              id: `method-${fixture.userId}`,
              saved: true,
            },
          }),
        ),
      });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    const renewal = await pool.query<{
      id: string;
      order_id: string;
    }>(
      `
        SELECT id, order_id
        FROM billing_subscription_renewal_attempts
        WHERE subscription_id = $1 AND attempt_number = 1
      `,
      [fixture.subscriptionId],
    );
    const repository = new PostgresPaymentRepository(pool, () => webhookAt);
    const event = {
      provider: "yookassa" as const,
      merchantAccountId: "renewal-test",
      externalEventId: "late-old-canceled-with-open-retry",
      eventType: "payment.canceled",
      externalPaymentId,
      status: "canceled" as const,
      paymentMethodToken: `method-${fixture.userId}`,
      paymentMethodSaved: true,
      occurredAt: webhookAt.toISOString(),
      payloadSha256: "7".repeat(64),
      payload: { event: "payment.canceled" },
      internalOrderId: renewal.rows[0].order_id,
      internalRenewalAttemptId: renewal.rows[0].id,
      money: { amountMinor: 150_000, currency: "RUB" as const },
    };

    await expect(
      repository.applyRecoveredRenewalPaymentEvent(event),
    ).resolves.toMatchObject({ outcome: "applied" });
    await expect(
      repository.applyRecoveredRenewalPaymentEvent(event),
    ).resolves.toMatchObject({ outcome: "duplicate" });

    await expect(
      pool.query<{
        order_status: string;
        attempt_numbers: number[];
        attempt_statuses: string[];
        payment_events: string;
      }>(
        `
          SELECT
            (
              SELECT status
              FROM billing_orders
              WHERE subscription_id = $1 AND renewal_sequence = 1
            ) AS order_status,
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
            ) AS attempt_statuses,
            (
              SELECT count(*)
              FROM billing_payment_events events
              JOIN billing_payments payments ON payments.id = events.payment_id
              JOIN billing_orders orders ON orders.id = payments.order_id
              WHERE orders.subscription_id = $1
            ) AS payment_events
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          order_status: "pending",
          attempt_numbers: [1, 2],
          attempt_statuses: ["canceled", "retry_scheduled"],
          payment_events: "1",
        },
      ],
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
  });

  it("после отмены второй попытки планирует третью через 24 часа", async () => {
    const dueAt = new Date("2043-03-15T10:00:00.000Z");
    const secondAttemptAt = new Date(dueAt.getTime() + 60 * 60_000);
    const webhookAt = new Date(secondAttemptAt.getTime() + 30 * 60_000);
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
          id: "first-canceled-before-late-second",
          status: "canceled",
          created_at: dueAt.toISOString(),
          payment_method: {
            id: `method-${fixture.userId}`,
            saved: true,
          },
        }),
      )
      .mockRejectedValueOnce(
        new Error("Соединение оборвалось после принятия второй попытки"),
      );

    try {
      await processSubscriptionRenewals(client, {
        now: () => dueAt,
        batchSize: 1,
        fetchImplementation: fetchProvider,
      });
      await processSubscriptionRenewals(client, {
        now: () => secondAttemptAt,
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
        WHERE subscription_id = $1 AND attempt_number = 2
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
      third_attempt_at: Date;
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
          ) AS attempt_statuses,
          (
            SELECT next_attempt_at
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1 AND attempt_number = 3
          ) AS third_attempt_at
      `,
      [fixture.subscriptionId],
    );

    expect(counts.rows[0]).toEqual({
      order_status: "pending",
      payments: "2",
      grants: "0",
      payment_events: "2",
      attempt_numbers: [1, 2, 3],
      attempt_statuses: ["canceled", "canceled", "retry_scheduled"],
      third_attempt_at: new Date(webhookAt.getTime() + 24 * 60 * 60_000),
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, webhookAt);
  });

  it("выполняет четвёртую попытку на последнем запуске перед окончанием льготы", async () => {
    const dueAt = new Date("2043-03-20T10:00:00.000Z");
    const secondAttemptAt = new Date(dueAt.getTime() + 60 * 60_000);
    const thirdAttemptAt = new Date(
      secondAttemptAt.getTime() + 24 * 60 * 60_000,
    );
    const graceEnd = new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000);
    const fourthAttemptAt = new Date(graceEnd.getTime() - 15 * 60_000);
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
          id: "renewal-four-attempts-1",
          status: "canceled",
          created_at: dueAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "renewal-four-attempts-2",
          status: "canceled",
          created_at: secondAttemptAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "renewal-four-attempts-3",
          status: "canceled",
          created_at: thirdAttemptAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "renewal-four-attempts-4",
          status: "succeeded",
          captured_at: fourthAttemptAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      );

    try {
      for (const attemptAt of [
        dueAt,
        secondAttemptAt,
        thirdAttemptAt,
      ]) {
        await expect(
          processSubscriptionRenewals(client, {
            now: () => attemptAt,
            batchSize: 1,
            fetchImplementation: fetchProvider,
          }),
        ).resolves.toMatchObject({ processed: 1, rescheduled: 1 });
      }

      await expect(
        pool.query<{ next_attempt_at: Date }>(
          `
            SELECT next_attempt_at
            FROM billing_subscription_renewal_attempts
            WHERE subscription_id = $1 AND attempt_number = 4
          `,
          [fixture.subscriptionId],
        ),
      ).resolves.toMatchObject({
        rows: [{ next_attempt_at: fourthAttemptAt }],
      });

      await expect(
        processSubscriptionRenewals(client, {
          now: () => fourthAttemptAt,
          batchSize: 1,
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

    expect(fetchProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "POST",
    ]);
    await expect(
      pool.query<{
        order_status: string;
        attempt_statuses: string[];
        reconciliation_attempts: string;
        grants: string;
      }>(
        `
          SELECT
            (
              SELECT status
              FROM billing_orders
              WHERE subscription_id = $1 AND renewal_sequence = 1
            ) AS order_status,
            ARRAY(
              SELECT status
              FROM billing_subscription_renewal_attempts
              WHERE subscription_id = $1
              ORDER BY attempt_number
            ) AS attempt_statuses,
            (
              SELECT count(*)
              FROM billing_subscription_renewal_attempts
              WHERE subscription_id = $1
                AND status = 'reconciliation_required'
            ) AS reconciliation_attempts,
            (
              SELECT count(*)
              FROM billing_access_grants grants
              JOIN billing_orders orders ON orders.id = grants.order_id
              WHERE orders.subscription_id = $1 AND grants.status = 'granted'
            ) AS grants
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          order_status: "paid",
          attempt_statuses: [
            "canceled",
            "canceled",
            "canceled",
            "succeeded",
          ],
          reconciliation_attempts: "0",
          grants: "1",
        },
      ],
    });
    await setSubscriptionRenewal(pool, fixture.userId, false, fourthAttemptAt);
  });

  it("завершает четвёртый отказ из recovery-webhook без нового цикла списания", async () => {
    const dueAt = new Date("2043-03-22T10:00:00.000Z");
    const secondAttemptAt = new Date(dueAt.getTime() + 60 * 60_000);
    const thirdAttemptAt = new Date(
      secondAttemptAt.getTime() + 24 * 60 * 60_000,
    );
    const graceEnd = new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000);
    const fourthAttemptAt = new Date(graceEnd.getTime() - 15 * 60_000);
    const webhookAt = new Date(fourthAttemptAt.getTime() + 60_000);
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
          id: "recovery-terminal-attempt-1",
          status: "canceled",
          created_at: dueAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "recovery-terminal-attempt-2",
          status: "canceled",
          created_at: secondAttemptAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "recovery-terminal-attempt-3",
          status: "canceled",
          created_at: thirdAttemptAt.toISOString(),
          payment_method: { id: `method-${fixture.userId}`, saved: true },
        }),
      )
      .mockRejectedValueOnce(
        new Error("Ответ четвёртой операции потерян после отправки"),
      );

    try {
      for (const attemptAt of [
        dueAt,
        secondAttemptAt,
        thirdAttemptAt,
        fourthAttemptAt,
      ]) {
        await expect(
          processSubscriptionRenewals(client, {
            now: () => attemptAt,
            batchSize: 1,
            fetchImplementation: fetchProvider,
          }),
        ).resolves.toMatchObject({ processed: 1 });
      }

      const fourthAttempt = await pool.query<{
        id: string;
        order_id: string;
      }>(
        `
          SELECT id, order_id
          FROM billing_subscription_renewal_attempts
          WHERE subscription_id = $1 AND attempt_number = 4
        `,
        [fixture.subscriptionId],
      );
      const repository = new PostgresPaymentRepository(pool, () => webhookAt);
      const event = {
        provider: "yookassa" as const,
        merchantAccountId: "renewal-test",
        externalEventId: "recovery-terminal-attempt-4-event",
        eventType: "payment.canceled",
        externalPaymentId: "recovery-terminal-attempt-4",
        status: "canceled" as const,
        paymentMethodToken: `method-${fixture.userId}`,
        paymentMethodSaved: true,
        occurredAt: webhookAt.toISOString(),
        payloadSha256: "8".repeat(64),
        payload: { event: "payment.canceled" },
        internalOrderId: fourthAttempt.rows[0].order_id,
        internalRenewalAttemptId: fourthAttempt.rows[0].id,
        money: { amountMinor: 150_000, currency: "RUB" as const },
      };

      await expect(
        repository.applyRecoveredRenewalPaymentEvent(event),
      ).resolves.toMatchObject({ outcome: "applied" });
      await expect(
        repository.applyRecoveredRenewalPaymentEvent(event),
      ).resolves.toMatchObject({ outcome: "duplicate" });
      await expect(
        repository.applyRecoveredRenewalPaymentEvent({
          ...event,
          externalEventId: "recovery-terminal-attempt-4-duplicate-event",
          payloadSha256: "9".repeat(64),
        }),
      ).resolves.toMatchObject({ outcome: "applied" });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(webhookAt.getTime() + 60_000),
          batchSize: 25,
          fetchImplementation: fetchProvider,
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

    expect(fetchProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "POST",
    ]);
    expect(await getSubscriptionSummary(pool, fixture.userId)).toMatchObject({
      status: "grace_period",
      autoRenew: false,
      cancelAtPeriodEnd: true,
      renewalErrorCode: "RENEWAL_PROVIDER_REJECTED",
      gracePeriodEnd: graceEnd.toISOString(),
    });
    await expect(
      pool.query<{
        order_status: string;
        renewal_sequences: number[];
        attempt_numbers: number[];
        attempt_statuses: string[];
        payments: string;
        payment_events: string;
        active_grace_periods: string;
        renewal_failure_count: number;
        last_renewal_attempt_at: Date;
        attempt_error_code: string;
        renewal_failed_events: string;
      }>(
        `
          SELECT
            (
              SELECT status
              FROM billing_orders
              WHERE subscription_id = $1 AND renewal_sequence = 1
            ) AS order_status,
            ARRAY(
              SELECT renewal_sequence
              FROM billing_orders
              WHERE subscription_id = $1
              ORDER BY renewal_sequence
            ) AS renewal_sequences,
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
            ) AS attempt_statuses,
            (
              SELECT count(*)
              FROM billing_payments payments
              JOIN billing_orders orders ON orders.id = payments.order_id
              WHERE orders.subscription_id = $1
            ) AS payments,
            (
              SELECT count(*)
              FROM billing_payment_events events
              JOIN billing_payments payments ON payments.id = events.payment_id
              JOIN billing_orders orders ON orders.id = payments.order_id
              WHERE orders.subscription_id = $1
            ) AS payment_events,
            (
              SELECT count(*)
              FROM billing_access_grace_periods
              WHERE subscription_id = $1 AND status = 'active'
            ) AS active_grace_periods,
            (
              SELECT renewal_failure_count
              FROM billing_subscriptions
              WHERE id = $1
            ) AS renewal_failure_count,
            (
              SELECT last_renewal_attempt_at
              FROM billing_subscriptions
              WHERE id = $1
            ) AS last_renewal_attempt_at,
            (
              SELECT last_error_code
              FROM billing_subscription_renewal_attempts
              WHERE subscription_id = $1 AND attempt_number = 4
            ) AS attempt_error_code,
            (
              SELECT count(*)
              FROM billing_subscription_events
              WHERE subscription_id = $1
                AND event_type = 'subscription.renewal_failed'
            ) AS renewal_failed_events
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          order_status: "canceled",
          renewal_sequences: [1],
          attempt_numbers: [1, 2, 3, 4],
          attempt_statuses: ["canceled", "canceled", "canceled", "canceled"],
          payments: "4",
          payment_events: "4",
          active_grace_periods: "1",
          renewal_failure_count: 4,
          last_renewal_attempt_at: webhookAt,
          attempt_error_code: "RENEWAL_PROVIDER_REJECTED",
          renewal_failed_events: "1",
        },
      ],
    });
  });

  it("создаёт терминальное событие после сбоя между сохранением payment и failRenewal", async () => {
    const dueAt = new Date("2043-03-23T10:00:00.000Z");
    const recoveryAt = new Date(dueAt.getTime() + 60_000);
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
      .mockRejectedValue(new Error("Ответ потерян после отправки"));

    try {
      await expect(
        processSubscriptionRenewals(client, {
          now: () => dueAt,
          batchSize: 1,
          fetchImplementation: fetchProvider,
        }),
      ).resolves.toMatchObject({ processed: 1, rescheduled: 1 });

      const attempt = await pool.query<{
        id: string;
        order_id: string;
        idempotency_key: string;
      }>(
        `
          UPDATE billing_subscription_renewal_attempts
          SET attempt_number = 4, updated_at = now()
          WHERE subscription_id = $1
          RETURNING id, order_id, idempotency_key
        `,
        [fixture.subscriptionId],
      );
      const externalPaymentId = "saved-before-terminal-fail-renewal";

      await pool.query(
        `
          INSERT INTO billing_payments (
            id, order_id, provider, merchant_account_id,
            external_payment_id, provider_operation_key, status,
            amount_minor, currency, payment_method_token,
            payment_method_saved, created_at, updated_at
          )
          VALUES (
            $1, $2, 'yookassa', 'renewal-test', $3, $4, 'canceled',
            150000, 'RUB', $5, true, $6, $6
          )
        `,
        [
          randomUUID(),
          attempt.rows[0].order_id,
          externalPaymentId,
          attempt.rows[0].idempotency_key,
          `method-${fixture.userId}`,
          dueAt,
        ],
      );

      const repository = new PostgresPaymentRepository(pool, () => recoveryAt);
      const event = {
        provider: "yookassa" as const,
        merchantAccountId: "renewal-test",
        externalEventId: "saved-before-terminal-fail-event",
        eventType: "payment.canceled",
        externalPaymentId,
        status: "canceled" as const,
        paymentMethodToken: `method-${fixture.userId}`,
        paymentMethodSaved: true,
        occurredAt: recoveryAt.toISOString(),
        payloadSha256: "a".repeat(64),
        payload: { event: "payment.canceled" },
        internalOrderId: attempt.rows[0].order_id,
        internalRenewalAttemptId: attempt.rows[0].id,
        money: { amountMinor: 150_000, currency: "RUB" as const },
      };

      await expect(
        repository.applyRecoveredRenewalPaymentEvent(event),
      ).resolves.toMatchObject({ outcome: "applied" });
      await expect(
        repository.applyRecoveredRenewalPaymentEvent(event),
      ).resolves.toMatchObject({ outcome: "duplicate" });
      await expect(
        repository.applyRecoveredRenewalPaymentEvent({
          ...event,
          externalEventId: "saved-before-terminal-fail-duplicate-event",
          payloadSha256: "b".repeat(64),
        }),
      ).resolves.toMatchObject({ outcome: "applied" });
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    expect(fetchProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
    ]);
    expect(await getSubscriptionSummary(pool, fixture.userId)).toMatchObject({
      status: "grace_period",
      autoRenew: false,
      cancelAtPeriodEnd: true,
      renewalErrorCode: "RENEWAL_PROVIDER_REJECTED",
    });
    await expect(
      pool.query<{
        order_status: string;
        attempt_status: string;
        attempt_error_code: string;
        renewal_failure_count: number;
        last_renewal_attempt_at: Date;
        renewal_failed_events: string;
      }>(
        `
          SELECT
            orders.status AS order_status,
            attempts.status AS attempt_status,
            attempts.last_error_code AS attempt_error_code,
            subscriptions.renewal_failure_count,
            subscriptions.last_renewal_attempt_at,
            (
              SELECT count(*)
              FROM billing_subscription_events events
              WHERE events.subscription_id = subscriptions.id
                AND events.event_type = 'subscription.renewal_failed'
            ) AS renewal_failed_events
          FROM billing_subscription_renewal_attempts attempts
          JOIN billing_orders orders ON orders.id = attempts.order_id
          JOIN billing_subscriptions subscriptions
            ON subscriptions.id = attempts.subscription_id
          WHERE attempts.subscription_id = $1
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          order_status: "canceled",
          attempt_status: "canceled",
          attempt_error_code: "RENEWAL_PROVIDER_REJECTED",
          renewal_failure_count: 4,
          last_renewal_attempt_at: recoveryAt,
          renewal_failed_events: "1",
        },
      ],
    });
  });

  it("терминально завершает пропущенную четвёртую попытку на границе льготы", async () => {
    const dueAt = new Date("2043-03-24T10:00:00.000Z");
    const secondAttemptAt = new Date(dueAt.getTime() + 60 * 60_000);
    const thirdAttemptAt = new Date(
      secondAttemptAt.getTime() + 24 * 60 * 60_000,
    );
    const graceEnd = new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const fetchProvider = vi.fn().mockImplementation(() =>
      Response.json({
        id: `missed-final-attempt-${fetchProvider.mock.calls.length}`,
        status: "canceled",
        created_at: thirdAttemptAt.toISOString(),
        payment_method: { id: `method-${fixture.userId}`, saved: true },
      }),
    );

    try {
      for (const attemptAt of [dueAt, secondAttemptAt, thirdAttemptAt]) {
        await expect(
          processSubscriptionRenewals(client, {
            now: () => attemptAt,
            batchSize: 1,
            fetchImplementation: fetchProvider,
          }),
        ).resolves.toMatchObject({ processed: 1, rescheduled: 1 });
      }

      await expect(
        processSubscriptionRenewals(client, {
          now: () => graceEnd,
          batchSize: 25,
          fetchImplementation: fetchProvider,
        }),
      ).resolves.toEqual({
        processed: 0,
        succeeded: 0,
        rescheduled: 0,
        failed: 0,
      });
      await expect(
        processSubscriptionRenewals(client, {
          now: () => new Date(graceEnd.getTime() + 15 * 60_000),
          batchSize: 25,
          fetchImplementation: fetchProvider,
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

    expect(fetchProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "POST",
      "POST",
    ]);
    expect(await getSubscriptionSummary(pool, fixture.userId)).toMatchObject({
      status: "past_due",
      autoRenew: false,
      cancelAtPeriodEnd: true,
    });
    await expect(
      pool.query<{
        order_status: string;
        attempt_numbers: number[];
        attempt_statuses: string[];
        last_error_code: string;
        payments: string;
        fourth_attempt_payments: string;
        expired_events: string;
      }>(
        `
          SELECT
            (
              SELECT status
              FROM billing_orders
              WHERE subscription_id = $1 AND renewal_sequence = 1
            ) AS order_status,
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
            ) AS attempt_statuses,
            (
              SELECT last_error_code
              FROM billing_subscription_renewal_attempts
              WHERE subscription_id = $1 AND attempt_number = 4
            ) AS last_error_code,
            (
              SELECT count(*)
              FROM billing_payments payments
              JOIN billing_orders orders ON orders.id = payments.order_id
              WHERE orders.subscription_id = $1
            ) AS payments,
            (
              SELECT count(*)
              FROM billing_payments payments
              JOIN billing_subscription_renewal_attempts attempts
                ON attempts.order_id = payments.order_id
               AND attempts.idempotency_key = payments.provider_operation_key
              WHERE attempts.subscription_id = $1
                AND attempts.attempt_number = 4
            ) AS fourth_attempt_payments,
            (
              SELECT count(*)
              FROM billing_subscription_events events
              WHERE events.subscription_id = $1
                AND events.event_type = 'subscription.expired'
            ) AS expired_events
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          order_status: "canceled",
          attempt_numbers: [1, 2, 3, 4],
          attempt_statuses: ["canceled", "canceled", "canceled", "failed"],
          last_error_code: "RENEWAL_GRACE_PERIOD_EXPIRED_BEFORE_REQUEST",
          payments: "3",
          fourth_attempt_payments: "0",
          expired_events: "1",
        },
      ],
    });
  });

  it("не создаёт неотправленную попытку после последнего безопасного запуска", async () => {
    const dueAt = new Date("2043-03-30T10:00:00.000Z");
    const secondAttemptAt = new Date(dueAt.getTime() + 60 * 60_000);
    const graceEnd = new Date(dueAt.getTime() + 7 * 24 * 60 * 60_000);
    const lateThirdAttemptAt = new Date(graceEnd.getTime() - 10 * 60_000);
    const fixture = await createRecurringSubscription({
      provider: "yookassa",
      periodEnd: dueAt,
    });
    const client = await pool.connect();
    const previousShopId = process.env.YOOKASSA_SHOP_ID;
    const previousSecretKey = process.env.YOOKASSA_SECRET_KEY;
    process.env.YOOKASSA_SHOP_ID = "integration-shop";
    process.env.YOOKASSA_SECRET_KEY = "integration-secret";
    const fetchProvider = vi.fn().mockImplementation(() =>
      Response.json({
        id: `late-safe-window-${fetchProvider.mock.calls.length}`,
        status: "canceled",
        created_at: lateThirdAttemptAt.toISOString(),
        payment_method: { id: `method-${fixture.userId}`, saved: true },
      }),
    );

    try {
      for (const attemptAt of [dueAt, secondAttemptAt, lateThirdAttemptAt]) {
        await processSubscriptionRenewals(client, {
          now: () => attemptAt,
          batchSize: 1,
          fetchImplementation: fetchProvider,
        });
      }
    } finally {
      client.release();
      if (previousShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
      else process.env.YOOKASSA_SHOP_ID = previousShopId;
      if (previousSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
      else process.env.YOOKASSA_SECRET_KEY = previousSecretKey;
    }

    expect(fetchProvider.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "POST",
      "POST",
    ]);
    await expect(
      pool.query<{
        attempt_numbers: number[];
        attempt_statuses: string[];
        auto_renew: boolean;
        cancel_at_period_end: boolean;
        subscription_status: string;
        active_grace_periods: string;
      }>(
        `
          SELECT
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
            ) AS attempt_statuses,
            subscriptions.auto_renew,
            subscriptions.cancel_at_period_end,
            subscriptions.status AS subscription_status,
            (
              SELECT count(*)
              FROM billing_access_grace_periods
              WHERE subscription_id = $1 AND status = 'active'
            ) AS active_grace_periods
          FROM billing_subscriptions subscriptions
          WHERE subscriptions.id = $1
        `,
        [fixture.subscriptionId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_numbers: [1, 2, 3],
          attempt_statuses: ["canceled", "canceled", "failed"],
          auto_renew: false,
          cancel_at_period_end: true,
          subscription_status: "grace_period",
          active_grace_periods: "1",
        },
      ],
    });
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
      autoRenew: false,
      cancelAtPeriodEnd: true,
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
