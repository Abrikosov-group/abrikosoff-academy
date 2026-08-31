import { createHash, randomUUID } from "node:crypto";
import {
  decideNextFinancialRenewalAttempt,
  renewalGracePeriodMilliseconds,
} from "../../src/modules/billing/domain/subscription-renewal-policy.mjs";

const gracePeriodMilliseconds = renewalGracePeriodMilliseconds;
const transportRetryDelaysMilliseconds = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  gracePeriodMilliseconds,
];

function transportRetryDelayMilliseconds(retryCount) {
  return transportRetryDelaysMilliseconds[
    Math.min(retryCount, transportRetryDelaysMilliseconds.length - 1)
  ];
}

function subscriptionPeriodEnd(periodStart, planId) {
  const start = new Date(periodStart);
  const months = planId === "annual" ? 12 : 1;
  const targetYear = start.getUTCFullYear();
  const targetMonth = start.getUTCMonth() + months;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
}

function deterministicIdempotencyKey(
  subscriptionId,
  renewalSequence,
  attemptNumber = 1,
) {
  return createHash("sha256")
    .update(
      `subscription-renewal:${subscriptionId}:${renewalSequence}:${attemptNumber}`,
    )
    .digest("hex");
}

function formatMoney(amountMinor, currency) {
  return {
    value: (Number(amountMinor) / 100).toFixed(2),
    currency,
  };
}

function receiptFor(row) {
  if (!row.receipt_email && !row.receipt_phone) {
    throw new Error("RENEWAL_RECEIPT_CONTACT_MISSING");
  }

  return {
    customer: {
      ...(row.receipt_email ? { email: row.receipt_email } : {}),
      ...(row.receipt_phone ? { phone: row.receipt_phone } : {}),
    },
    items: [
      {
        description: "Доступ к онлайн-материалам Академии Абрикософф",
        quantity: "1.00",
        amount: formatMoney(row.amount_minor, row.currency),
        vat_code: 1,
        payment_subject: "service",
        payment_mode: "full_payment",
      },
    ],
  };
}

export async function createYooKassaRenewal(
  row,
  fetchImplementation,
  { onRequestStarted = () => {} } = {},
) {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("RENEWAL_PROVIDER_NOT_CONFIGURED");
  }

  const body = JSON.stringify({
    amount: formatMoney(row.amount_minor, row.currency),
    capture: true,
    payment_method_id: row.provider_payment_method_token,
    description: `Продление: ${row.plan_id === "annual" ? "Годовой" : "Месячный"} тариф — Академия Абрикософф`,
    receipt: receiptFor(row),
    metadata: {
      internal_order_id: row.order_id,
      renewal_attempt_id: row.id,
      customer_id: row.customer_id,
      plan_id: row.plan_id,
      legal_entity_id: row.legal_entity_id,
      operation: "subscription_renewal",
    },
  });
  await onRequestStarted();
  let response;

  try {
    response = await fetchImplementation(
      "https://api.yookassa.ru/v3/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotence-Key": row.idempotency_key,
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new Error("RENEWAL_PROVIDER_OUTCOME_UNKNOWN", { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      response.status >= 500
        ? "RENEWAL_PROVIDER_OUTCOME_UNKNOWN"
        : "RENEWAL_PROVIDER_REJECTED",
    );
  }

  let payload;

  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("RENEWAL_PROVIDER_OUTCOME_UNKNOWN", { cause: error });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    typeof payload.status !== "string"
  ) {
    throw new Error("RENEWAL_PROVIDER_OUTCOME_UNKNOWN");
  }

  return {
    externalPaymentId: payload.id,
    status:
      payload.status === "succeeded"
        ? "succeeded"
        : payload.status === "canceled"
          ? "canceled"
          : "pending",
    paidAt: payload.captured_at || payload.created_at || null,
    paymentMethodToken:
      payload.payment_method?.saved === true
        ? payload.payment_method.id
        : row.provider_payment_method_token,
  };
}

