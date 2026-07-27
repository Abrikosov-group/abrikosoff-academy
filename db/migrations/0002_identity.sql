CREATE TABLE identity_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  receipt_email text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'blocked', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_methods (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity_users(id),
  method_type text NOT NULL
    CHECK (method_type IN ('telegram', 'email', 'phone')),
  identifier text NOT NULL,
  verified_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (method_type, identifier)
);

CREATE INDEX identity_methods_user_idx
  ON identity_methods (user_id, created_at);

CREATE TABLE identity_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity_users(id),
  token_sha256 char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_sessions_user_active_idx
  ON identity_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE identity_login_challenges (
  id uuid PRIMARY KEY,
  method_type text NOT NULL
    CHECK (method_type IN ('email', 'phone')),
  identifier text NOT NULL,
  token_sha256 char(64) NOT NULL UNIQUE,
  display_name text NOT NULL,
  redirect_path text NOT NULL,
  consent_accepted_at timestamptz NOT NULL,
  consent_document_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_login_challenges_lookup_idx
  ON identity_login_challenges (method_type, identifier, created_at DESC);

CREATE TABLE identity_consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity_users(id),
  document_type text NOT NULL
    CHECK (document_type IN ('privacy', 'offer', 'recurring_payment')),
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_type, document_version)
);

COMMENT ON TABLE identity_sessions IS
  'Хранятся только SHA-256 хэши случайных session-токенов.';

COMMENT ON TABLE identity_methods IS
  'Один ученик может привязать Telegram, email и телефон к общей учётной записи.';
