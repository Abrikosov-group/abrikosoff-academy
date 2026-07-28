-- Грант связывает оплаченный срок с конкретным заказом.
CREATE TABLE billing_access_grants (
  order_id uuid PRIMARY KEY REFERENCES billing_orders(id),
  customer_id uuid NOT NULL REFERENCES identity_users(id),
  plan_id text NOT NULL CHECK (plan_id IN ('monthly', 'annual')),
  status text NOT NULL CHECK (status IN ('granted', 'revoked')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (
    (status = 'granted' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX billing_access_grants_customer_period_idx
  ON billing_access_grants (customer_id, status, period_end DESC);

INSERT INTO billing_access_grants (
  order_id,
  customer_id,
  plan_id,
  status,
  period_start,
  period_end,
  granted_at,
  revoked_at,
  created_at,
  updated_at
)
SELECT
  subscriptions.activated_by_order_id,
  subscriptions.customer_id,
  subscriptions.plan_id,
  CASE WHEN orders.status = 'refunded' THEN 'revoked' ELSE 'granted' END,
  subscriptions.current_period_start,
  subscriptions.current_period_end,
  subscriptions.current_period_start,
  CASE WHEN orders.status = 'refunded'
    THEN COALESCE(
      subscriptions.canceled_at,
      subscriptions.current_period_end
    )
    ELSE NULL
  END,
  subscriptions.created_at,
  subscriptions.updated_at
FROM billing_subscriptions subscriptions
JOIN billing_orders orders
  ON orders.id = subscriptions.activated_by_order_id
WHERE subscriptions.activated_by_order_id IS NOT NULL
  AND subscriptions.current_period_start IS NOT NULL
  AND subscriptions.current_period_end IS NOT NULL
  AND subscriptions.current_period_end >
    subscriptions.current_period_start
ON CONFLICT (order_id) DO NOTHING;

COMMENT ON TABLE billing_access_grants IS
  'Аудируемое происхождение оплаченного срока: один заказ создаёт один грант доступа, а полный возврат отзывает только его.';
