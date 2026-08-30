const shadowReadinessSql = `
  WITH observation AS (
    SELECT clock_timestamp() AS evaluated_at
  ),
  observed_users AS (
    SELECT
      users.id,
      COALESCE(
        subscription.status IN ('active', 'grace_period')
        AND subscription.current_period_end > observation.evaluated_at,
        false
      ) AS legacy_can_read,
      (
        EXISTS (
          SELECT 1
          FROM billing_access_grants grants
          WHERE grants.customer_id = users.id
            AND (
              grants.status = 'granted'
              OR (
                grants.status = 'revoked'
                AND grants.revoked_at > observation.evaluated_at
              )
            )
            AND grants.granted_at <= observation.evaluated_at
            AND grants.created_at <= observation.evaluated_at
            AND grants.period_start <= observation.evaluated_at
            AND grants.period_end > observation.evaluated_at
        )
        OR EXISTS (
          SELECT 1
          FROM access_manual_grants grants
          WHERE grants.customer_id = users.id
            AND (
              grants.status = 'granted'
              OR (
                grants.status = 'revoked'
                AND grants.revoked_at > observation.evaluated_at
              )
            )
            AND grants.granted_at <= observation.evaluated_at
            AND grants.created_at <= observation.evaluated_at
            AND grants.period_start <= observation.evaluated_at
            AND grants.period_end > observation.evaluated_at
        )
      ) AS v2_can_read
    FROM identity_users users
    CROSS JOIN observation
    LEFT JOIN LATERAL (
      SELECT status, current_period_end
      FROM billing_subscriptions
      WHERE customer_id = users.id
      ORDER BY created_at DESC
      LIMIT 1
    ) subscription ON true
  ),
  summary AS (
    SELECT
      count(*) AS observed_user_count,
      count(*) FILTER (WHERE legacy_can_read) AS legacy_can_read_count,
      count(*) FILTER (WHERE v2_can_read) AS v2_can_read_count,
      count(*) FILTER (
        WHERE legacy_can_read AND NOT v2_can_read
      ) AS legacy_only_count,
      count(*) FILTER (
        WHERE v2_can_read AND NOT legacy_can_read
      ) AS v2_only_count
    FROM observed_users
  )
  SELECT
    observation.evaluated_at,
    current_setting('transaction_read_only')::boolean
      AS transaction_read_only,
    EXISTS (SELECT 1 FROM access_manual_grants)
      AS manual_grant_history_present,
    summary.observed_user_count,
    summary.legacy_can_read_count,
    summary.v2_can_read_count,
    summary.legacy_only_count,
    summary.v2_only_count
  FROM summary
  CROSS JOIN observation
`;

export class EffectiveAccessShadowReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EffectiveAccessShadowReadinessError";
    this.code = code;
  }
}

function parseBooleanFlag(name, rawValue, defaultValue) {
  const normalized = rawValue?.trim().toLowerCase() || String(defaultValue);

  if (normalized !== "true" && normalized !== "false") {
    throw new EffectiveAccessShadowReadinessError(
      "INVALID_CONFIGURATION",
      `${name} должен быть true или false.`,
    );
  }

  return normalized === "true";
}

export function readEffectiveAccessShadowConfiguration(environment) {
  const effectiveAccessMode =
    environment.EFFECTIVE_ACCESS_MODE?.trim().toLowerCase() || "shadow";
  const manualAccessGrantingEnabled = parseBooleanFlag(
    "MANUAL_ACCESS_GRANTING_ENABLED",
    environment.MANUAL_ACCESS_GRANTING_ENABLED,
    false,
  );

  if (effectiveAccessMode !== "shadow") {
    throw new EffectiveAccessShadowReadinessError(
      "SHADOW_MODE_REQUIRED",
      "Проверка готовности выполняется только в режиме shadow.",
    );
  }

  if (manualAccessGrantingEnabled) {
    throw new EffectiveAccessShadowReadinessError(
      "MANUAL_GRANTING_MUST_BE_DISABLED",
      "На этапе shadow выдача ручного доступа должна быть выключена.",
    );
  }

  return {
    effectiveAccessMode,
    manualAccessGrantingEnabled,
  };
}

function parseCount(name, value) {
  const count = Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new EffectiveAccessShadowReadinessError(
      "INVALID_DATABASE_RESULT",
      `PostgreSQL вернул некорректное значение ${name}.`,
    );
  }

  return count;
}

function createReport(row, configuration) {
  if (!(row?.evaluated_at instanceof Date)) {
    throw new EffectiveAccessShadowReadinessError(
      "INVALID_DATABASE_RESULT",
      "PostgreSQL не вернул время shadow-снимка.",
    );
  }

  if (row.transaction_read_only !== true) {
    throw new EffectiveAccessShadowReadinessError(
      "READ_ONLY_TRANSACTION_REQUIRED",
      "Shadow-проверка должна выполняться в read-only транзакции.",
    );
  }

  const observedUserCount = parseCount(
    "observed_user_count",
    row.observed_user_count,
  );
  const legacyCanReadCount = parseCount(
    "legacy_can_read_count",
    row.legacy_can_read_count,
  );
  const v2CanReadCount = parseCount(
    "v2_can_read_count",
    row.v2_can_read_count,
  );
  const legacyOnlyCount = parseCount(
    "legacy_only_count",
    row.legacy_only_count,
  );
  const v2OnlyCount = parseCount(
    "v2_only_count",
    row.v2_only_count,
  );
  const blockers = [];

  if (row.manual_grant_history_present === true) {
    blockers.push("MANUAL_GRANT_HISTORY_PRESENT");
  }
  if (legacyOnlyCount > 0) {
    blockers.push("EFFECTIVE_ACCESS_LEGACY_ONLY");
  }
  if (v2OnlyCount > 0) {
    blockers.push("EFFECTIVE_ACCESS_V2_ONLY");
  }

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    evaluatedAt: row.evaluated_at.toISOString(),
    configuration,
    observation: {
      observedUserCount,
      legacyCanReadCount,
      v2CanReadCount,
      mismatchCount: legacyOnlyCount + v2OnlyCount,
      legacyOnlyCount,
      v2OnlyCount,
      manualGrantHistoryPresent:
        row.manual_grant_history_present === true,
    },
    blockers,
  };
}

export async function inspectEffectiveAccessShadowReadiness(
  client,
  configuration,
) {
  let transactionStarted = false;

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionStarted = true;

    const result = await client.query(shadowReadinessSql);
    const report = createReport(result.rows[0], configuration);

    await client.query("COMMIT");
    transactionStarted = false;

    return report;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Исходная ошибка важнее диагностической ошибки отката read-only снимка.
      }
    }

    throw error;
  }
}
