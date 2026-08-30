const shadowReadinessSql = `
  WITH observation AS (
    SELECT clock_timestamp() AS evaluated_at
  ),
  latest_subscription_timestamps AS MATERIALIZED (
    SELECT
      subscriptions.customer_id,
      max(subscriptions.created_at) AS created_at
    FROM billing_subscriptions subscriptions
    GROUP BY subscriptions.customer_id
  ),
  ambiguous_latest_subscriptions AS MATERIALIZED (
    SELECT subscriptions.customer_id
    FROM billing_subscriptions subscriptions
    JOIN latest_subscription_timestamps latest
      ON latest.customer_id = subscriptions.customer_id
      AND latest.created_at = subscriptions.created_at
    GROUP BY subscriptions.customer_id
    HAVING count(*) > 1
  ),
  latest_subscriptions AS MATERIALIZED (
    SELECT DISTINCT ON (subscriptions.customer_id)
      subscriptions.customer_id,
      subscriptions.status,
      subscriptions.current_period_start,
      subscriptions.current_period_end
    FROM billing_subscriptions subscriptions
    ORDER BY
      subscriptions.customer_id,
      subscriptions.created_at DESC,
      subscriptions.id DESC
  ),
  active_access_bases AS MATERIALIZED (
    SELECT
      grants.customer_id,
      grants.period_start,
      grants.period_end,
      CASE
        WHEN grants.status = 'revoked'
          THEN least(grants.period_end, grants.revoked_at)
        ELSE grants.period_end
      END AS effective_end
    FROM billing_access_grants grants
    CROSS JOIN observation
    WHERE (
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

    UNION ALL

    SELECT
      grants.customer_id,
      grants.period_start,
      grants.period_end,
      CASE
        WHEN grants.status = 'revoked'
          THEN least(grants.period_end, grants.revoked_at)
        ELSE grants.period_end
      END AS effective_end
    FROM access_manual_grants grants
    CROSS JOIN observation
    WHERE (
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
  ),
  effective_periods AS MATERIALIZED (
    SELECT
      bases.customer_id,
      min(bases.period_start) AS period_start,
      max(bases.period_end) AS period_end
    FROM active_access_bases bases
    GROUP BY bases.customer_id
  ),
  future_access_activation_or_revocation_customers AS MATERIALIZED (
    SELECT grants.customer_id
    FROM billing_access_grants grants
    CROSS JOIN observation
    WHERE (
        greatest(
          grants.period_start,
          grants.granted_at,
          grants.created_at
        ) > observation.evaluated_at
        AND grants.period_end > greatest(
          grants.period_start,
          grants.granted_at,
          grants.created_at
        )
        AND (
          grants.status = 'granted'
          OR (
            grants.status = 'revoked'
            AND grants.revoked_at > greatest(
              grants.period_start,
              grants.granted_at,
              grants.created_at
            )
          )
        )
      )
      OR (
        grants.status = 'revoked'
        AND grants.revoked_at > observation.evaluated_at
        AND grants.revoked_at < grants.period_end
        AND grants.revoked_at > greatest(
          grants.period_start,
          grants.granted_at,
          grants.created_at
        )
      )

    UNION

    SELECT grants.customer_id
    FROM access_manual_grants grants
    CROSS JOIN observation
    WHERE (
        greatest(
          grants.period_start,
          grants.granted_at,
          grants.created_at
        ) > observation.evaluated_at
        AND grants.period_end > greatest(
          grants.period_start,
          grants.granted_at,
          grants.created_at
        )
        AND (
          grants.status = 'granted'
          OR (
            grants.status = 'revoked'
            AND grants.revoked_at > greatest(
              grants.period_start,
              grants.granted_at,
              grants.created_at
            )
          )
        )
      )
      OR (
        grants.status = 'revoked'
        AND grants.revoked_at > observation.evaluated_at
        AND grants.revoked_at < grants.period_end
        AND grants.revoked_at > greatest(
          grants.period_start,
          grants.granted_at,
          grants.created_at
        )
      )
  ),
  future_access_expiration_states AS MATERIALIZED (
    SELECT
      expiring.customer_id,
      date_trunc('milliseconds', expiring.effective_end) AS transition_at,
      count(remaining.customer_id) > 0 AS v2_can_read,
      min(remaining.period_start) AS period_start,
      max(remaining.period_end) AS period_end
    FROM (
      SELECT DISTINCT customer_id, effective_end
      FROM active_access_bases
    ) expiring
    LEFT JOIN active_access_bases remaining
      ON remaining.customer_id = expiring.customer_id
      AND date_trunc('milliseconds', remaining.effective_end)
        > date_trunc('milliseconds', expiring.effective_end)
    GROUP BY expiring.customer_id, expiring.effective_end
  ),
  future_access_expiration_mismatch_customers AS MATERIALIZED (
    SELECT DISTINCT states.customer_id
    FROM future_access_expiration_states states
    CROSS JOIN observation
    LEFT JOIN latest_subscriptions subscription
      ON subscription.customer_id = states.customer_id
    JOIN effective_periods current_period
      ON current_period.customer_id = states.customer_id
    WHERE subscription.status IN ('active', 'grace_period')
      AND subscription.current_period_end > observation.evaluated_at
      AND date_trunc('milliseconds', subscription.current_period_start)
        IS NOT DISTINCT FROM
          date_trunc('milliseconds', current_period.period_start)
      AND date_trunc('milliseconds', subscription.current_period_end)
        IS NOT DISTINCT FROM
          date_trunc('milliseconds', current_period.period_end)
      AND (
        (
          date_trunc('milliseconds', subscription.current_period_end)
            > states.transition_at
        ) IS DISTINCT FROM states.v2_can_read
        OR (
          states.v2_can_read
          AND date_trunc('milliseconds', subscription.current_period_end)
            > states.transition_at
          AND (
            date_trunc('milliseconds', subscription.current_period_start)
              IS DISTINCT FROM
                date_trunc('milliseconds', states.period_start)
            OR date_trunc('milliseconds', subscription.current_period_end)
              IS DISTINCT FROM
                date_trunc('milliseconds', states.period_end)
          )
        )
      )
  ),
  future_access_transition_customers AS MATERIALIZED (
    SELECT customer_id
    FROM future_access_activation_or_revocation_customers

    UNION

    SELECT customer_id
    FROM future_access_expiration_mismatch_customers
  ),
  observed_users AS (
    SELECT
      users.id,
      COALESCE(
        subscription.status IN ('active', 'grace_period')
        AND subscription.current_period_end > observation.evaluated_at,
        false
      ) AS legacy_can_read,
      effective_periods.customer_id IS NOT NULL AS v2_can_read,
      future_transition.customer_id IS NOT NULL AS future_v2_transition,
      ambiguous_subscription.customer_id IS NOT NULL
        AS ambiguous_latest_subscription,
      (
        subscription.status IN ('active', 'grace_period')
        AND subscription.current_period_end > observation.evaluated_at
        AND effective_periods.customer_id IS NOT NULL
        AND (
          date_trunc('milliseconds', subscription.current_period_start)
            IS DISTINCT FROM
              date_trunc('milliseconds', effective_periods.period_start)
          OR date_trunc('milliseconds', subscription.current_period_end)
            IS DISTINCT FROM
              date_trunc('milliseconds', effective_periods.period_end)
        )
      ) AS period_boundary_mismatch
    FROM identity_users users
    CROSS JOIN observation
    LEFT JOIN latest_subscriptions subscription
      ON subscription.customer_id = users.id
    LEFT JOIN effective_periods
      ON effective_periods.customer_id = users.id
    LEFT JOIN future_access_transition_customers future_transition
      ON future_transition.customer_id = users.id
    LEFT JOIN ambiguous_latest_subscriptions ambiguous_subscription
      ON ambiguous_subscription.customer_id = users.id
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
      ) AS v2_only_count,
      count(*) FILTER (
        WHERE period_boundary_mismatch
      ) AS period_boundary_mismatch_count,
      count(*) FILTER (
        WHERE future_v2_transition
      ) AS future_v2_transition_count,
      count(*) FILTER (
        WHERE ambiguous_latest_subscription
      ) AS ambiguous_latest_subscription_count
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
    summary.v2_only_count,
    summary.period_boundary_mismatch_count,
    summary.future_v2_transition_count,
    summary.ambiguous_latest_subscription_count
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
  const periodBoundaryMismatchCount = parseCount(
    "period_boundary_mismatch_count",
    row.period_boundary_mismatch_count,
  );
  const futureV2TransitionCount = parseCount(
    "future_v2_transition_count",
    row.future_v2_transition_count,
  );
  const ambiguousLatestSubscriptionCount = parseCount(
    "ambiguous_latest_subscription_count",
    row.ambiguous_latest_subscription_count,
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
  if (periodBoundaryMismatchCount > 0) {
    blockers.push("EFFECTIVE_ACCESS_PERIOD_BOUNDARY_MISMATCH");
  }
  if (futureV2TransitionCount > 0) {
    blockers.push("EFFECTIVE_ACCESS_FUTURE_TRANSITION");
  }
  if (ambiguousLatestSubscriptionCount > 0) {
    blockers.push("LEGACY_SUBSCRIPTION_ORDER_AMBIGUOUS");
  }

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    evaluatedAt: row.evaluated_at.toISOString(),
    configuration,
    observation: {
      observedUserCount,
      legacyCanReadCount,
      v2CanReadCount,
      mismatchCount:
        legacyOnlyCount +
        v2OnlyCount +
        periodBoundaryMismatchCount +
        futureV2TransitionCount,
      legacyOnlyCount,
      v2OnlyCount,
      periodBoundaryMismatchCount,
      futureV2TransitionCount,
      ambiguousLatestSubscriptionCount,
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
