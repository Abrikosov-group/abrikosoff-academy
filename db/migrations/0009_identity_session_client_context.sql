ALTER TABLE identity_sessions
  ADD COLUMN client_ip inet,
  ADD COLUMN country_code text,
  ADD COLUMN region text,
  ADD COLUMN region_code text,
  ADD COLUMN city text,
  ADD COLUMN client_timezone text,
  ADD COLUMN browser_version text,
  ADD COLUMN operating_system text,
  ADD COLUMN operating_system_version text,
  ADD COLUMN device_type text,
  ADD COLUMN device_vendor text,
  ADD COLUMN device_model text,
  ADD COLUMN preferred_language text,
  ADD COLUMN raw_user_agent text,
  ADD COLUMN cloudflare_ray_id text;

ALTER TABLE identity_sessions
  ADD CONSTRAINT identity_sessions_country_code_check
    CHECK (
      country_code IS NULL
      OR country_code ~ '^[A-Z]{2}$'
    ),
  ADD CONSTRAINT identity_sessions_region_check
    CHECK (
      region IS NULL
      OR (
        char_length(region) BETWEEN 1 AND 160
        AND region !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_region_code_check
    CHECK (
      region_code IS NULL
      OR (
        char_length(region_code) BETWEEN 1 AND 16
        AND region_code !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_city_check
    CHECK (
      city IS NULL
      OR (
        char_length(city) BETWEEN 1 AND 160
        AND city !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_client_timezone_check
    CHECK (
      client_timezone IS NULL
      OR (
        char_length(client_timezone) BETWEEN 1 AND 64
        AND client_timezone !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_browser_version_check
    CHECK (
      browser_version IS NULL
      OR (
        char_length(browser_version) BETWEEN 1 AND 80
        AND browser_version !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_operating_system_check
    CHECK (
      operating_system IS NULL
      OR (
        char_length(operating_system) BETWEEN 1 AND 80
        AND operating_system !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_operating_system_version_check
    CHECK (
      operating_system_version IS NULL
      OR (
        char_length(operating_system_version) BETWEEN 1 AND 80
        AND operating_system_version !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_device_type_check
    CHECK (
      device_type IS NULL
      OR device_type IN (
        'desktop',
        'mobile',
        'tablet',
        'bot',
        'other'
      )
    ),
  ADD CONSTRAINT identity_sessions_device_vendor_check
    CHECK (
      device_vendor IS NULL
      OR (
        char_length(device_vendor) BETWEEN 1 AND 120
        AND device_vendor !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_device_model_check
    CHECK (
      device_model IS NULL
      OR (
        char_length(device_model) BETWEEN 1 AND 120
        AND device_model !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_preferred_language_check
    CHECK (
      preferred_language IS NULL
      OR preferred_language ~
        '^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$'
    ),
  ADD CONSTRAINT identity_sessions_raw_user_agent_check
    CHECK (
      raw_user_agent IS NULL
      OR (
        char_length(raw_user_agent) BETWEEN 1 AND 1024
        AND raw_user_agent !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT identity_sessions_cloudflare_ray_id_check
    CHECK (
      cloudflare_ray_id IS NULL
      OR (
        char_length(cloudflare_ray_id) BETWEEN 1 AND 80
        AND cloudflare_ray_id ~ '^[A-Za-z0-9-]+$'
      )
    );

COMMENT ON COLUMN identity_sessions.client_ip IS
  'IP посетителя из доверенного CF-Connecting-IP; не берётся из произвольного X-Forwarded-For.';

COMMENT ON COLUMN identity_sessions.region IS
  'Приблизительный регион IP, только если Cloudflare передал заголовок visitor location.';

COMMENT ON COLUMN identity_sessions.raw_user_agent IS
  'Ограниченная 1024 символами техническая строка браузера; session token не содержит.';
