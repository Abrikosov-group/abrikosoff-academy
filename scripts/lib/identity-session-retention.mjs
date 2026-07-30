export const identitySessionTechnicalDataRetentionMonths = 12;

const technicalContextPresentSql = `
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
  OR cloudflare_ray_id IS NOT NULL
`;

export async function purgeIdentitySessionTechnicalData(
  client,
  { now = new Date() } = {},
) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("Для очистки требуется корректное время.");
  }

  const result = await client.query(
    `
      UPDATE identity_sessions
      SET
        user_agent_family = NULL,
        client_ip = NULL,
        country_code = NULL,
        region = NULL,
        region_code = NULL,
        city = NULL,
        client_timezone = NULL,
        browser_version = NULL,
        operating_system = NULL,
        operating_system_version = NULL,
        device_type = NULL,
        device_vendor = NULL,
        device_model = NULL,
        client_architecture = NULL,
        client_bitness = NULL,
        preferred_language = NULL,
        raw_user_agent = NULL,
        cloudflare_ray_id = NULL
      WHERE created_at < (
        $1::timestamptz
        - make_interval(
            months => ${identitySessionTechnicalDataRetentionMonths}
          )
      )
        AND (${technicalContextPresentSql})
    `,
    [now],
  );

  return result.rowCount ?? 0;
}
