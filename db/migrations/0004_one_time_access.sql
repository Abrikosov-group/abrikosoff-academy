ALTER TABLE billing_orders
  RENAME COLUMN recurring_consent_accepted_at TO offer_accepted_at;

ALTER TABLE billing_orders
  RENAME COLUMN recurring_consent_offer_version TO offer_version;

ALTER TABLE billing_subscriptions
  ALTER COLUMN auto_renew SET DEFAULT false;

UPDATE billing_subscriptions
SET
  auto_renew = false,
  mandate_id = NULL,
  cancel_at_period_end = false,
  updated_at = now()
WHERE auto_renew OR mandate_id IS NOT NULL OR cancel_at_period_end;

UPDATE billing_payment_mandates
SET
  status = 'revoked',
  revoked_at = COALESCE(revoked_at, now()),
  updated_at = now()
WHERE status IN ('pending', 'active');

COMMENT ON COLUMN billing_subscriptions.auto_renew IS
  'В MVP доступ оплачивается разово; автоматическое продление отключено.';
