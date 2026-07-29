ALTER TABLE identity_sessions
  ADD COLUMN authenticated_at timestamptz,
  ADD COLUMN authentication_method text,
  ADD COLUMN authentication_method_id uuid
    REFERENCES identity_methods(id),
  ADD COLUMN admin_verified_at timestamptz,
  ADD COLUMN admin_verification_method text,
  ADD COLUMN admin_break_glass_expires_at timestamptz,
  ADD COLUMN user_agent_family text;

ALTER TABLE identity_sessions
  ADD CONSTRAINT identity_sessions_authentication_method_check
    CHECK (
      authentication_method IS NULL
      OR authentication_method IN (
        'telegram_oidc',
        'email_magic_link',
        'demo'
      )
    ),
  ADD CONSTRAINT identity_sessions_authentication_metadata_check
    CHECK (
      (
        authenticated_at IS NULL
        AND authentication_method IS NULL
        AND authentication_method_id IS NULL
      )
      OR (
        authenticated_at IS NOT NULL
        AND authentication_method IS NOT NULL
        AND authentication_method_id IS NOT NULL
        AND authenticated_at <= expires_at
      )
    ),
  ADD CONSTRAINT identity_sessions_admin_verification_method_check
    CHECK (
      admin_verification_method IS NULL
      OR admin_verification_method IN (
        'telegram_oidc',
        'email_magic_link',
        'break_glass'
      )
    ),
  ADD CONSTRAINT identity_sessions_admin_verification_metadata_check
    CHECK (
      (
        admin_verified_at IS NULL
        AND admin_verification_method IS NULL
        AND admin_break_glass_expires_at IS NULL
      )
      OR (
        authenticated_at IS NOT NULL
        AND admin_verified_at IS NOT NULL
        AND admin_verification_method IS NOT NULL
        AND admin_verified_at >= authenticated_at
        AND admin_verified_at <= expires_at
        AND (
          (
            admin_verification_method IN (
              'telegram_oidc',
              'email_magic_link'
            )
            AND admin_break_glass_expires_at IS NULL
          )
          OR (
            admin_verification_method = 'break_glass'
            AND admin_break_glass_expires_at IS NOT NULL
            AND admin_break_glass_expires_at > admin_verified_at
            AND admin_break_glass_expires_at
              <= admin_verified_at + interval '30 minutes'
            AND admin_break_glass_expires_at <= expires_at
          )
        )
      )
    ),
  ADD CONSTRAINT identity_sessions_user_agent_family_check
    CHECK (
      user_agent_family IS NULL
      OR (
        char_length(user_agent_family) BETWEEN 1 AND 80
        AND user_agent_family !~ '[[:cntrl:]]'
      )
    );

CREATE INDEX identity_sessions_authentication_method_idx
  ON identity_sessions (authentication_method_id, authenticated_at DESC)
  WHERE authentication_method_id IS NOT NULL;

CREATE TABLE admin_invariant_locks (
  name text PRIMARY KEY
);

INSERT INTO admin_invariant_locks (name)
VALUES ('active_owner');

CREATE FUNCTION prevent_admin_invariant_lock_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_invariant_locks is fixed'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_invariant_locks_fixed
BEFORE UPDATE OR DELETE ON admin_invariant_locks
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_invariant_lock_mutation();

CREATE TRIGGER admin_invariant_locks_no_truncate
BEFORE TRUNCATE ON admin_invariant_locks
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_admin_invariant_lock_mutation();

CREATE TABLE admin_role_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity_users(id),
  role text NOT NULL
    CHECK (
      role IN ('owner', 'support', 'content_editor', 'finance')
    ),
  status text NOT NULL
    CHECK (status IN ('active', 'revoked')),
  granted_by_user_id uuid REFERENCES identity_users(id),
  granted_by_kind text NOT NULL
    CHECK (granted_by_kind IN ('user', 'system')),
  grant_reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid REFERENCES identity_users(id),
  revoke_reason text,
  revoked_at timestamptz,
  CHECK (
    (
      granted_by_kind = 'system'
      AND granted_by_user_id IS NULL
    )
    OR (
      granted_by_kind = 'user'
      AND granted_by_user_id IS NOT NULL
    )
  ),
  CHECK (
    grant_reason = btrim(grant_reason)
    AND char_length(grant_reason) BETWEEN 10 AND 500
    AND grant_reason !~ '[[:cntrl:]]'
  ),
  CHECK (
    (
      status = 'active'
      AND revoked_by_user_id IS NULL
      AND revoke_reason IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'revoked'
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
  )
);