export async function getYooKassaRenewal(
  row,
  externalPaymentId,
  fetchImplementation,
) {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("RENEWAL_PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetchImplementation(
    `https://api.yookassa.ru/v3/payments/${encodeURIComponent(externalPaymentId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      response.status >= 500
        ? "RENEWAL_PROVIDER_TEMPORARY_FAILURE"
        : "RENEWAL_PROVIDER_REJECTED",
    );
  }

  return {
    externalPaymentId: payload.id,
    status:
      payload.status === "succeeded"
        ? "succeeded"
        : payload.status === "canceled"
          ? "canceled"
          : "pending",
    paidAt: payload.captured_at || payload.created_at || null,
    paymentMethodToken:
      payload.payment_method?.saved === true
        ? payload.payment_method.id
        : row.provider_payment_method_token,
  };
}

function createDemoRenewal(row, now) {
  return {
    externalPaymentId: `demo_renewal_${row.idempotency_key.slice(0, 24)}`,
    status: "succeeded",
    paidAt: now.toISOString(),
    paymentMethodToken: row.provider_payment_method_token,
  };
}

async function claimRenewal(client, now) {
  await client.query("BEGIN");

  try {
    let attempt = await client.query(
      `
        SELECT attempts.*
        FROM billing_subscription_renewal_attempts attempts
        JOIN billing_subscriptions subscriptions
          ON subscriptions.id = attempts.subscription_id
        WHERE attempts.status IN ('processing', 'retry_scheduled')
          AND attempts.next_attempt_at <= $1
          AND (
            attempts.lease_expires_at IS NULL
            OR attempts.lease_expires_at <= $1
          )
          AND subscriptions.auto_renew
          AND NOT subscriptions.cancel_at_period_end
          AND subscriptions.status IN ('active', 'grace_period')
        ORDER BY attempts.next_attempt_at, attempts.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [now],
    );

    if (!attempt.rows[0]) {
      const due = await client.query(
        `
          SELECT
            subscriptions.id,
            subscriptions.customer_id,
            subscriptions.plan_id,
            subscriptions.current_period_end,
            subscriptions.mandate_id,
            subscriptions.renewal_failure_count,
            mandates.provider,
            mandates.merchant_account_id,
            mandates.provider_payment_method_token,
            mandates.consent_accepted_at,
            mandates.consent_offer_version,
            latest_order.legal_entity_id,
            latest_order.country_code,
            latest_order.receipt_email,
            latest_order.receipt_phone,
            (
              SELECT COALESCE(MAX(orders.renewal_sequence), 0)::integer + 1
              FROM billing_orders orders
              WHERE orders.subscription_id = subscriptions.id
            ) AS renewal_sequence
          FROM billing_subscriptions subscriptions
          JOIN billing_payment_mandates mandates
            ON mandates.id = subscriptions.mandate_id
           AND mandates.status = 'active'
          JOIN LATERAL (
            SELECT legal_entity_id, country_code, receipt_email, receipt_phone
            FROM billing_orders
            WHERE customer_id = subscriptions.customer_id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ) latest_order ON true
          WHERE subscriptions.auto_renew
            AND NOT subscriptions.cancel_at_period_end
            AND subscriptions.renewal_due_at <= $1
            AND subscriptions.status IN ('active', 'grace_period')
            AND NOT EXISTS (
              SELECT 1
              FROM billing_subscription_renewal_attempts open_attempts
              WHERE open_attempts.subscription_id = subscriptions.id
                AND open_attempts.status IN (
                  'processing',
                  'retry_scheduled',
                  'reconciliation_required'
                )
            )
          ORDER BY subscriptions.renewal_due_at, subscriptions.id
          LIMIT 1
          FOR UPDATE OF subscriptions SKIP LOCKED
        `,
        [now],
      );
      const subscription = due.rows[0];

      if (!subscription) {
        await client.query("COMMIT");
        return null;
      }

      const attemptId = randomUUID();
      const orderId = randomUUID();
      const periodStart = subscription.current_period_end;
      const periodEnd = subscriptionPeriodEnd(
        periodStart,
        subscription.plan_id,
      );
      const idempotencyKey = deterministicIdempotencyKey(
        subscription.id,
        subscription.renewal_sequence,
        1,
      );
      const amountMinor =
        subscription.plan_id === "annual" ? 1_400_000 : 150_000;

      const insertedOrder = await client.query(
        `
          INSERT INTO billing_orders (
            id, customer_id, plan_id, legal_entity_id, country_code,
            amount_minor, currency, status, idempotency_key,
            selected_provider, merchant_account_id, billing_mode,
            subscription_id, renewal_sequence, offer_accepted_at,
            offer_version, recurring_consent_accepted_at,
            recurring_consent_offer_version, receipt_email, receipt_phone
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, 'RUB', 'pending', $7, $8, $9,
            'recurring', $10, $11, $12, $13, $12, $13, $14, $15
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [
          orderId,
          subscription.customer_id,
          subscription.plan_id,
          subscription.legal_entity_id,
          subscription.country_code,
          amountMinor,
          idempotencyKey,
          subscription.provider,
          subscription.merchant_account_id,
          subscription.id,
          subscription.renewal_sequence,
          subscription.consent_accepted_at,
          subscription.consent_offer_version,
          subscription.receipt_email,
          subscription.receipt_phone,
        ],
      );

      if (!insertedOrder.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `
          INSERT INTO billing_subscription_renewal_attempts (
            id, subscription_id, customer_id, order_id, renewal_sequence,
            attempt_number, idempotency_key, status, period_start,
            period_end, next_attempt_at, lease_expires_at
          )
          VALUES (
            $1, $2, $3, $4, $5, 1, $6, 'processing', $7, $8, $9,
            $9::timestamptz + interval '2 minutes'
          )
        `,
        [
          attemptId,
          subscription.id,
          subscription.customer_id,
          orderId,
          subscription.renewal_sequence,
          idempotencyKey,
          periodStart,
          periodEnd,
          now,
        ],
      );
      attempt = await client.query(
        "SELECT * FROM billing_subscription_renewal_attempts WHERE id = $1",
        [attemptId],
      );
    } else {
      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET
            status = 'processing',
            lease_expires_at = $2::timestamptz + interval '2 minutes',
            updated_at = now()
          WHERE id = $1
        `,
        [attempt.rows[0].id, now],
      );
    }

    const claimed = await client.query(
      `
        SELECT
          attempts.*,
          subscriptions.plan_id,
          subscriptions.customer_id,
          subscriptions.mandate_id,
          mandates.provider,
          mandates.merchant_account_id,
          mandates.provider_payment_method_token,
          orders.legal_entity_id,
          orders.country_code,
          orders.amount_minor,
          orders.currency,
          orders.receipt_email,
          orders.receipt_phone,
          current_payment.external_payment_id,
          current_payment.status AS external_payment_status
        FROM billing_subscription_renewal_attempts attempts
        JOIN billing_subscriptions subscriptions
          ON subscriptions.id = attempts.subscription_id
        JOIN billing_payment_mandates mandates
          ON mandates.id = subscriptions.mandate_id
        JOIN billing_orders orders ON orders.id = attempts.order_id
        LEFT JOIN LATERAL (
          SELECT payments.external_payment_id, payments.status
          FROM billing_payments payments
          WHERE payments.order_id = attempts.order_id
            AND payments.provider_operation_key = attempts.idempotency_key
          ORDER BY payments.created_at DESC, payments.id DESC
          LIMIT 1
        ) current_payment ON true
        WHERE attempts.id = $1
      `,
      [attempt.rows[0].id],
    );

    await client.query("COMMIT");
    return claimed.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function acquireRenewalLock(client, customerId) {
  await client.query(
    "SELECT pg_advisory_lock(hashtextextended($1, 2147483647))",
    [customerId],
  );
}

async function releaseRenewalLock(client, customerId) {
  const result = await client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 2147483647)) AS unlocked",
    [customerId],
  );

  if (result.rows[0]?.unlocked !== true) {
    throw new Error("RENEWAL_LOCK_RELEASE_FAILED");
  }
}

