CREATE TABLE billing_merchant_accounts (
  id text PRIMARY KEY,
  provider text NOT NULL,
  legal_entity_id text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, id)
);

COMMENT ON TABLE billing_merchant_accounts IS
  'Публичная конфигурация магазинов. API-ключи хранятся только в секретах окружения.';

CREATE TABLE billing_payment_routes (
  id uuid PRIMARY KEY,
  legal_entity_id text NOT NULL,
  country_code char(2),
  currency char(3) NOT NULL,
  provider text NOT NULL,
  merchant_account_id text NOT NULL
    REFERENCES billing_merchant_accounts(id),
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    legal_entity_id,
    country_code,
    currency,
    provider,
    merchant_account_id
  )
);

CREATE INDEX billing_payment_routes_lookup_idx
  ON billing_payment_routes (
    legal_entity_id,
    country_code,
    currency,
    status,
    priority
  );

CREATE TABLE billing_orders (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  plan_id text NOT NULL,
  legal_entity_id text NOT NULL,
  country_code char(2) NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL
    CHECK (
      status IN (
        'pending',
        'paid',
        'canceled',
        'partially_refunded',
        'refunded'
      )
    ),
  idempotency_key text NOT NULL UNIQUE,
  selected_provider text NOT NULL,
  merchant_account_id text NOT NULL,
  recurring_consent_accepted_at timestamptz NOT NULL,
  recurring_consent_offer_version text NOT NULL,
  receipt_email text,
  receipt_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_orders_customer_created_idx
  ON billing_orders (customer_id, created_at DESC);

CREATE TABLE billing_payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  provider text NOT NULL,
  merchant_account_id text NOT NULL,
  external_payment_id text NOT NULL,
  provider_operation_key text NOT NULL,
  status text NOT NULL
    CHECK (
      status IN (
        'created',
        'pending',
        'requires_action',
        'succeeded',
        'canceled',
        'failed',
        'partially_refunded',
        'refunded'
      )
    ),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  confirmation_url text,
  payment_method_token text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    provider,
    merchant_account_id,
    external_payment_id
  ),
  UNIQUE (
    provider,
    merchant_account_id,
    provider_operation_key
  )
);

CREATE INDEX billing_payments_order_created_idx
  ON billing_payments (order_id, created_at DESC);

CREATE TABLE billing_payment_mandates (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  provider text NOT NULL,
  merchant_account_id text NOT NULL,
  provider_payment_method_token text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  consent_accepted_at timestamptz NOT NULL,
  consent_offer_version text NOT NULL,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    provider,
    merchant_account_id,
    provider_payment_method_token
  )
);

CREATE INDEX billing_payment_mandates_customer_status_idx
  ON billing_payment_mandates (customer_id, status, created_at DESC);

CREATE TABLE billing_subscriptions (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  plan_id text NOT NULL,
  status text NOT NULL
    CHECK (
      status IN (
        'pending',
        'active',
        'past_due',
        'grace_period',
        'canceled',
        'expired'
      )
    ),
  current_period_start timestamptz,
  current_period_end timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  mandate_id uuid REFERENCES billing_payment_mandates(id),
  activated_by_order_id uuid REFERENCES billing_orders(id),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX billing_subscriptions_one_current_idx
  ON billing_subscriptions (customer_id)
  WHERE status IN ('pending', 'active', 'past_due', 'grace_period');

CREATE TABLE billing_refunds (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES billing_payments(id),
  provider text NOT NULL,
  merchant_account_id text NOT NULL,
  external_refund_id text,
  provider_operation_key text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('pending', 'succeeded', 'canceled')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    provider,
    merchant_account_id,
    external_refund_id
  ),
  UNIQUE (
    provider,
    merchant_account_id,
    provider_operation_key
  )
);

CREATE TABLE billing_webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  merchant_account_id text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  external_payment_id text,
  payload_sha256 char(64) NOT NULL,
  payload jsonb NOT NULL,
  processing_status text NOT NULL
    CHECK (
      processing_status IN (
        'received',
        'verified',
        'applied',
        'ignored',
        'failed'
      )
    ),
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (
    provider,
    merchant_account_id,
    external_event_id
  )
);

CREATE INDEX billing_webhook_events_payment_idx
  ON billing_webhook_events (
    provider,
    merchant_account_id,
    external_payment_id,
    received_at DESC
  );

CREATE TABLE billing_payment_events (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES billing_payments(id),
  webhook_event_id uuid REFERENCES billing_webhook_events(id),
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_payment_events_history_idx
  ON billing_payment_events (payment_id, recorded_at, id);

COMMENT ON TABLE billing_payment_events IS
  'Неизменяемая история переходов платежа. Строки добавляются, но не обновляются.';
