import { createHash, randomUUID } from "node:crypto";

const maxAttempts = 4;
const gracePeriodMilliseconds = 7 * 24 * 60 * 60 * 1000;
const retryDelaysMilliseconds = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  gracePeriodMilliseconds,
];

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

export async function createYooKassaRenewal(row, fetchImplementation) {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    throw new Error("RENEWAL_PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetchImplementation(
    "https://api.yookassa.ru/v3/payments",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotence-Key": row.idempotency_key,
      },
      body: JSON.stringify({
        amount: formatMoney(row.amount_minor, row.currency),
        capture: true,
        payment_method_id: row.provider_payment_method_token,
        description: `Продление: ${row.plan_id === "annual" ? "Годовой" : "Месячный"} тариф — Академия Абрикософф`,
        receipt: receiptFor(row),
        metadata: {
          internal_order_id: row.order_id,
          customer_id: row.customer_id,
          plan_id: row.plan_id,
          legal_entity_id: row.legal_entity_id,
          operation: "subscription_renewal",
        },
      }),
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
                AND open_attempts.status IN ('processing', 'retry_scheduled')
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
          subscriptions.status AS subscription_status
        FROM billing_subscription_renewal_attempts attempts
        JOIN billing_subscriptions subscriptions
          ON subscriptions.id = attempts.subscription_id
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

async function completeRenewal(client, row, payment, now) {
  await client.query("BEGIN");

  try {
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
          status = EXCLUDED.status,
          payment_method_token = EXCLUDED.payment_method_token,
          payment_method_saved = true,
          paid_at = COALESCE(billing_payments.paid_at, EXCLUDED.paid_at),
          updated_at = now()
        WHERE billing_payments.external_payment_id = EXCLUDED.external_payment_id
        RETURNING id
      `,
      [
        randomUUID(), row.order_id, row.provider, row.merchant_account_id,
        payment.externalPaymentId, row.idempotency_key, payment.status,
        row.amount_minor, row.currency, payment.paymentMethodToken,
        payment.paidAt,
      ],
    );

    if (!savedPayment.rowCount) {
      throw new Error("RENEWAL_PROVIDER_OPERATION_MISMATCH");
    }
    await client.query(
      "UPDATE billing_orders SET status = $2, updated_at = now() WHERE id = $1",
      [row.order_id, payment.status === "succeeded" ? "paid" : "pending"],
    );

    if (payment.status === "succeeded") {
      await client.query(
        `
          INSERT INTO billing_access_grants (
            order_id, customer_id, plan_id, status, period_start,
            period_end, granted_at
          )
          VALUES ($1, $2, $3, 'granted', $4, $5, $6)
          ON CONFLICT (order_id) DO NOTHING
        `,
        [row.order_id, row.customer_id, row.plan_id, row.period_start, row.period_end, now],
      );
      await client.query(
        `
          UPDATE billing_subscriptions
          SET
            status = 'active',
            current_period_start = $2,
            current_period_end = $3,
            renewal_due_at = $3,
            renewal_failure_count = 0,
            last_renewal_attempt_at = $4,
            renewal_error_code = NULL,
            activated_by_order_id = $5,
            updated_at = now()
          WHERE id = $1
        `,
        [row.subscription_id, row.period_start, row.period_end, now, row.order_id],
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
          JSON.stringify({ orderId: row.order_id, renewalSequence: row.renewal_sequence }),
          now,
        ],
      );
    } else if (payment.status === "pending") {
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
      await client.query(
        `
          INSERT INTO billing_access_grace_periods (
            subscription_id, customer_id, status, period_start, period_end
          )
          VALUES (
            $1, $2, 'active', $3,
            $3::timestamptz + interval '7 days'
          )
          ON CONFLICT (subscription_id)
          DO UPDATE SET
            status = 'active',
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            revoked_at = NULL,
            updated_at = now()
        `,
        [row.subscription_id, row.customer_id, row.period_start],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function failRenewal(client, row, errorCode, now) {
  await client.query("BEGIN");

  try {
    const startsNewFinancialAttempt =
      errorCode === "RENEWAL_PROVIDER_REJECTED";
    const finalFailure =
      (startsNewFinancialAttempt && row.attempt_number >= maxAttempts) ||
      now.getTime() >= new Date(row.period_start).getTime() + gracePeriodMilliseconds;
    const graceEnd = new Date(
      new Date(row.period_start).getTime() + gracePeriodMilliseconds,
    );
    const nextAttemptNumber = startsNewFinancialAttempt
      ? row.attempt_number + 1
      : row.attempt_number;
    const nextTransportRetryCount = startsNewFinancialAttempt
      ? 0
      : row.transport_retry_count + 1;
    const nextIdempotencyKey = startsNewFinancialAttempt
      ? deterministicIdempotencyKey(
          row.subscription_id,
          row.renewal_sequence,
          nextAttemptNumber,
        )
      : row.idempotency_key;
    const retryOrdinal = startsNewFinancialAttempt
      ? row.attempt_number - 1
      : row.transport_retry_count;
    const retryAt = finalFailure
      ? now
      : new Date(
          Math.min(
            now.getTime() +
              retryDelaysMilliseconds[
                Math.min(retryOrdinal, retryDelaysMilliseconds.length - 1)
              ],
            graceEnd.getTime(),
          ),
        );

    await client.query(
      `
        UPDATE billing_subscription_renewal_attempts
        SET
          status = $2::text,
          next_attempt_at = $3::timestamptz,
          lease_expires_at = NULL,
          last_error_code = $4,
          attempt_number = $6::integer,
          transport_retry_count = $7::integer,
          idempotency_key = $8,
          completed_at = CASE
            WHEN $2::text = 'failed' THEN $5::timestamptz
            ELSE NULL
          END,
          updated_at = now()
        WHERE id = $1
      `,
      [
        row.id,
        finalFailure ? "failed" : "retry_scheduled",
        retryAt,
        errorCode,
        now,
        finalFailure ? row.attempt_number : nextAttemptNumber,
        finalFailure ? row.transport_retry_count : nextTransportRetryCount,
        finalFailure ? row.idempotency_key : nextIdempotencyKey,
      ],
    );
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
        finalFailure ? "past_due" : "grace_period",
        finalFailure,
        row.attempt_number,
        now,
        errorCode,
      ],
    );

    if (!finalFailure) {
      await client.query(
        `
          INSERT INTO billing_access_grace_periods (
            subscription_id, customer_id, status, period_start, period_end
          )
          VALUES ($1, $2, 'active', $3, $4)
          ON CONFLICT (subscription_id)
          DO UPDATE SET
            status = 'active',
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            revoked_at = NULL,
            updated_at = now()
        `,
        [row.subscription_id, row.customer_id, row.period_start, graceEnd],
      );
    } else {
      await client.query(
        "UPDATE billing_orders SET status = 'canceled', updated_at = now() WHERE id = $1",
        [row.order_id],
      );
      await client.query(
        `
          UPDATE billing_access_grace_periods
          SET status = 'expired', revoked_at = $2, updated_at = now()
          WHERE subscription_id = $1 AND status = 'active'
        `,
        [row.subscription_id, now],
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
        finalFailure
          ? "subscription.renewal_failed"
          : "subscription.renewal_rescheduled",
        JSON.stringify({
          renewalSequence: row.renewal_sequence,
          attemptNumber: row.attempt_number,
          errorCode,
          nextAttemptAt: finalFailure ? null : retryAt.toISOString(),
        }),
        now,
      ],
    );
    await client.query("COMMIT");
    return finalFailure;
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
  } = {},
) {
  let processed = 0;
  let succeeded = 0;
  let rescheduled = 0;
  let failed = 0;

  while (processed < batchSize) {
    const startedAt = now();
    const renewal = await claimRenewal(client, startedAt);

    if (!renewal) break;
    processed += 1;

    await acquireRenewalLock(client, renewal.customer_id);

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
          : await createYooKassaRenewal(renewal, fetchImplementation);
      } else {
        throw new Error("RENEWAL_PROVIDER_NOT_SUPPORTED");
      }

      await completeRenewal(client, renewal, payment, now());

      if (payment.status === "succeeded") {
        succeeded += 1;
      } else if (payment.status === "pending") {
        rescheduled += 1;
      } else {
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
      const errorCode =
        error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "RENEWAL_PROVIDER_TEMPORARY_FAILURE";
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