async function renewalStillAllowed(client, row) {
  await client.query("BEGIN");

  try {
    const state = await client.query(
      `
        SELECT
          attempts.status AS attempt_status,
          subscriptions.auto_renew,
          subscriptions.cancel_at_period_end,
          subscriptions.status AS subscription_status,
          subscriptions.current_period_end,
          subscriptions.mandate_id,
          mandates.status AS mandate_status,
          mandates.provider AS mandate_provider,
          mandates.merchant_account_id AS mandate_merchant_account_id
        FROM billing_subscription_renewal_attempts attempts
        JOIN billing_subscriptions subscriptions
          ON subscriptions.id = attempts.subscription_id
        LEFT JOIN billing_payment_mandates mandates
          ON mandates.id = subscriptions.mandate_id
        WHERE attempts.id = $1
        FOR UPDATE OF attempts, subscriptions
      `,
      [row.id],
    );
    const current = state.rows[0];
    const allowed = Boolean(
      current &&
        current.attempt_status === "processing" &&
        current.auto_renew &&
        !current.cancel_at_period_end &&
        new Date(current.current_period_end).getTime() ===
          new Date(row.period_start).getTime() &&
        current.mandate_id === row.mandate_id &&
        current.mandate_status === "active" &&
        current.mandate_provider === row.provider &&
        current.mandate_merchant_account_id ===
          row.merchant_account_id &&
        (current.subscription_status === "active" ||
          current.subscription_status === "grace_period"),
    );

    if (current && !allowed &&
        (current.attempt_status === "processing" ||
          current.attempt_status === "retry_scheduled")) {
      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET
            status = 'canceled',
            lease_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
          WHERE id = $1
        `,
        [row.id],
      );
    }

    await client.query("COMMIT");
    return allowed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function createOrRefreshGracePeriod(
  client,
  row,
  periodEnd,
  now,
) {
  await client.query(
    `
      UPDATE billing_access_grace_periods
      SET status = 'expired', revoked_at = $4, updated_at = now()
      WHERE subscription_id = $1
        AND status = 'active'
        AND (period_start, period_end) <> ($2::timestamptz, $3::timestamptz)
    `,
    [row.subscription_id, row.period_start, periodEnd, now],
  );
  await client.query(
    `
      INSERT INTO billing_access_grace_periods (
        subscription_id, customer_id, status, period_start, period_end
      )
      VALUES ($1, $2, 'active', $3, $4)
      ON CONFLICT (subscription_id, period_start, period_end)
      DO UPDATE SET
        status = 'active',
        revoked_at = NULL,
        updated_at = now()
    `,
    [row.subscription_id, row.customer_id, row.period_start, periodEnd],
  );
}

async function markRenewalRequestStarted(client, row, now) {
  await client.query("BEGIN");

  try {
    const graceEnd = new Date(
      new Date(row.period_start).getTime() + gracePeriodMilliseconds,
    );
    const marked = await client.query(
      `
        UPDATE billing_subscription_renewal_attempts
        SET
          status = 'reconciliation_required',
          next_attempt_at = $2,
          lease_expires_at = NULL,
          last_error_code = 'RENEWAL_PROVIDER_OUTCOME_UNKNOWN',
          updated_at = now()
        WHERE id = $1 AND status = 'processing'
        RETURNING id
      `,
      [row.id, now],
    );

    if (!marked.rowCount) {
      throw new Error("RENEWAL_ATTEMPT_STATE_CHANGED");
    }

    await client.query(
      `
        UPDATE billing_subscriptions
        SET
          status = 'grace_period',
          last_renewal_attempt_at = $2,
          renewal_error_code = 'RENEWAL_PROVIDER_OUTCOME_UNKNOWN',
          updated_at = now()
        WHERE id = $1
      `,
      [row.subscription_id, now],
    );
    await createOrRefreshGracePeriod(client, row, graceEnd, now);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function updateRenewalOrderStatus(client, orderId, fallbackStatus) {
  await client.query(
    `
      UPDATE billing_orders orders
      SET
        status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM billing_payments payments
            WHERE payments.order_id = orders.id
              AND payments.status = 'succeeded'
          ) THEN 'paid'
          WHEN EXISTS (
            SELECT 1
            FROM billing_subscription_renewal_attempts attempts
            WHERE attempts.order_id = orders.id
              AND attempts.status IN (
                'processing',
                'retry_scheduled',
                'reconciliation_required'
              )
          ) THEN 'pending'
          WHEN EXISTS (
            SELECT 1
            FROM billing_payments payments
            WHERE payments.order_id = orders.id
              AND payments.status = 'partially_refunded'
          ) THEN 'partially_refunded'
          WHEN EXISTS (
            SELECT 1
            FROM billing_payments payments
            WHERE payments.order_id = orders.id
              AND payments.status = 'refunded'
          ) THEN 'refunded'
          ELSE $2
        END,
        updated_at = now()
      WHERE orders.id = $1
    `,
    [orderId, fallbackStatus],
  );
}

async function expireEndedGracePeriods(client, now) {
  await client.query("BEGIN");

  try {
    const ended = await client.query(
      `
        SELECT id, subscription_id, customer_id, period_end
        FROM billing_access_grace_periods
        WHERE status = 'active' AND period_end <= $1
        ORDER BY period_end, id
      `,
      [now],
    );

    for (const row of ended.rows) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 2147483647))",
        [row.customer_id],
      );
      const expired = await client.query(
        `
          UPDATE billing_access_grace_periods
          SET status = 'expired', revoked_at = $2, updated_at = now()
          WHERE id = $1 AND status = 'active' AND period_end <= $2
          RETURNING id
        `,
        [row.id, now],
      );

      if (!expired.rowCount) continue;

      const subscription = await client.query(
        `
          UPDATE billing_subscriptions
          SET
            status = 'past_due',
            auto_renew = false,
            cancel_at_period_end = true,
            renewal_due_at = NULL,
            updated_at = now()
          WHERE id = $1 AND status = 'grace_period'
          RETURNING id
        `,
        [row.subscription_id],
      );

      if (subscription.rowCount) {
        await client.query(
          `
            UPDATE billing_subscription_renewal_attempts attempts
            SET
              status = 'reconciliation_required',
              next_attempt_at = $2,
              lease_expires_at = NULL,
              last_error_code = COALESCE(
                attempts.last_error_code,
                'RENEWAL_GRACE_PERIOD_EXPIRED'
              ),
              updated_at = now()
            WHERE attempts.subscription_id = $1
              AND attempts.status IN ('processing', 'retry_scheduled')
              AND EXISTS (
                SELECT 1
                FROM billing_payments payments
                WHERE payments.order_id = attempts.order_id
                  AND payments.provider_operation_key = attempts.idempotency_key
              )
          `,
          [row.subscription_id, now],
        );
        const terminalAttempts = await client.query(
          `
            UPDATE billing_subscription_renewal_attempts attempts
            SET
              status = 'failed',
              next_attempt_at = $2,
              lease_expires_at = NULL,
              last_error_code = 'RENEWAL_GRACE_PERIOD_EXPIRED_BEFORE_REQUEST',
              completed_at = $2,
              updated_at = now()
            WHERE attempts.subscription_id = $1
              AND attempts.status IN ('processing', 'retry_scheduled')
              AND NOT EXISTS (
                SELECT 1
                FROM billing_payments payments
                WHERE payments.order_id = attempts.order_id
                  AND payments.provider_operation_key = attempts.idempotency_key
              )
            RETURNING order_id
          `,
          [row.subscription_id, now],
        );
        const orderIds = new Set(
          terminalAttempts.rows.map((attempt) => attempt.order_id),
        );

        for (const orderId of orderIds) {
          await updateRenewalOrderStatus(client, orderId, "canceled");
        }
        await client.query(
          `
            INSERT INTO billing_subscription_events (
              id, subscription_id, customer_id, event_type, details, occurred_at
            )
            VALUES ($1, $2, $3, 'subscription.expired', $4::jsonb, $5)
          `,
          [
            randomUUID(),
            row.subscription_id,
            row.customer_id,
            JSON.stringify({ gracePeriodEnd: row.period_end.toISOString() }),
            now,
          ],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function completeRenewal(client, row, payment, now) {
  await client.query("BEGIN");

  try {
    const previousPayment = await client.query(
      `
        SELECT id, status
        FROM billing_payments
        WHERE provider = $1
          AND merchant_account_id = $2
          AND provider_operation_key = $3
        FOR UPDATE
      `,
      [row.provider, row.merchant_account_id, row.idempotency_key],
    );
    const previousStatus = previousPayment.rows[0]?.status ?? null;
    const paymentId = previousPayment.rows[0]?.id ?? randomUUID();
    const savedPayment = await client.query(
      `
        INSERT INTO billing_payments (
          id, order_id, provider, merchant_account_id, external_payment_id,
          provider_operation_key, status, amount_minor, currency,
          payment_method_token, payment_method_saved, paid_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
        ON CONFLICT (provider, merchant_account_id, provider_operation_key)
        DO UPDATE SET
          status = CASE
            WHEN billing_payments.status IN (
              'partially_refunded',
              'refunded'
            ) THEN billing_payments.status
            ELSE EXCLUDED.status
          END,
          payment_method_token = EXCLUDED.payment_method_token,
          payment_method_saved = true,
          paid_at = COALESCE(billing_payments.paid_at, EXCLUDED.paid_at),
          updated_at = now()
        WHERE billing_payments.external_payment_id = EXCLUDED.external_payment_id
        RETURNING id, status
      `,
      [
        paymentId, row.order_id, row.provider, row.merchant_account_id,
        payment.externalPaymentId, row.idempotency_key, payment.status,
        row.amount_minor, row.currency, payment.paymentMethodToken,
        payment.paidAt,
      ],
    );

    if (!savedPayment.rowCount) {
      throw new Error("RENEWAL_PROVIDER_OPERATION_MISMATCH");
    }
    const appliedStatus = savedPayment.rows[0].status;
    if (previousStatus !== appliedStatus) {
      await client.query(
        `
          INSERT INTO billing_payment_events (
            id, payment_id, event_type, from_status, to_status, details,
            occurred_at
          )
          VALUES ($1, $2, 'payment.renewal_provider_result', $3, $4, $5::jsonb, $6)
        `,
        [
          randomUUID(),
          savedPayment.rows[0].id,
          previousStatus,
          appliedStatus,
          JSON.stringify({
            source: "subscription_renewal",
            renewalSequence: row.renewal_sequence,
            attemptNumber: row.attempt_number,
          }),
          now,
        ],
      );
    }
    await client.query(
      "UPDATE billing_orders SET status = $2, updated_at = now() WHERE id = $1",
      [
        row.order_id,
        appliedStatus === "succeeded"
          ? "paid"
          : appliedStatus === "partially_refunded" ||
              appliedStatus === "refunded"
            ? appliedStatus
            : "pending",
      ],
    );

    if (appliedStatus === "succeeded") {
      const updatedMandate = await client.query(
        `
          UPDATE billing_payment_mandates
          SET
            provider_payment_method_token = $2,
            last_used_at = $3,
            updated_at = now()
          WHERE id = $1
            AND customer_id = $4
            AND provider = $5
            AND merchant_account_id = $6
            AND status = 'active'
          RETURNING id
        `,
        [
          row.mandate_id,
          payment.paymentMethodToken,
          now,
          row.customer_id,
          row.provider,
          row.merchant_account_id,
        ],
      );
      const automaticRenewalContinues = updatedMandate.rowCount === 1;
      const activeGrant = await client.query(
        `
          WITH inserted AS (
            INSERT INTO billing_access_grants (
              order_id, customer_id, plan_id, status, period_start,
              period_end, granted_at
            )
            VALUES ($1, $2, $3, 'granted', $4, $5, $6)
            ON CONFLICT (order_id) DO NOTHING
            RETURNING order_id
          )
          SELECT order_id
          FROM inserted
          UNION ALL
          SELECT order_id
          FROM billing_access_grants
          WHERE order_id = $1 AND status = 'granted'
          LIMIT 1
        `,
        [row.order_id, row.customer_id, row.plan_id, row.period_start, row.period_end, now],
      );
      if (!activeGrant.rowCount) {
        throw new Error("RENEWAL_ACCESS_GRANT_CONFLICT");
      }
      await client.query(
        `
          UPDATE billing_subscriptions
          SET
            status = 'active',
            current_period_start = $2,
            current_period_end = $3,
            auto_renew = CASE WHEN $6::boolean THEN auto_renew ELSE false END,
            cancel_at_period_end = CASE
              WHEN $6::boolean THEN cancel_at_period_end
              ELSE true
            END,
            renewal_due_at = CASE
              WHEN $6::boolean THEN $3::timestamptz
              ELSE NULL
            END,
            renewal_failure_count = 0,
            last_renewal_attempt_at = $4,
            renewal_error_code = CASE
              WHEN $6::boolean THEN NULL
              ELSE 'PAYMENT_METHOD_NOT_SAVED'
            END,
            activated_by_order_id = $5,
            updated_at = now()
          WHERE id = $1
        `,
        [
          row.subscription_id,
          row.period_start,
          row.period_end,
          now,
          row.order_id,
          automaticRenewalContinues,
        ],
      );
      await client.query(
        `
          UPDATE billing_access_grace_periods
          SET status = 'revoked', revoked_at = $2, updated_at = now()
          WHERE subscription_id = $1 AND status = 'active'
        `,
        [row.subscription_id, now],
      );
      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET status = 'succeeded', lease_expires_at = NULL,
              completed_at = $2, updated_at = now()
          WHERE id = $1
        `,
        [row.id, now],
      );
      await client.query(
        `
          INSERT INTO billing_subscription_events (
            id, subscription_id, customer_id, event_type, details, occurred_at
          )
          VALUES ($1, $2, $3, 'subscription.renewed', $4::jsonb, $5)
        `,
        [
          randomUUID(), row.subscription_id, row.customer_id,
          JSON.stringify({
            orderId: row.order_id,
            renewalSequence: row.renewal_sequence,
            automaticRenewalContinues,
          }),
          now,
        ],
      );
    } else if (appliedStatus === "pending") {
      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET
            status = 'retry_scheduled',
            next_attempt_at = $2::timestamptz + interval '15 minutes',
            lease_expires_at = NULL,
            updated_at = now()
          WHERE id = $1
        `,
        [row.id, now],
      );
      await client.query(
        `
          UPDATE billing_subscriptions
          SET
            status = 'grace_period',
            last_renewal_attempt_at = $2,
            renewal_error_code = NULL,
            updated_at = now()
          WHERE id = $1
        `,
        [row.subscription_id, now],
      );
      await createOrRefreshGracePeriod(
        client,
        row,
        new Date(
          new Date(row.period_start).getTime() + gracePeriodMilliseconds,
        ),
        now,
      );
    }

    await client.query("COMMIT");
    return { ...payment, status: appliedStatus };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function failRenewal(client, row, errorCode, now) {
  await client.query("BEGIN");

  try {
    const reconciliationRequired =
      errorCode === "RENEWAL_PROVIDER_OUTCOME_UNKNOWN";
    const startsNewFinancialAttempt =
      errorCode === "RENEWAL_PROVIDER_REJECTED";
    const graceEnd = new Date(
      new Date(row.period_start).getTime() + gracePeriodMilliseconds,
    );
    const graceExpired = now.getTime() >= graceEnd.getTime();
    const financialDecision = startsNewFinancialAttempt
      ? decideNextFinancialRenewalAttempt({
          attemptNumber: row.attempt_number,
          processedAt: now,
          graceEnd,
        })
      : null;
    const terminalFailure =
      !reconciliationRequired &&
      (startsNewFinancialAttempt
        ? financialDecision.kind === "exhausted"
        : graceExpired);
    const retryAt = reconciliationRequired || terminalFailure
      ? now
      : startsNewFinancialAttempt
        ? financialDecision.nextAttemptAt
        : new Date(
            Math.min(
              now.getTime() +
                transportRetryDelayMilliseconds(row.transport_retry_count),
              graceEnd.getTime(),
            ),
          );

    if (startsNewFinancialAttempt && !terminalFailure) {
      const nextAttemptNumber = row.attempt_number + 1;

      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET
            status = 'canceled',
            lease_expires_at = NULL,
            last_error_code = $2,
            completed_at = $3,
            updated_at = now()
          WHERE id = $1
        `,
        [row.id, errorCode, now],
      );
      await client.query(
        `
          INSERT INTO billing_subscription_renewal_attempts (
            id, subscription_id, customer_id, order_id, renewal_sequence,
            attempt_number, idempotency_key, status, period_start,
            period_end, next_attempt_at, lease_expires_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, 'retry_scheduled', $8, $9, $10,
            NULL
          )
        `,
        [
          randomUUID(),
          row.subscription_id,
          row.customer_id,
          row.order_id,
          row.renewal_sequence,
          nextAttemptNumber,
          deterministicIdempotencyKey(
            row.subscription_id,
            row.renewal_sequence,
            nextAttemptNumber,
          ),
          row.period_start,
          row.period_end,
          retryAt,
        ],
      );
    } else {
      await client.query(
        `
          UPDATE billing_subscription_renewal_attempts
          SET
            status = $2::text,
            next_attempt_at = $3::timestamptz,
            lease_expires_at = NULL,
            last_error_code = $4,
            transport_retry_count = CASE
              WHEN $2::text = 'retry_scheduled'
                THEN transport_retry_count + 1
              ELSE transport_retry_count
            END,
            completed_at = CASE
              WHEN $2::text = 'failed' THEN $5::timestamptz
              ELSE completed_at
            END,
            updated_at = now()
          WHERE id = $1
        `,
        [
          row.id,
          reconciliationRequired
            ? "reconciliation_required"
            : terminalFailure
              ? "failed"
              : "retry_scheduled",
          retryAt,
          errorCode,
          now,
        ],
      );
    }
    await client.query(
      `
        UPDATE billing_subscriptions
        SET
          status = $2,
          auto_renew = CASE WHEN $3::boolean THEN false ELSE auto_renew END,
          cancel_at_period_end = CASE WHEN $3::boolean THEN true ELSE cancel_at_period_end END,
          renewal_due_at = CASE WHEN $3::boolean THEN NULL ELSE renewal_due_at END,
          renewal_failure_count = $4,
          last_renewal_attempt_at = $5::timestamptz,
          renewal_error_code = $6,
          updated_at = now()
        WHERE id = $1
      `,
      [
        row.subscription_id,
        graceExpired ? "past_due" : "grace_period",
        terminalFailure,
        row.attempt_number,
        now,
        errorCode,
      ],
    );

    if (!graceExpired) {
      await createOrRefreshGracePeriod(client, row, graceEnd, now);
    } else {
      await client.query(
        `
          UPDATE billing_access_grace_periods
          SET status = 'expired', revoked_at = $2, updated_at = now()
          WHERE subscription_id = $1 AND status = 'active'
        `,
        [row.subscription_id, now],
      );
    }

    if (terminalFailure) {
      await client.query(
        "UPDATE billing_orders SET status = 'canceled', updated_at = now() WHERE id = $1",
        [row.order_id],
      );
    }

    await client.query(
      `
        INSERT INTO billing_subscription_events (
          id, subscription_id, customer_id, event_type, details, occurred_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        randomUUID(), row.subscription_id, row.customer_id,
        terminalFailure
          ? "subscription.renewal_failed"
          : "subscription.renewal_rescheduled",
        JSON.stringify({
          renewalSequence: row.renewal_sequence,
          attemptNumber: row.attempt_number,
          errorCode,
          nextAttemptAt:
            reconciliationRequired || terminalFailure
              ? null
              : retryAt.toISOString(),
        }),
        now,
      ],
    );
    await client.query("COMMIT");
    return terminalFailure;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function processSubscriptionRenewals(
  client,
  {
    now = () => new Date(),
    fetchImplementation = fetch,
    batchSize = 25,
    completeRenewalImplementation = completeRenewal,
  } = {},
) {
  let processed = 0;
  let succeeded = 0;
  let rescheduled = 0;
  let failed = 0;

  await expireEndedGracePeriods(client, now());

  while (processed < batchSize) {
    const startedAt = now();
    const renewal = await claimRenewal(client, startedAt);

    if (!renewal) break;
    processed += 1;

    await acquireRenewalLock(client, renewal.customer_id);

    let externalPostStarted = false;
    let providerResult = null;

    try {
      if (!(await renewalStillAllowed(client, renewal))) {
        continue;
      }

      let payment;

      if (renewal.provider === "demo") {
        payment = createDemoRenewal(renewal, startedAt);
      } else if (renewal.provider === "yookassa") {
        payment = renewal.external_payment_id
          ? await getYooKassaRenewal(
              renewal,
              renewal.external_payment_id,
              fetchImplementation,
            )
          : await createYooKassaRenewal(renewal, fetchImplementation, {
              onRequestStarted: async () => {
                await markRenewalRequestStarted(client, renewal, now());
                externalPostStarted = true;
              },
            });
      } else {
        throw new Error("RENEWAL_PROVIDER_NOT_SUPPORTED");
      }

      providerResult = payment;
      const completedPayment = await completeRenewalImplementation(
        client,
        renewal,
        payment,
        now(),
      );
      const appliedPayment = completedPayment ?? payment;
      providerResult = appliedPayment;

      if (appliedPayment.status === "succeeded") {
        succeeded += 1;
      } else if (appliedPayment.status === "pending") {
        rescheduled += 1;
      } else if (
        appliedPayment.status === "canceled" ||
        appliedPayment.status === "failed"
      ) {
        const finalFailure = await failRenewal(
          client,
          renewal,
          "RENEWAL_PROVIDER_REJECTED",
          now(),
        );

        if (finalFailure) failed += 1;
        else rescheduled += 1;
      }
    } catch (error) {
      const reportedErrorCode =
        error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "RENEWAL_PROVIDER_TEMPORARY_FAILURE";
      const errorCode =
        providerResult?.status === "canceled" ||
        providerResult?.status === "failed" ||
        reportedErrorCode === "RENEWAL_PROVIDER_REJECTED"
          ? "RENEWAL_PROVIDER_REJECTED"
          : externalPostStarted
            ? "RENEWAL_PROVIDER_OUTCOME_UNKNOWN"
            : reportedErrorCode;
      const finalFailure = await failRenewal(
        client,
        renewal,
        errorCode,
        now(),
      );
      if (finalFailure) {
        failed += 1;
      } else {
        rescheduled += 1;
      }
    } finally {
      await releaseRenewalLock(client, renewal.customer_id);
    }
  }

  return { processed, succeeded, rescheduled, failed };
}
