import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ApplyPaymentEventInput,
  ApplyPaymentEventResult,
  PaymentRepository,
  SaveCheckoutInput,
} from "../application/payment-repository";
import type {
  OrderStatus,
  PaymentProviderId,
  PaymentStatus,
  StoredCheckout,
  SubscriptionPlanId,
} from "../domain/types";
import { addSubscriptionPeriod } from "../domain/subscription-period";

type CheckoutRow = {
  order_id: string;
  payment_id: string;
  customer_id: string;
  plan_id: SubscriptionPlanId;
  legal_entity_id: string;
  country_code: string;
  merchant_account_id: string;
  amount_minor: string;
  currency: "RUB";
  idempotency_key: string;
  selected_provider: PaymentProviderId;
  external_payment_id: string;
  payment_status: PaymentStatus;
  confirmation_url: string | null;
  payment_method_token: string | null;
  recurring_consent_accepted_at: Date;
  recurring_consent_offer_version: string;
  receipt_email: string | null;
  receipt_phone: string | null;
  created_at: Date;
  updated_at: Date;
};

function orderStatusForPayment(status: PaymentStatus): OrderStatus {
  switch (status) {
    case "succeeded":
      return "paid";
    case "partially_refunded":
      return "partially_refunded";
    case "refunded":
      return "refunded";
    case "canceled":
    case "failed":
      return "canceled";
    default:
      return "pending";
  }
}