CREATE UNIQUE INDEX admin_role_assignments_active_role_idx
  ON admin_role_assignments (user_id, role)
  WHERE status = 'active';

CREATE INDEX admin_role_assignments_user_history_idx
  ON admin_role_assignments (user_id, granted_at DESC, id DESC);

CREATE TABLE admin_command_executions (
  id uuid PRIMARY KEY,
  principal_key text NOT NULL,
  actor_user_id uuid REFERENCES identity_users(id),
  action text NOT NULL,
  idempotency_key text NOT NULL,
  request_sha256 char(64) NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  execution_kind text NOT NULL
    CHECK (
      execution_kind IN (
        'internal',
        'external_read',
        'external_write'
      )
    ),
  status text NOT NULL
    CHECK (
      status IN (
        'in_progress',
        'waiting_external',
        'succeeded',
        'rejected',
        'failed'
      )
    ),
  result_status integer,
  result jsonb,
  error_code text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 1,
  provider_operation_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (principal_key, action, idempotency_key),
  CHECK (
    char_length(principal_key) BETWEEN 3 AND 160
    AND principal_key !~ '[[:cntrl:]]'
  ),
  CHECK (
    char_length(action) BETWEEN 3 AND 120
    AND action !~ '[[:cntrl:]]'
  ),
  CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 64
    AND idempotency_key ~ '^[A-Za-z0-9_-]+$'
  ),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (attempt_count >= 1),
  CHECK (updated_at >= created_at),
  CHECK (
    completed_at IS NULL
    OR completed_at >= updated_at
  ),
  CHECK (
    (
      status IN ('in_progress', 'waiting_external')
      AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL
      AND result_status IS NULL
    )
    OR (
      status IN ('succeeded', 'rejected', 'failed')
      AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL
      AND result_status IS NOT NULL
      AND result_status BETWEEN 100 AND 599
    )
  ),
  CHECK (
    status <> 'waiting_external'
    OR execution_kind IN ('external_read', 'external_write')
  ),
  CHECK (
    (
      execution_kind = 'external_write'
      AND provider_operation_key IS NOT NULL
    )
    OR (
      execution_kind IN ('internal', 'external_read')
      AND provider_operation_key IS NULL
    )
  ),
  CHECK (
    (
      status IN ('in_progress', 'waiting_external', 'succeeded')
      AND error_code IS NULL
    )
    OR (
      status IN ('rejected', 'failed')
      AND error_code IS NOT NULL
    )
  )
);

CREATE INDEX admin_command_executions_recovery_idx
  ON admin_command_executions (status, lease_expires_at)
  WHERE status IN ('in_progress', 'waiting_external');

