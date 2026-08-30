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
  BillingMode,
  OrderStatus,
  PaymentProviderId,
  PaymentStatus,
  StoredCheckout,
  SubscriptionPlanId,
} from "../domain/types";
import { BillingError } from "../domain/errors";
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
  payment_method_saved: boolean;
  billing_mode: BillingMode;
  subscription_id: string | null;
  renewal_sequence: number;
  offer_accepted_at: Date;
  offer_version: string;
  recurring_consent_accepted_at: Date | null;
  recurring_consent_offer_version: string | null;
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
  billing_mode: BillingMode;
  subscription_id: string | null;
  renewal_sequence: number;
  offer_accepted_at: Date;
  offer_version: string;
  recurring_consent_accepted_at: Date | null;
  recurring_consent_offer_version: string | null;
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
    paymentMethodSaved: row.payment_method_saved,
    billingMode: row.billing_mode,
    subscriptionId: row.subscription_id ?? undefined,
    renewalSequence: row.renewal_sequence,
    offerAcceptedAt: row.offer_accepted_at.toISOString(),
    offerVersion: row.offer_version,
    recurringConsentAcceptedAt:
      row.recurring_consent_accepted_at?.toISOString(),
    recurringConsentOfferVersion:
      row.recurring_consent_offer_version ?? undefined,
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
    payments.payment_method_saved,
    orders.billing_mode,
    orders.subscription_id,
    orders.renewal_sequence,
    orders.offer_accepted_at,
    orders.offer_version,
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
    orders.billing_mode,
    orders.subscription_id,
    orders.renewal_sequence,
    orders.offer_accepted_at,
    orders.offer_version,
    orders.recurring_consent_accepted_at,
    orders.recurring_consent_offer_version,
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
    billingMode: row.billing_mode,
    subscriptionId: row.subscription_id ?? undefined,
    renewalSequence: row.renewal_sequence,
    offerAcceptedAt: row.offer_accepted_at.toISOString(),
    offerVersion: row.offer_version,
    recurringConsentAcceptedAt:
      row.recurring_consent_accepted_at?.toISOString(),
    recurringConsentOfferVersion:
      row.recurring_consent_offer_version ?? undefined,
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

async function lockCustomerAccess(
  client: PoolClient,
  customerId: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 2147483647))",
    [customerId],
  );
}

type AccessGrantRow = {
  order_id: string;
  plan_id: SubscriptionPlanId;
  period_start: Date;
  period_end: Date;
};