function mapCheckoutRow(row: CheckoutRow): StoredCheckout {
  return {
    orderId: row.order_id,
    paymentId: row.payment_id,
    customerId: row.customer_id,
    planId: row.plan_id,
    legalEntityId: row.legal_entity_id,
    countryCode: row.country_code,
    merchantAccountId: row.merchant_account_id,
    money: {
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
    },
    idempotencyKey: row.idempotency_key,
    provider: row.selected_provider,
    externalPaymentId: row.external_payment_id,
    status: row.payment_status,
    confirmationUrl: row.confirmation_url ?? "",
    paymentMethodToken: row.payment_method_token ?? undefined,
    recurringConsentAcceptedAt:
      row.recurring_consent_accepted_at.toISOString(),
    recurringConsentOfferVersion:
      row.recurring_consent_offer_version,
    receiptContact: {
      email: row.receipt_email ?? undefined,
      phone: row.receipt_phone ?? undefined,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const checkoutSelect = `
  SELECT
    orders.id AS order_id,
    payments.id AS payment_id,
    orders.customer_id,
    orders.plan_id,
    orders.legal_entity_id,
    orders.country_code,
    payments.merchant_account_id,
    payments.amount_minor,
    payments.currency,
    orders.idempotency_key,
    orders.selected_provider,
    payments.external_payment_id,
    payments.status AS payment_status,
    payments.confirmation_url,
    payments.payment_method_token,
    orders.recurring_consent_accepted_at,
    orders.recurring_consent_offer_version,
    orders.receipt_email,
    orders.receipt_phone,
    orders.created_at,
    GREATEST(orders.updated_at, payments.updated_at) AS updated_at
  FROM billing_orders orders
  JOIN LATERAL (
    SELECT *
    FROM billing_payments
    WHERE order_id = orders.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) payments ON true
`;

async function findByIdempotencyKey(
  client: Pool | PoolClient,
  idempotencyKey: string,
) {
  const result = await client.query<CheckoutRow>(
    `${checkoutSelect} WHERE orders.idempotency_key = $1 LIMIT 1`,
    [idempotencyKey],
  );

  return result.rows[0] ? mapCheckoutRow(result.rows[0]) : null;
}

async function findByExternalPaymentId(
  client: Pool | PoolClient,
  provider: PaymentProviderId,
  merchantAccountId: string,
  externalPaymentId: string,
) {
  const result = await client.query<CheckoutRow>(
    `
      ${checkoutSelect}
      WHERE payments.provider = $1
        AND payments.merchant_account_id = $2
        AND payments.external_payment_id = $3
      LIMIT 1
    `,
    [provider, merchantAccountId, externalPaymentId],
  );

  return result.rows[0] ? mapCheckoutRow(result.rows[0]) : null;
}

async function activateSubscription(
  client: PoolClient,
  checkout: StoredCheckout,
  activatedAt: Date,
) {
  let mandateId: string | null = null;

  if (checkout.paymentMethodToken) {
    const mandateResult = await client.query<{ id: string }>(
      `
        INSERT INTO billing_payment_mandates (
          id,
          customer_id,
          provider,
          merchant_account_id,
          provider_payment_method_token,
          status,
          consent_accepted_at,
          consent_offer_version,
          activated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
        ON CONFLICT (
          provider,
          merchant_account_id,
          provider_payment_method_token
        )
        DO UPDATE SET
          status = 'active',
          activated_at = COALESCE(
            billing_payment_mandates.activated_at,
            EXCLUDED.activated_at
          ),
          revoked_at = NULL,
          updated_at = now()
        RETURNING id
      `,
      [
        randomUUID(),
        checkout.customerId,
        checkout.provider,
        checkout.merchantAccountId,
        checkout.paymentMethodToken,
        checkout.recurringConsentAcceptedAt,
        checkout.recurringConsentOfferVersion,
        activatedAt,
      ],
    );
    mandateId = mandateResult.rows[0].id;
  }

  const existing = await client.query<{
    id: string;
    current_period_end: Date | null;
  }>(
    `
      SELECT id, current_period_end
      FROM billing_subscriptions
      WHERE customer_id = $1
        AND status IN ('pending', 'active', 'past_due', 'grace_period')
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [checkout.customerId],
  );
  const current = existing.rows[0];
  const periodStart =
    current?.current_period_end &&
    current.current_period_end.getTime() > activatedAt.getTime()
      ? current.current_period_end
      : activatedAt;
  const periodEnd = addSubscriptionPeriod(
    periodStart,
    checkout.planId,
  );

  if (current) {
    await client.query(
      `
        UPDATE billing_subscriptions
        SET
          plan_id = $2,
          status = 'active',
          current_period_start = $3,
          current_period_end = $4,
          auto_renew = true,
          mandate_id = COALESCE($5, mandate_id),
          activated_by_order_id = $6,
          cancel_at_period_end = false,
          canceled_at = NULL,
          updated_at = now()
        WHERE id = $1
      `,
      [
        current.id,
        checkout.planId,
        periodStart,
        periodEnd,
        mandateId,
        checkout.orderId,
      ],
    );
  } else {
    await client.query(
      `
        INSERT INTO billing_subscriptions (
          id,
          customer_id,
          plan_id,
          status,
          current_period_start,
          current_period_end,
          auto_renew,
          mandate_id,
          activated_by_order_id
        )
        VALUES ($1, $2, $3, 'active', $4, $5, true, $6, $7)
      `,
      [
        randomUUID(),
        checkout.customerId,
        checkout.planId,
        periodStart,
        periodEnd,
        mandateId,
        checkout.orderId,
      ],
    );
  }
}

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}

  async findCheckoutByIdempotencyKey(idempotencyKey: string) {
    return findByIdempotencyKey(this.pool, idempotencyKey);
  }

  async saveCheckout(input: SaveCheckoutInput) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
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
            recurring_consent_accepted_at,
            recurring_consent_offer_version,
            receipt_email,
            receipt_phone,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $16
          )
        `,
        [
          input.orderId,
          input.customerId,
          input.planId,
          input.legalEntityId,
          input.countryCode,
          input.money.amountMinor,
          input.money.currency,
          orderStatusForPayment(input.status),
          input.idempotencyKey,
          input.provider,
          input.merchantAccountId,
          input.recurringConsentAcceptedAt,
          input.recurringConsentOfferVersion,
          input.receiptContact.email ?? null,
          input.receiptContact.phone ?? null,
          input.createdAt,
        ],
      );
      await client.query(
        `
          INSERT INTO billing_payments (
            id,
            order_id,
            provider,
            merchant_account_id,
            external_payment_id,
            provider_operation_key,
            status,
            amount_minor,
            currency,
            confirmation_url,
            payment_method_token,
            paid_at,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $13
          )
        `,
        [
          input.paymentId,
          input.orderId,
          input.provider,
          input.merchantAccountId,
          input.externalPaymentId,
          input.idempotencyKey,
          input.status,
          input.money.amountMinor,
          input.money.currency,
          input.confirmationUrl,
          input.paymentMethodToken ?? null,
          input.status === "succeeded" ? input.updatedAt : null,
          input.createdAt,
        ],
      );
      await client.query(
        `
          INSERT INTO billing_payment_events (
            id,
            payment_id,
            event_type,
            from_status,
            to_status,
            details,
            occurred_at
          )
          VALUES ($1, $2, 'payment.created', NULL, $3, $4::jsonb, $5)
        `,
        [
          randomUUID(),
          input.paymentId,
          input.status,
          JSON.stringify({ source: "checkout" }),
          input.createdAt,
        ],
      );

      if (input.status === "succeeded") {
        await activateSubscription(client, input, new Date(input.updatedAt));
      }

      await client.query("COMMIT");
      return input;
    } catch (error) {
      await client.query("ROLLBACK");

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        const existing = await findByIdempotencyKey(
          this.pool,
          input.idempotencyKey,
        );

        if (existing) {
          return existing;
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async findCheckoutByExternalPaymentId(
    provider: PaymentProviderId,
    externalPaymentId: string,
  ) {
    const result = await this.pool.query<CheckoutRow>(
      `
        ${checkoutSelect}
        WHERE payments.provider = $1
          AND payments.external_payment_id = $2
        ORDER BY payments.created_at DESC
        LIMIT 1
      `,
      [provider, externalPaymentId],
    );

    return result.rows[0] ? mapCheckoutRow(result.rows[0]) : null;
  }

  async applyPaymentEvent(
    input: ApplyPaymentEventInput,
  ): Promise<ApplyPaymentEventResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const webhookId = randomUUID();
      const insertedWebhook = await client.query(
        `
          INSERT INTO billing_webhook_events (
            id,
            provider,
            merchant_account_id,
            external_event_id,
            event_type,
            external_payment_id,
            payload_sha256,
            payload,
            processing_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'verified')
          ON CONFLICT (
            provider,
            merchant_account_id,
            external_event_id
          )
          DO NOTHING
        `,
        [
          webhookId,
          input.provider,
          input.merchantAccountId,
          input.externalEventId,
          input.eventType,
          input.externalPaymentId,
          input.payloadSha256,
          JSON.stringify(input.payload),
        ],
      );
      const checkout = await findByExternalPaymentId(
        client,
        input.provider,
        input.merchantAccountId,
        input.externalPaymentId,
      );

      if (!insertedWebhook.rowCount) {
        await client.query("COMMIT");
        return { outcome: "duplicate", checkout };
      }

      if (!checkout) {
        await client.query(
          `
            UPDATE billing_webhook_events
            SET processing_status = 'ignored', processed_at = now()
            WHERE id = $1
          `,
          [webhookId],
        );
        await client.query("COMMIT");
        return { outcome: "unmatched", checkout: null };
      }

      const previousStatus = checkout.status;
      const updatedCheckout: StoredCheckout = {
        ...checkout,
        status: input.status,
        paymentMethodToken:
          input.paymentMethodToken ?? checkout.paymentMethodToken,
        updatedAt: new Date().toISOString(),
      };

      await client.query(
        `
          UPDATE billing_payments
          SET
            status = $2,
            payment_method_token = COALESCE($3, payment_method_token),
            paid_at = CASE
              WHEN $2 = 'succeeded' THEN COALESCE(paid_at, $4)
              ELSE paid_at
            END,
            updated_at = now()
          WHERE id = $1
        `,
        [
          checkout.paymentId,
          input.status,
          input.paymentMethodToken ?? null,
          input.occurredAt,
        ],
      );
      await client.query(
        `
          UPDATE billing_orders
          SET status = $2, updated_at = now()
          WHERE id = $1
        `,
        [
          checkout.orderId,
          orderStatusForPayment(input.status),
        ],
      );
      await client.query(
        `
          INSERT INTO billing_payment_events (
            id,
            payment_id,
            webhook_event_id,
            event_type,
            from_status,
            to_status,
            details,
            occurred_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7)
        `,
        [
          randomUUID(),
          checkout.paymentId,
          webhookId,
          input.eventType,
          previousStatus,
          input.status,
          input.occurredAt,
        ],
      );

      if (
        input.status === "succeeded" &&
        previousStatus !== "succeeded"
      ) {
        await activateSubscription(
          client,
          updatedCheckout,
          new Date(input.occurredAt),
        );
      }

      await client.query(
        `
          UPDATE billing_webhook_events
          SET processing_status = 'applied', processed_at = now()
          WHERE id = $1
        `,
        [webhookId],
      );
      await client.query("COMMIT");

      return { outcome: "applied", checkout: updatedCheckout };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export type SubscriptionSummary = {
  status:
    | "pending"
    | "active"
    | "past_due"
    | "grace_period"
    | "canceled"
    | "expired";
  planId: SubscriptionPlanId;
  currentPeriodEnd?: string;
  autoRenew: boolean;
};

export async function getSubscriptionSummary(
  pool: Pool,
  customerId: string,
): Promise<SubscriptionSummary | null> {
  const result = await pool.query<{
    status: SubscriptionSummary["status"];
    plan_id: SubscriptionPlanId;
    current_period_end: Date | null;
    auto_renew: boolean;
  }>(
    `
      SELECT status, plan_id, current_period_end, auto_renew
      FROM billing_subscriptions
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [customerId],
  );
  const row = result.rows[0];

  return row
    ? {
        status: row.status,
        planId: row.plan_id,
        currentPeriodEnd:
          row.current_period_end?.toISOString(),
        autoRenew: row.auto_renew,
      }
    : null;
}

export type CustomerOrderSummary = {
  id: string;
  planId: SubscriptionPlanId;
  status: OrderStatus;
};

export async function getCustomerOrderSummary(
  pool: Pool,
  orderId: string,
  customerId: string,
): Promise<CustomerOrderSummary | null> {
  const result = await pool.query<{
    id: string;
    plan_id: SubscriptionPlanId;
    status: OrderStatus;
  }>(
    `
      SELECT id, plan_id, status
      FROM billing_orders
      WHERE id = $1 AND customer_id = $2
      LIMIT 1
    `,
    [orderId, customerId],
  );
  const row = result.rows[0];

  return row
    ? {
        id: row.id,
        planId: row.plan_id,
        status: row.status,
      }
    : null;
}
