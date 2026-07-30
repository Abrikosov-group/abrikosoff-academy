CREATE INDEX identity_sessions_technical_retention_idx
  ON identity_sessions (created_at)
  WHERE
    user_agent_family IS NOT NULL
    OR client_ip IS NOT NULL
    OR country_code IS NOT NULL
    OR region IS NOT NULL
    OR region_code IS NOT NULL
    OR city IS NOT NULL
    OR client_timezone IS NOT NULL
    OR browser_version IS NOT NULL
    OR operating_system IS NOT NULL
    OR operating_system_version IS NOT NULL
    OR device_type IS NOT NULL
    OR device_vendor IS NOT NULL
    OR device_model IS NOT NULL
    OR client_architecture IS NOT NULL
    OR client_bitness IS NOT NULL
    OR preferred_language IS NOT NULL
    OR raw_user_agent IS NOT NULL
    OR cloudflare_ray_id IS NOT NULL;

COMMENT ON INDEX identity_sessions_technical_retention_idx IS
  'Ускоряет ежедневную анонимизацию технического контекста сессий старше 12 месяцев.';