async function rebuildSubscriptionProjection(
  client: PoolClient,
  customerId: string,
  changedAt: Date,
) {
  const grants = await client.query<AccessGrantRow>(
    `
      SELECT order_id, plan_id, period_start, period_end
      FROM billing_access_grants
      WHERE customer_id = $1 AND status = 'granted'
      ORDER BY period_end DESC, granted_at DESC, order_id DESC
    `,
    [customerId],
  );
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM billing_subscriptions
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [customerId],
  );
  const currentId = existing.rows[0]?.id;
  const winningGrant = grants.rows[0];

  if (!winningGrant) {
    if (currentId) {
      await client.query(
        `
          UPDATE billing_subscriptions
          SET
            status = 'canceled',
            current_period_end = LEAST(
              COALESCE(current_period_end, $2::timestamptz),
              $2::timestamptz
            ),
            auto_renew = false,
            mandate_id = NULL,
            activated_by_order_id = NULL,
            cancel_at_period_end = true,
            canceled_at = COALESCE(canceled_at, $2::timestamptz),
            renewal_due_at = NULL,
            updated_at = now()
          WHERE id = $1
        `,
        [currentId, changedAt],
      );
    }

    return;
  }

  const periodStart = grants.rows.reduce(
    (earliest, grant) =>
      grant.period_start.getTime() < earliest.getTime()
        ? grant.period_start
        : earliest,
    winningGrant.period_start,
  );
  const status =
    winningGrant.period_end.getTime() > changedAt.getTime()
      ? "active"
      : "expired";

  if (currentId) {
    await client.query(
      `
        UPDATE billing_subscriptions
        SET
          plan_id = $2,
          status = $3,
          current_period_start = $4,
          current_period_end = $5,
          activated_by_order_id = $6,
          renewal_due_at = CASE
            WHEN auto_renew AND NOT cancel_at_period_end THEN $5::timestamptz
            ELSE NULL
          END,
          updated_at = now()
        WHERE id = $1
      `,
      [
        currentId,
        winningGrant.plan_id,
        status,
        periodStart,
        winningGrant.period_end,
        winningGrant.order_id,
      ],
    );
    return;
  }

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
      VALUES ($1, $2, $3, $4, $5, $6, false, NULL, $7)
    `,
    [
      randomUUID(),
      customerId,
      winningGrant.plan_id,
      status,
      periodStart,
      winningGrant.period_end,
      winningGrant.order_id,
    ],
  );
}

async function activateSubscription(
  client: PoolClient,
  checkout: StoredCheckout,
  activatedAt: Date,
) {
  await lockCustomerAccess(client, checkout.customerId);
  const existing = await client.query<{
    id: string;
    current_period_end: Date | null;
    mandate_id: string | null;
    cancel_at_period_end: boolean;
  }>(
    `
      SELECT id, current_period_end, mandate_id, cancel_at_period_end
      FROM billing_subscriptions
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [checkout.customerId],
  );
  const current = existing.rows[0];
  const periodStart =
    checkout.renewalSequence > 0 && current?.current_period_end
      ? current.current_period_end
      : activatedAt;
  const periodEnd = addSubscriptionPeriod(
    periodStart,
    checkout.planId,
  );

  await client.query(
    `
      INSERT INTO billing_access_grants (
        order_id,
        customer_id,
        plan_id,
        status,
        period_start,
        period_end,
        granted_at
      )
      VALUES ($1, $2, $3, 'granted', $4, $5, $4)
      ON CONFLICT (order_id) DO NOTHING
    `,
    [
      checkout.orderId,
      checkout.customerId,
      checkout.planId,
      periodStart,
      periodEnd,
    ],
  );

  let mandateId = current?.mandate_id ?? null;
  const recurringReady =
    checkout.billingMode === "recurring" &&
    checkout.paymentMethodSaved &&
    Boolean(checkout.paymentMethodToken);

  if (recurringReady && checkout.paymentMethodToken) {
    const existingMandate = await client.query<{ id: string }>(
      `
        SELECT id
        FROM billing_payment_mandates
        WHERE customer_id = $1
          AND provider = $2
          AND merchant_account_id = $3
          AND provider_payment_method_token = $4
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [
        checkout.customerId,
        checkout.provider,
        checkout.merchantAccountId,
        checkout.paymentMethodToken,
      ],
    );

    mandateId = existingMandate.rows[0]?.id ?? randomUUID();

    await client.query(
      `
        UPDATE billing_payment_mandates
        SET
          status = 'revoked',
          revoked_at = COALESCE(revoked_at, $5),
          updated_at = now()
        WHERE customer_id = $1
          AND provider = $2
          AND merchant_account_id = $3
          AND status = 'active'
          AND id <> $4
      `,
      [
        checkout.customerId,
        checkout.provider,
        checkout.merchantAccountId,
        mandateId,
        activatedAt,
      ],
    );

    if (!existingMandate.rows[0]) {
      await client.query(
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
            activated_at,
            last_used_at
          )
          VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8)
        `,
        [
          mandateId,
          checkout.customerId,
          checkout.provider,
          checkout.merchantAccountId,
          checkout.paymentMethodToken,
          checkout.recurringConsentAcceptedAt ?? checkout.offerAcceptedAt,
          checkout.recurringConsentOfferVersion ?? checkout.offerVersion,
          activatedAt,
        ],
      );
    } else {
      await client.query(
        `
          UPDATE billing_payment_mandates
          SET
            status = 'active',
            consent_accepted_at = $2,
            consent_offer_version = $3,
            activated_at = $4,
            last_used_at = $4,
            revoked_at = NULL,
            updated_at = now()
          WHERE id = $1
        `,
        [
          mandateId,
          checkout.recurringConsentAcceptedAt ?? checkout.offerAcceptedAt,
          checkout.recurringConsentOfferVersion ?? checkout.offerVersion,
          activatedAt,
        ],
      );
    }
  }

  const autoRenew =
    recurringReady &&
    (checkout.renewalSequence === 0 || !current?.cancel_at_period_end);
  const subscriptionId = current?.id ?? randomUUID();

  if (current) {
    await client.query(
      `
        UPDATE billing_subscriptions
        SET
          plan_id = $2,
          status = 'active',
          current_period_start = $3,
          current_period_end = $4,
          auto_renew = $5,
          mandate_id = $6,
          activated_by_order_id = $7,
          cancel_at_period_end = CASE WHEN $5::boolean THEN false ELSE cancel_at_period_end END,
          canceled_at = CASE WHEN $5::boolean THEN NULL ELSE canceled_at END,
          renewal_due_at = CASE WHEN $5::boolean THEN $4::timestamptz ELSE NULL END,
          renewal_failure_count = 0,
          last_renewal_attempt_at = CASE WHEN $8::integer > 0 THEN $9::timestamptz ELSE last_renewal_attempt_at END,
          renewal_error_code = CASE
            WHEN $5::boolean THEN NULL
            WHEN $10 = 'recurring' THEN 'PAYMENT_METHOD_NOT_SAVED'
            ELSE NULL
          END,
          updated_at = now()
        WHERE id = $1
      `,
      [
        subscriptionId,
        checkout.planId,
        periodStart,
        periodEnd,
        autoRenew,
        mandateId,
        checkout.orderId,
        checkout.renewalSequence,
        activatedAt,
        checkout.billingMode,
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
          activated_by_order_id,
          cancel_at_period_end,
          renewal_due_at,
          renewal_error_code
        )
        VALUES (
          $1, $2, $3, 'active', $4, $5, $6, $7, $8, false,
          CASE WHEN $6::boolean THEN $5::timestamptz ELSE NULL END,
          CASE
            WHEN $6 THEN NULL
            WHEN $9 = 'recurring' THEN 'PAYMENT_METHOD_NOT_SAVED'
            ELSE NULL
          END
        )
      `,
      [
        subscriptionId,
        checkout.customerId,
        checkout.planId,
        periodStart,
        periodEnd,
        autoRenew,
        mandateId,
        checkout.orderId,
        checkout.billingMode,
      ],
    );
  }

  await client.query(
    `
      INSERT INTO billing_subscription_events (
        id,
        subscription_id,
        customer_id,
        event_type,
        details,
        occurred_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    `,
    [
      randomUUID(),
      subscriptionId,
      checkout.customerId,
      checkout.renewalSequence > 0
        ? "subscription.renewed"
        : "subscription.started",
      JSON.stringify({
        orderId: checkout.orderId,
        planId: checkout.planId,
        billingMode: checkout.billingMode,
        autoRenew,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      }),
      activatedAt,
    ],
  );

  await client.query(
    `
      UPDATE billing_access_grace_periods
      SET status = 'revoked', revoked_at = $2, updated_at = now()
      WHERE subscription_id = $1 AND status = 'active'
    `,
    [subscriptionId, activatedAt],
  );

  if (checkout.renewalSequence > 0) {
    await client.query(
      `
        UPDATE billing_subscription_renewal_attempts
        SET
          status = 'succeeded',
          lease_expires_at = NULL,
          completed_at = $2,
          updated_at = now()
        WHERE order_id = $1
          AND status IN ('processing', 'retry_scheduled')
      `,
      [checkout.orderId, activatedAt],
    );
  }
}

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findCheckoutReservationByIdempotencyKey(
    idempotencyKey: string,
  ) {
    return findReservationByIdempotencyKey(
      this.pool,
      idempotencyKey,
    );
  }

  async reserveCheckout(input: ReserveCheckoutInput) {
    const client = await this.pool.connect();
    const checkoutAt = this.now();

    try {
      await client.query("BEGIN");
      await lockCustomerAccess(client, input.customerId);
      const existing = await findReservationByIdempotencyKey(
        client,
        input.idempotencyKey,
      );

      if (existing) {
        await client.query("COMMIT");
        return existing;
      }

      const activeAccess = await client.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM billing_access_grants
            WHERE customer_id = $1
              AND status = 'granted'
              AND period_start <= $2::timestamptz
              AND period_end > $2::timestamptz
          ) AS exists
        `,
        [input.customerId, checkoutAt],
      );

      if (activeAccess.rows[0]?.exists) {
        throw new BillingError(
          "ACCESS_ALREADY_ACTIVE",
          "Доступ уже оплачен. Новый тариф можно выбрать после окончания текущего периода.",
          409,
        );
      }

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
            billing_mode,
            subscription_id,
            renewal_sequence,
            offer_accepted_at,
            offer_version,
            recurring_consent_accepted_at,
            recurring_consent_offer_version,
            receipt_email,
            receipt_phone,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18, $19, $20, $20
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
          input.billingMode,
          input.subscriptionId ?? null,
          input.renewalSequence,
          input.offerAcceptedAt,
          input.offerVersion,
          input.recurringConsentAcceptedAt ?? null,
          input.recurringConsentOfferVersion ?? null,
          input.receiptContact.email ?? null,
          input.receiptContact.phone ?? null,
          input.createdAt,
        ],
      );
      const reservation = await findReservationByIdempotencyKey(
        client,
        input.idempotencyKey,
      );

      if (!reservation) {
        throw new Error("Не удалось зарезервировать заказ");
      }

      await client.query("COMMIT");
      return reservation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findCheckoutByIdempotencyKey(idempotencyKey: string) {
    return findByIdempotencyKey(this.pool, idempotencyKey);
  }

  async saveCheckout(input: SaveCheckoutInput) {
    const client = await this.pool.connect();
    const processedAt = this.now();

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
            payment_method_token,
            payment_method_saved,
            paid_at,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $14
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
          input.paymentMethodSaved,
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
        await activateSubscription(client, input, processedAt);
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
    const processedAt = this.now();

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
        paymentMethodToken:
          input.paymentMethodToken ?? checkout.paymentMethodToken,
        paymentMethodSaved:
          input.paymentMethodSaved === true || checkout.paymentMethodSaved,
        updatedAt: processedAt.toISOString(),
      };

      await client.query(
        `
          UPDATE billing_payments
          SET
            status = $2,
            payment_method_token = COALESCE($4, payment_method_token),
            payment_method_saved = payment_method_saved OR $5,
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
          input.paymentMethodToken ?? null,
          input.paymentMethodSaved === true,
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
          processedAt,
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
    const processedAt = this.now();

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
        if (nextStatus === "refunded") {
          await lockCustomerAccess(client, checkout.customerId);
          await client.query(
            `
              UPDATE billing_access_grants
              SET
                status = 'revoked',
                revoked_at = COALESCE(revoked_at, $2::timestamptz),
                updated_at = now()
              WHERE order_id = $1 AND status = 'granted'
            `,
            [checkout.orderId, processedAt],
          );
          await rebuildSubscriptionProjection(
            client,
            checkout.customerId,
            processedAt,
          );
        }
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
          updatedAt: processedAt.toISOString(),
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
  cancelAtPeriodEnd: boolean;
  renewalDueAt?: string;
  renewalErrorCode?: string;
  gracePeriodEnd?: string;
  recurringAvailable: boolean;
};

export async function getSubscriptionSummary(
  pool: Pool | PoolClient,
  customerId: string,
): Promise<SubscriptionSummary | null> {
  const result = await pool.query<{
    status: SubscriptionSummary["status"];
    plan_id: SubscriptionPlanId;
    current_period_end: Date | null;
    auto_renew: boolean;
    cancel_at_period_end: boolean;
    renewal_due_at: Date | null;
    renewal_error_code: string | null;
    grace_period_end: Date | null;
  }>(
    `
      SELECT
        subscriptions.status,
        subscriptions.plan_id,
        subscriptions.current_period_end,
        subscriptions.auto_renew,
        subscriptions.cancel_at_period_end,
        subscriptions.renewal_due_at,
        subscriptions.renewal_error_code,
        grace.period_end AS grace_period_end
      FROM billing_subscriptions subscriptions
      LEFT JOIN billing_access_grace_periods grace
        ON grace.subscription_id = subscriptions.id
       AND grace.status = 'active'
      WHERE subscriptions.customer_id = $1
      ORDER BY subscriptions.created_at DESC
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
        cancelAtPeriodEnd: row.cancel_at_period_end,
        renewalDueAt: row.renewal_due_at?.toISOString(),
        renewalErrorCode: row.renewal_error_code ?? undefined,
        gracePeriodEnd: row.grace_period_end?.toISOString(),
        recurringAvailable: row.auto_renew || row.cancel_at_period_end,
      }
    : null;
}

