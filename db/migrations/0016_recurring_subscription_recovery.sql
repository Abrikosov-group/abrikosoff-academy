ALTER TABLE billing_subscription_renewal_attempts
  ADD COLUMN transport_retry_count integer NOT NULL DEFAULT 0
    CHECK (transport_retry_count >= 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM billing_subscription_renewal_attempts
    WHERE status IN ('processing', 'retry_scheduled')
    GROUP BY subscription_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'multiple open subscription renewal attempts require reconciliation'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

ALTER TABLE billing_subscription_renewal_attempts
  DROP CONSTRAINT billing_subscription_renewal_attempts_status_check;

ALTER TABLE billing_subscription_renewal_attempts
  ADD CONSTRAINT billing_subscription_renewal_attempts_status_check CHECK (
    status IN (
      'processing',
      'retry_scheduled',
      'reconciliation_required',
      'succeeded',
      'failed',
      'canceled'
    )
  );

CREATE UNIQUE INDEX billing_subscription_renewal_attempts_one_open_idx
  ON billing_subscription_renewal_attempts (subscription_id)
  WHERE status IN (
    'processing',
    'retry_scheduled',
    'reconciliation_required'
  );

ALTER TABLE billing_access_grace_periods
  ADD COLUMN id uuid DEFAULT gen_random_uuid();

ALTER TABLE billing_access_grace_periods
  DROP CONSTRAINT billing_access_grace_periods_pkey;

ALTER TABLE billing_access_grace_periods
  ALTER COLUMN id SET NOT NULL,
  ADD CONSTRAINT billing_access_grace_periods_pkey PRIMARY KEY (id),
  ADD CONSTRAINT billing_access_grace_periods_period_key UNIQUE (
    subscription_id,
    period_start,
    period_end
  );

CREATE UNIQUE INDEX billing_access_grace_periods_one_active_idx
  ON billing_access_grace_periods (subscription_id)
  WHERE status = 'active';

COMMENT ON TABLE billing_subscription_renewal_attempts IS
  'Операции автоматического продления: одна незавершённая операция на подписку, отдельный ключ каждой финансовой попытки.';

COMMENT ON COLUMN billing_subscription_renewal_attempts.transport_retry_count IS
  'Число технических повторов одной финансовой операции с неизменным ключом идемпотентности.';
