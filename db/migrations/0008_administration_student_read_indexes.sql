CREATE INDEX identity_users_admin_created_cursor_idx
  ON identity_users (created_at DESC, id DESC);

CREATE INDEX identity_users_receipt_email_lower_idx
  ON identity_users (lower(receipt_email))
  WHERE receipt_email IS NOT NULL;

CREATE INDEX identity_methods_telegram_username_lower_idx
  ON identity_methods (lower(metadata ->> 'username'))
  WHERE method_type = 'telegram' AND metadata ? 'username';

CREATE INDEX identity_methods_admin_identifier_lower_idx
  ON identity_methods (method_type, lower(identifier))
  WHERE method_type IN ('email', 'phone');

CREATE INDEX identity_methods_admin_user_verified_idx
  ON identity_methods (
    user_id,
    verified_at DESC NULLS LAST,
    created_at DESC,
    id DESC
  );

CREATE INDEX identity_sessions_admin_user_created_idx
  ON identity_sessions (user_id, created_at DESC, id DESC);

CREATE INDEX billing_access_grants_admin_user_granted_idx
  ON billing_access_grants (
    customer_id,
    granted_at DESC,
    order_id DESC
  );