CREATE INDEX admin_command_executions_actor_idx
  ON admin_command_executions (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE FUNCTION protect_admin_command_execution_journal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('in_progress', 'waiting_external') THEN
      RAISE EXCEPTION
        'terminal admin command executions are immutable'
        USING ERRCODE = '55000';
    END IF;

    IF
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.principal_key IS DISTINCT FROM OLD.principal_key
      OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
      OR NEW.action IS DISTINCT FROM OLD.action
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256
      OR NEW.target_type IS DISTINCT FROM OLD.target_type
      OR NEW.target_id IS DISTINCT FROM OLD.target_id
      OR NEW.execution_kind IS DISTINCT FROM OLD.execution_kind
      OR NEW.provider_operation_key
        IS DISTINCT FROM OLD.provider_operation_key
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION
        'admin command execution identity is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF
      NEW.attempt_count < OLD.attempt_count
      OR NEW.attempt_count > OLD.attempt_count + 1
    THEN
      RAISE EXCEPTION
        'admin command fencing attempt must advance monotonically by one'
        USING ERRCODE = '55000';
    END IF;

    IF
      NEW.attempt_count = OLD.attempt_count + 1
      AND NEW.status NOT IN ('in_progress', 'waiting_external')
    THEN
      RAISE EXCEPTION
        'admin command fencing attempt can advance only while active'
        USING ERRCODE = '55000';
    END IF;

    IF
      NEW.attempt_count = OLD.attempt_count + 1
      AND OLD.lease_expires_at > statement_timestamp()
    THEN
      RAISE EXCEPTION
        'admin command fencing attempt cannot capture a live lease'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION
        'admin command updated_at cannot move backwards'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'admin command executions cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_command_executions_protect_journal
BEFORE UPDATE OR DELETE ON admin_command_executions
FOR EACH ROW
EXECUTE FUNCTION protect_admin_command_execution_journal();

CREATE TRIGGER admin_command_executions_no_truncate
BEFORE TRUNCATE ON admin_command_executions
FOR EACH STATEMENT
EXECUTE FUNCTION protect_admin_command_execution_journal();

CREATE TABLE admin_audit_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  command_execution_id uuid
    REFERENCES admin_command_executions(id),
  actor_kind text NOT NULL
    CHECK (actor_kind IN ('user', 'system')),
  actor_user_id uuid REFERENCES identity_users(id),
  actor_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL
    CHECK (outcome IN ('succeeded', 'rejected', 'failed')),
  error_code text,
  ip_hmac char(64),
  ip_hmac_key_version smallint,
  user_agent_family text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      actor_kind = 'system'
      AND actor_user_id IS NULL
    )
    OR (
      actor_kind = 'user'
      AND actor_user_id IS NOT NULL
    )
  ),
  CHECK (
    reason IS NULL
    OR (
      reason = btrim(reason)
      AND char_length(reason) BETWEEN 10 AND 500
      AND reason !~ '[[:cntrl:]]'
    )
  ),
  CHECK (
    (
      outcome = 'succeeded'
      AND error_code IS NULL
    )
    OR (
      outcome IN ('rejected', 'failed')
      AND error_code IS NOT NULL
    )
  ),
  CHECK (
    (ip_hmac IS NULL AND ip_hmac_key_version IS NULL)
    OR (
      ip_hmac IS NOT NULL
      AND ip_hmac_key_version IS NOT NULL
      AND ip_hmac ~ '^[0-9a-f]{64}$'
      AND ip_hmac_key_version > 0
    )
  ),
  CHECK (
    user_agent_family IS NULL
    OR (
      char_length(user_agent_family) BETWEEN 1 AND 80
      AND user_agent_family !~ '[[:cntrl:]]'
    )
  )
);

CREATE INDEX admin_audit_events_created_idx
  ON admin_audit_events (created_at DESC, id DESC);

CREATE INDEX admin_audit_events_actor_idx
  ON admin_audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX admin_audit_events_target_idx
  ON admin_audit_events (
    target_type,
    target_id,
    created_at DESC
  );

CREATE INDEX admin_audit_events_action_idx
  ON admin_audit_events (action, created_at DESC);

CREATE INDEX admin_audit_events_command_idx
  ON admin_audit_events (command_execution_id, created_at)
  WHERE command_execution_id IS NOT NULL;

CREATE FUNCTION prevent_admin_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_events is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_audit_events_append_only
BEFORE UPDATE OR DELETE ON admin_audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_audit_mutation();

CREATE TRIGGER admin_audit_events_no_truncate
BEFORE TRUNCATE ON admin_audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_admin_audit_mutation();

CREATE FUNCTION protect_admin_role_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.granted_by_user_id
        IS DISTINCT FROM OLD.granted_by_user_id
      OR NEW.granted_by_kind IS DISTINCT FROM OLD.granted_by_kind
      OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
      OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
    THEN
      RAISE EXCEPTION
        'admin role assignment grant is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'revoked' THEN
      RETURN NEW;
    END IF;

    IF OLD.status = 'active' AND NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'revoked admin role assignments are immutable'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'admin_role_assignments cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_role_assignments_protect_history
BEFORE UPDATE OR DELETE ON admin_role_assignments
FOR EACH ROW
EXECUTE FUNCTION protect_admin_role_assignment_history();

CREATE TRIGGER admin_role_assignments_no_truncate
BEFORE TRUNCATE ON admin_role_assignments
FOR EACH STATEMENT
EXECUTE FUNCTION protect_admin_role_assignment_history();

COMMENT ON TABLE admin_role_assignments IS
  'История назначений фиксированных административных ролей.';

COMMENT ON TABLE admin_audit_events IS
  'Неизменяемый аудит административных бизнес-команд.';

COMMENT ON TABLE admin_command_executions IS
  'Серверный журнал идемпотентного исполнения административных команд.';

COMMENT ON COLUMN identity_sessions.authentication_method_id IS
  'Точный способ Identity, использованный при создании сессии.';
