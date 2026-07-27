ALTER TABLE billing_payment_mandates
  ALTER COLUMN provider_payment_method_token DROP NOT NULL;

UPDATE billing_payments
SET
  payment_method_token = NULL,
  updated_at = now()
WHERE payment_method_token IS NOT NULL;

UPDATE billing_payment_mandates
SET
  provider_payment_method_token = NULL,
  updated_at = now()
WHERE provider_payment_method_token IS NOT NULL;

COMMENT ON COLUMN billing_payment_mandates.provider_payment_method_token IS
  'В MVP токены очищены; таблица сохраняет только историю ранее данного согласия.';
