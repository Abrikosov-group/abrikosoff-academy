import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { processSubscriptionRenewals } from "../../scripts/lib/subscription-renewals.mjs";
import {
  getSubscriptionSummary,
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
