ALTER TABLE identity_sessions
  ADD COLUMN client_architecture text,
  ADD COLUMN client_bitness text;

ALTER TABLE identity_sessions
  ADD CONSTRAINT identity_sessions_client_architecture_check
    CHECK (
      client_architecture IS NULL
      OR (
        char_length(client_architecture) BETWEEN 1 AND 32
        AND client_architecture ~ '^[A-Za-z0-9._-]+$'
      )
    ),
  ADD CONSTRAINT identity_sessions_client_bitness_check
    CHECK (
      client_bitness IS NULL
      OR client_bitness ~ '^[0-9]{1,3}$'
    );

COMMENT ON COLUMN identity_sessions.client_architecture IS
  'Архитектура устройства из браузерного Client Hint Sec-CH-UA-Arch.';

COMMENT ON COLUMN identity_sessions.client_bitness IS
  'Разрядность устройства из браузерного Client Hint Sec-CH-UA-Bitness.';
