CREATE TABLE access_manual_grants (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES identity_users(id),
  status text NOT NULL
    CHECK (status IN ('granted', 'revoked')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  grant_reason text NOT NULL,
  granted_by_user_id uuid NOT NULL REFERENCES identity_users(id),
  granted_at timestamptz NOT NULL,
  revoked_by_user_id uuid REFERENCES identity_users(id),
  revoke_reason text,
  revoked_at timestamptz,
  command_execution_id uuid NOT NULL UNIQUE
    REFERENCES admin_command_executions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (
    grant_reason = btrim(grant_reason)
    AND char_length(grant_reason) BETWEEN 10 AND 500
    AND grant_reason !~ '[[:cntrl:]]'
  ),
  CHECK (
    (
      status = 'granted'
      AND revoked_by_user_id IS NULL
      AND revoke_reason IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'revoked'
      AND revoked_by_user_id IS NOT NULL
      AND revoke_reason IS NOT NULL
      AND revoked_at IS NOT NULL
    )
  ),
  CHECK (
    revoke_reason IS NULL
    OR (
      revoke_reason = btrim(revoke_reason)
      AND char_length(revoke_reason) BETWEEN 10 AND 500
      AND revoke_reason !~ '[[:cntrl:]]'
    )
  ),
  CHECK (
    revoked_at IS NULL
    OR revoked_at >= granted_at
  ),
  CHECK (
    updated_at >= created_at
    AND (
      revoked_at IS NULL
      OR updated_at >= revoked_at
    )
  )
);

CREATE INDEX access_manual_grants_customer_period_idx
  ON access_manual_grants (
    customer_id,
    status,
    period_end DESC
  );

CREATE INDEX access_manual_grants_period_end_idx
  ON access_manual_grants (period_end);

CREATE FUNCTION protect_access_manual_grant_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'granted' THEN
      RAISE EXCEPTION
        'manual access grants must be created as granted'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.period_start IS DISTINCT FROM OLD.period_start
      OR NEW.period_end IS DISTINCT FROM OLD.period_end
      OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
      OR NEW.granted_by_user_id
        IS DISTINCT FROM OLD.granted_by_user_id
      OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
      OR NEW.command_execution_id
        IS DISTINCT FROM OLD.command_execution_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION
        'manual access grant origin is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION
        'manual access grant updated_at cannot move backwards'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'granted' AND NEW.status = 'revoked' THEN
      RETURN NEW;
    END IF;

    IF OLD.status = 'granted' AND NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'revoked manual access grants are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION
    'manual access grants cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER access_manual_grants_protect_history
BEFORE INSERT OR UPDATE OR DELETE ON access_manual_grants
FOR EACH ROW
EXECUTE FUNCTION protect_access_manual_grant_history();

CREATE TRIGGER access_manual_grants_no_truncate
BEFORE TRUNCATE ON access_manual_grants
FOR EACH STATEMENT
EXECUTE FUNCTION protect_access_manual_grant_history();

COMMENT ON TABLE access_manual_grants IS
  'Отдельные ручные основания доступа: не создают платёж и не изменяют оплаченные гранты.';
