ALTER TABLE billing_orders
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'one_time'
    CHECK (billing_mode IN ('recurring', 'one_time')),
  ADD COLUMN subscription_id uuid REFERENCES billing_subscriptions(id),
  ADD COLUMN renewal_sequence integer NOT NULL DEFAULT 0
    CHECK (renewal_sequence >= 0),
  ADD COLUMN recurring_consent_accepted_at timestamptz,
  ADD COLUMN recurring_consent_offer_version text;

ALTER TABLE billing_orders
  ADD CONSTRAINT billing_orders_recurring_consent_check CHECK (
    (
      billing_mode = 'recurring'
      AND recurring_consent_accepted_at IS NOT NULL
      AND recurring_consent_offer_version IS NOT NULL
      AND btrim(recurring_consent_offer_version) <> ''
    )
    OR (
      billing_mode = 'one_time'
      AND recurring_consent_accepted_at IS NULL
      AND recurring_consent_offer_version IS NULL
    )
  );

CREATE UNIQUE INDEX billing_orders_subscription_renewal_idx
  ON billing_orders (subscription_id, renewal_sequence)
  WHERE subscription_id IS NOT NULL AND renewal_sequence > 0;

ALTER TABLE billing_payments
  ADD COLUMN payment_method_saved boolean NOT NULL DEFAULT false;

ALTER TABLE billing_payments
  ADD CONSTRAINT billing_payments_saved_method_check CHECK (
    NOT payment_method_saved OR payment_method_token IS NOT NULL
  );

ALTER TABLE billing_payment_mandates
  ADD COLUMN payment_method_type text,
  ADD COLUMN last_used_at timestamptz;

ALTER TABLE billing_payment_mandates
  ADD CONSTRAINT billing_payment_mandates_active_token_check CHECK (
    status <> 'active'
    OR (
      provider_payment_method_token IS NOT NULL
      AND activated_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX billing_payment_mandates_one_active_customer_idx
  ON billing_payment_mandates (customer_id, provider, merchant_account_id)
  WHERE status = 'active';

ALTER TABLE billing_subscriptions
  ADD COLUMN renewal_due_at timestamptz,
  ADD COLUMN renewal_failure_count integer NOT NULL DEFAULT 0
    CHECK (renewal_failure_count >= 0),
  ADD COLUMN last_renewal_attempt_at timestamptz,
  ADD COLUMN renewal_error_code text;

ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_renewal_state_check CHECK (
    NOT auto_renew
    OR (
      mandate_id IS NOT NULL
      AND renewal_due_at IS NOT NULL
      AND cancel_at_period_end = false
    )
  );

CREATE INDEX billing_subscriptions_due_renewal_idx
  ON billing_subscriptions (renewal_due_at, id)
  WHERE auto_renew AND NOT cancel_at_period_end;

CREATE TABLE billing_subscription_events (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id),
  customer_id uuid NOT NULL REFERENCES identity_users(id),
  event_type text NOT NULL CHECK (
    event_type IN (
      'subscription.started',
      'subscription.renewed',
      'subscription.renewal_failed',
      'subscription.renewal_rescheduled',
      'subscription.renewal_disabled',
      'subscription.renewal_enabled',
      'subscription.expired'
    )
  ),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_subscription_events_history_idx
  ON billing_subscription_events (subscription_id, recorded_at, id);

CREATE TABLE billing_access_grace_periods (
  subscription_id uuid PRIMARY KEY REFERENCES billing_subscriptions(id),
  customer_id uuid NOT NULL REFERENCES identity_users(id),
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (period_end > period_start),
  CHECK (period_end <= period_start + interval '7 days'),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status IN ('revoked', 'expired') AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX billing_access_grace_periods_customer_period_idx
  ON billing_access_grace_periods (customer_id, status, period_end DESC);

CREATE TABLE billing_subscription_renewal_attempts (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id),
  customer_id uuid NOT NULL REFERENCES identity_users(id),
  order_id uuid REFERENCES billing_orders(id),
  renewal_sequence integer NOT NULL CHECK (renewal_sequence > 0),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (
    status IN ('processing', 'retry_scheduled', 'succeeded', 'failed', 'canceled')
  ),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (period_end > period_start),
  UNIQUE (subscription_id, renewal_sequence, attempt_number)
);

CREATE INDEX billing_subscription_renewal_attempts_ready_idx
  ON billing_subscription_renewal_attempts (next_attempt_at, id)
  WHERE status IN ('processing', 'retry_scheduled');

COMMENT ON TABLE billing_subscription_renewal_attempts IS
  'Идемпотентные попытки автоматического продления с постоянным ключом операции.';

COMMENT ON COLUMN billing_orders.billing_mode IS
  'recurring для сохраняемого способа оплаты; one_time для криптовалюты и других разовых способов.';

COMMENT ON COLUMN billing_payment_mandates.provider_payment_method_token IS
  'Непрозрачный идентификатор сохранённого способа оплаты у провайдера; реквизиты карты в Академии не хранятся.';
