import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ApplyPaymentEventInput,
  ApplyPaymentEventResult,
  ApplyRefundEventInput,
  ApplyRefundEventResult,
  PaymentRepository,
  ReserveCheckoutInput,
  SaveCheckoutInput,
} from "../application/payment-repository";
import type {
  CheckoutReservation,
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
  offer_accepted_at: Date;
  offer_version: string;
  receipt_email: string | null;
  receipt_phone: string | null;
  created_at: Date;
  updated_at: Date;
};

type CheckoutReservationRow = {
  order_id: string;
  customer_id: string;
  plan_id: SubscriptionPlanId;
  legal_entity_id: string;
  country_code: string;
  merchant_account_id: string;
  amount_minor: string;
  currency: "RUB";
  idempotency_key: string;
  selected_provider: PaymentProviderId;
  offer_accepted_at: Date;
  offer_version: string;
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
    offerAcceptedAt: row.offer_accepted_at.toISOString(),
    offerVersion: row.offer_version,
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
    orders.offer_accepted_at,
    orders.offer_version,
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

const reservationSelect = `
  SELECT
    orders.id AS order_id,
    orders.customer_id,
    orders.plan_id,
    orders.legal_entity_id,
    orders.country_code,
    orders.merchant_account_id,
    orders.amount_minor,
    orders.currency,
    orders.idempotency_key,
    orders.selected_provider,
    orders.offer_accepted_at,
    orders.offer_version,
    orders.receipt_email,
    orders.receipt_phone,
    orders.created_at,
    orders.updated_at
  FROM billing_orders orders
`;

function mapReservationRow(
  row: CheckoutReservationRow,
): CheckoutReservation {
  return {
    orderId: row.order_id,
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
    offerAcceptedAt: row.offer_accepted_at.toISOString(),
    offerVersion: row.offer_version,
    receiptContact: {
      email: row.receipt_email ?? undefined,
      phone: row.receipt_phone ?? undefined,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function findReservationByIdempotencyKey(
  client: Pool | PoolClient,
  idempotencyKey: string,
) {
  const result = await client.query<CheckoutReservationRow>(
    `${reservationSelect} WHERE orders.idempotency_key = $1 LIMIT 1`,
    [idempotencyKey],
  );

  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

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

async function lockPaymentByExternalId(
  client: PoolClient,
  provider: PaymentProviderId,
  merchantAccountId: string,
  externalPaymentId: string,
) {
  await client.query(
    `
      SELECT id
      FROM billing_payments
      WHERE provider = $1
        AND merchant_account_id = $2
        AND external_payment_id = $3
      FOR UPDATE
    `,
    [provider, merchantAccountId, externalPaymentId],
  );
}

async function findByOrderIdForCustomer(
  client: Pool | PoolClient,
  orderId: string,
  customerId: string,
) {
  const result = await client.query<CheckoutRow>(
    `
      ${checkoutSelect}
      WHERE orders.id = $1
        AND orders.customer_id = $2
      LIMIT 1
    `,
    [orderId, customerId],
  );

  return result.rows[0] ? mapCheckoutRow(result.rows[0]) : null;
}

type WebhookEventRecord = {
  provider: PaymentProviderId;
  merchantAccountId: string;
  externalEventId: string;
  eventType: string;
  externalPaymentId: string;
  payloadSha256: string;
  payload: unknown;
};

async function acquireWebhookEvent(
  client: PoolClient,
  input: WebhookEventRecord,
) {
  const result = await client.query<{ id: string }>(
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
      DO UPDATE SET
        event_type = EXCLUDED.event_type,
        external_payment_id = EXCLUDED.external_payment_id,
        payload_sha256 = EXCLUDED.payload_sha256,
        payload = EXCLUDED.payload,
        processing_status = 'verified',
        error_code = NULL,
        processed_at = NULL
      WHERE billing_webhook_events.processing_status IN ('ignored', 'failed')
      RETURNING id
    `,
    [
      randomUUID(),
      input.provider,
      input.merchantAccountId,
      input.externalEventId,
      input.eventType,
      input.externalPaymentId,
      input.payloadSha256,
      JSON.stringify(input.payload),
    ],
  );

  return result.rows[0]?.id ?? null;
}

async function markWebhookEvent(
  client: PoolClient,
  webhookId: string,
  processingStatus: "applied" | "ignored",
) {
  await client.query(
    `
      UPDATE billing_webhook_events
      SET processing_status = $2, processed_at = now()
      WHERE id = $1
    `,
    [webhookId, processingStatus],
  );
}

async function activateSubscription(
  client: PoolClient,
  checkout: StoredCheckout,
  activatedAt: Date,
) {
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
          auto_renew = false,
          mandate_id = NULL,
          activated_by_order_id = $5,
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
        VALUES ($1, $2, $3, 'active', $4, $5, false, NULL, $6)
      `,
      [
        randomUUID(),
        checkout.customerId,
        checkout.planId,
        periodStart,
        periodEnd,
        checkout.orderId,
      ],
    );
  }
}

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}

  async findCheckoutReservationByIdempotencyKey(
    idempotencyKey: string,
  ) {
    return findReservationByIdempotencyKey(
      this.pool,
      idempotencyKey,
    );
  }

  async reserveCheckout(input: ReserveCheckoutInput) {
    await this.pool.query(
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
          receipt_email,
          receipt_phone,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11,
          $12, $13, $14, $15, $15
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `,
      [
        input.orderId,
        input.customerId,
        input.planId,
        input.legalEntityId,
        input.countryCode,
        input.money.amountMinor,
        input.money.currency,
        input.idempotencyKey,
        input.provider,
        input.merchantAccountId,
        input.offerAcceptedAt,
        input.offerVersion,
        input.receiptContact.email ?? null,
        input.receiptContact.phone ?? null,
        input.createdAt,
      ],
    );
    const reservation = await findReservationByIdempotencyKey(
      this.pool,
      input.idempotencyKey,
    );

    if (!reservation) {
      throw new Error("Не удалось зарезервировать заказ");
    }

    return reservation;
  }

  async findCheckoutByIdempotencyKey(idempotencyKey: string) {
    return findByIdempotencyKey(this.pool, idempotencyKey);
  }

  async saveCheckout(input: SaveCheckoutInput) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const reservedOrder = await client.query<{ id: string }>(
        `
          SELECT id
          FROM billing_orders
          WHERE id = $1 AND idempotency_key = $2
          FOR UPDATE
        `,
        [input.orderId, input.idempotencyKey],
      );

      if (!reservedOrder.rowCount) {
        throw new Error("Зарезервированный заказ не найден");
      }

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
            paid_at,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $12
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
          input.status === "succeeded" ? input.updatedAt : null,
          input.createdAt,
        ],
      );
      await client.query(
        `
          UPDATE billing_orders
          SET status = $2, updated_at = now()
          WHERE id = $1
        `,
        [input.orderId, orderStatusForPayment(input.status)],
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
    merchantAccountId: string,
    externalPaymentId: string,
  ) {
    return findByExternalPaymentId(
      this.pool,
      provider,
      merchantAccountId,
      externalPaymentId,
    );
  }

  async findCheckoutByOrderIdForCustomer(
    orderId: string,
    customerId: string,
  ) {
    return findByOrderIdForCustomer(this.pool, orderId, customerId);
  }

  async applyPaymentEvent(
    input: ApplyPaymentEventInput,
  ): Promise<ApplyPaymentEventResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const webhookId = await acquireWebhookEvent(client, input);
      await lockPaymentByExternalId(
        client,
        input.provider,
        input.merchantAccountId,
        input.externalPaymentId,
      );
      const checkout = await findByExternalPaymentId(
        client,
        input.provider,
        input.merchantAccountId,
        input.externalPaymentId,
      );

      if (!webhookId) {
        await client.query("COMMIT");
        return { outcome: "duplicate", checkout };
      }

      if (!checkout) {
        await markWebhookEvent(client, webhookId, "ignored");
        await client.query("COMMIT");
        return { outcome: "unmatched", checkout: null };
      }

      const previousStatus = checkout.status;
      const nextStatus =
        previousStatus === "partially_refunded" ||
        previousStatus === "refunded"
          ? previousStatus
          : input.status;
      const updatedCheckout: StoredCheckout = {
        ...checkout,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };

      await client.query(
        `
          UPDATE billing_payments
          SET
            status = $2,
            paid_at = CASE
              WHEN $2 = 'succeeded' THEN COALESCE(paid_at, $3)
              ELSE paid_at
            END,
            updated_at = now()
          WHERE id = $1
        `,
        [
          checkout.paymentId,
          nextStatus,
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
          orderStatusForPayment(nextStatus),
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
          nextStatus,
          input.occurredAt,
        ],
      );

      if (
        nextStatus === "succeeded" &&
        previousStatus !== "succeeded"
      ) {
        await activateSubscription(
          client,
          updatedCheckout,
          new Date(input.occurredAt),
        );
      }

      await markWebhookEvent(client, webhookId, "applied");
      await client.query("COMMIT");

      return { outcome: "applied", checkout: updatedCheckout };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyRefundEvent(
    input: ApplyRefundEventInput,
  ): Promise<ApplyRefundEventResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const webhookId = await acquireWebhookEvent(client, input);
      await lockPaymentByExternalId(
        client,
        input.provider,
        input.merchantAccountId,
        input.externalPaymentId,
      );
      const checkout = await findByExternalPaymentId(
        client,
        input.provider,
        input.merchantAccountId,
        input.externalPaymentId,
      );

      if (!webhookId) {
        await client.query("COMMIT");
        return { outcome: "duplicate", checkout };
      }

      if (!checkout) {
        await markWebhookEvent(client, webhookId, "ignored");
        await client.query("COMMIT");
        return { outcome: "unmatched", checkout: null };
      }

      await client.query(
        `
          INSERT INTO billing_refunds (
            id,
            payment_id,
            provider,
            merchant_account_id,
            external_refund_id,
            provider_operation_key,
            status,
            amount_minor,
            currency,
            reason,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $10
          )
          ON CONFLICT (
            provider,
            merchant_account_id,
            external_refund_id
          )
          DO UPDATE SET
            status = EXCLUDED.status,
            amount_minor = EXCLUDED.amount_minor,
            currency = EXCLUDED.currency,
            updated_at = now()
        `,
        [
          randomUUID(),
          checkout.paymentId,
          input.provider,
          input.merchantAccountId,
          input.externalRefundId,
          `webhook:${input.externalRefundId}`,
          input.status,
          input.money.amountMinor,
          input.money.currency,
          input.occurredAt,
        ],
      );

      const previousStatus = checkout.status;
      let nextStatus = previousStatus;

      if (input.status === "succeeded") {
        const refunded = await client.query<{ amount_minor: string }>(
          `
            SELECT COALESCE(sum(amount_minor), 0)::text AS amount_minor
            FROM billing_refunds
            WHERE payment_id = $1
              AND status = 'succeeded'
          `,
          [checkout.paymentId],
        );
        const refundedAmountMinor = Number(
          refunded.rows[0]?.amount_minor ?? "0",
        );
        nextStatus =
          refundedAmountMinor >= checkout.money.amountMinor
            ? "refunded"
            : "partially_refunded";

        await client.query(
          `
            UPDATE billing_payments
            SET status = $2, updated_at = now()
            WHERE id = $1
          `,
          [checkout.paymentId, nextStatus],
        );
        await client.query(
          `
            UPDATE billing_orders
            SET status = $2, updated_at = now()
            WHERE id = $1
          `,
          [checkout.orderId, orderStatusForPayment(nextStatus)],
        );
        await client.query(
          `
            UPDATE billing_subscriptions
            SET
              status = 'canceled',
              current_period_end = LEAST(
                COALESCE(current_period_end, $3::timestamptz),
                $3::timestamptz
              ),
              auto_renew = false,
              cancel_at_period_end = false,
              canceled_at = COALESCE(canceled_at, $3::timestamptz),
              updated_at = now()
            WHERE customer_id = $1
              AND activated_by_order_id = $2
              AND status IN ('pending', 'active', 'past_due', 'grace_period')
          `,
          [checkout.customerId, checkout.orderId, input.occurredAt],
        );
      }

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
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        `,
        [
          randomUUID(),
          checkout.paymentId,
          webhookId,
          input.eventType,
          previousStatus,
          nextStatus,
          JSON.stringify({
            externalRefundId: input.externalRefundId,
            refundStatus: input.status,
            amountMinor: input.money.amountMinor,
            currency: input.money.currency,
          }),
          input.occurredAt,
        ],
      );
      await markWebhookEvent(client, webhookId, "applied");
      await client.query("COMMIT");

      return {
        outcome: "applied",
        checkout: {
          ...checkout,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        },
      };
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