export async function setSubscriptionRenewal(
  pool: Pool,
  customerId: string,
  enabled: boolean,
  changedAt: Date = new Date(),
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockCustomerAccess(client, customerId);
    const result = await client.query<{
      id: string;
      status: SubscriptionSummary["status"];
      current_period_end: Date | null;
      auto_renew: boolean;
      cancel_at_period_end: boolean;
      mandate_id: string | null;
      mandate_status: string | null;
      grace_period_end: Date | null;
      has_open_renewal: boolean;
    }>(
      `
        SELECT
          subscriptions.id,
          subscriptions.status,
          subscriptions.current_period_end,
          subscriptions.auto_renew,
          subscriptions.cancel_at_period_end,
          subscriptions.mandate_id,
          mandates.status AS mandate_status,
          grace.period_end AS grace_period_end,
          EXISTS (
            SELECT 1
            FROM billing_subscription_renewal_attempts attempts
            WHERE attempts.subscription_id = subscriptions.id
              AND attempts.status IN ('processing', 'retry_scheduled')
          ) AS has_open_renewal
        FROM billing_subscriptions subscriptions
        LEFT JOIN billing_payment_mandates mandates
          ON mandates.id = subscriptions.mandate_id
        LEFT JOIN billing_access_grace_periods grace
          ON grace.subscription_id = subscriptions.id
         AND grace.status = 'active'
        WHERE subscriptions.customer_id = $1
        ORDER BY subscriptions.created_at DESC
        LIMIT 1
        FOR UPDATE OF subscriptions
      `,
      [customerId],
    );
    const subscription = result.rows[0];

    const paidPeriodIsActive = Boolean(
      subscription?.current_period_end &&
        subscription.current_period_end.getTime() > changedAt.getTime(),
    );
    const gracePeriodIsActive = Boolean(
      subscription?.grace_period_end &&
        subscription.grace_period_end.getTime() > changedAt.getTime(),
    );

    if (
      !subscription ||
      (enabled
        ? !paidPeriodIsActive
        : !paidPeriodIsActive &&
          !gracePeriodIsActive &&
          !subscription.has_open_renewal)
    ) {
      throw new BillingError(
        "SUBSCRIPTION_NOT_ACTIVE",
        "Активная подписка не найдена.",
        409,
      );
    }

    if (
      enabled &&
      (!subscription.mandate_id || subscription.mandate_status !== "active")
    ) {
      throw new BillingError(
        "PAYMENT_METHOD_NOT_SAVED",
        "Для автоматического продления требуется заново привязать способ оплаты.",
        409,
      );
    }

    await client.query(
      `
        UPDATE billing_subscriptions
        SET
          auto_renew = $2::boolean,
          cancel_at_period_end = NOT $2::boolean,
          canceled_at = CASE WHEN $2::boolean THEN NULL ELSE $3::timestamptz END,
          renewal_due_at = CASE WHEN $2::boolean THEN current_period_end ELSE NULL END,
          renewal_error_code = CASE WHEN $2::boolean THEN NULL ELSE renewal_error_code END,
          updated_at = now()
        WHERE id = $1
      `,
      [subscription.id, enabled, changedAt],
    );
    if (!enabled) {
      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET
            status = 'canceled',
            lease_expires_at = NULL,
            completed_at = $2,
            updated_at = now()
          WHERE subscription_id = $1
            AND status IN ('processing', 'retry_scheduled')
        `,
        [subscription.id, changedAt],
      );
    }
    await client.query(
      `
        INSERT INTO billing_subscription_events (
          id,
          subscription_id,
          customer_id,
          event_type,
          details,
          occurred_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        randomUUID(),
        subscription.id,
        customerId,
        enabled
          ? "subscription.renewal_enabled"
          : "subscription.renewal_disabled",
        JSON.stringify({
          previousAutoRenew: subscription.auto_renew,
          previousCancelAtPeriodEnd: subscription.cancel_at_period_end,
        }),
        changedAt,
      ],
    );
    const summary = await getSubscriptionSummary(client, customerId);
    await client.query("COMMIT");

    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type CustomerOrderHistoryItem = {
  id: string;
  planId: SubscriptionPlanId;
  status: OrderStatus;
  amountMinor: number;
  currency: "RUB";
  provider: PaymentProviderId;
  createdAt: string;
  paidAt?: string;
};

export async function getCustomerOrderHistory(
  pool: Pool,
  customerId: string,
  requestedLimit = 50,
): Promise<CustomerOrderHistoryItem[]> {
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
    : 50;
  const result = await pool.query<{
    id: string;
    plan_id: SubscriptionPlanId;
    status: OrderStatus;
    amount_minor: string;
    currency: "RUB";
    selected_provider: PaymentProviderId;
    created_at: Date;
    paid_at: Date | null;
  }>(
    `
      SELECT
        orders.id,
        orders.plan_id,
        orders.status,
        orders.amount_minor,
        orders.currency,
        orders.selected_provider,
        orders.created_at,
        payments.paid_at
      FROM billing_orders orders
      LEFT JOIN LATERAL (
        SELECT paid_at
        FROM billing_payments
        WHERE order_id = orders.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) payments ON true
      WHERE orders.customer_id = $1
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT $2
    `,
    [customerId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    planId: row.plan_id,
    status: row.status,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    provider: row.selected_provider,
    createdAt: row.created_at.toISOString(),
    paidAt: row.paid_at?.toISOString(),
  }));
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
