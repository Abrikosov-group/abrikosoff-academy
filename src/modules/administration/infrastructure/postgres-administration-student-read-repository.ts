import "server-only";

import type { Pool } from "pg";
import { EffectiveAccessService } from "@/modules/access/application/effective-access-service";
import { PostgresEffectiveAccessRepository } from "@/modules/access/infrastructure/postgres-effective-access-repository";
import type {
  IdentityMethodType,
  SessionAuthenticationMethod,
  SessionDeviceType,
} from "@/modules/identity/domain/types";
import { normalizeUserAvatarUrl } from "@/modules/identity/domain/user-presentation";
import type { SubscriptionPlanId } from "@/modules/billing/domain/types";
import type { AdministrationStudentReadRepository } from "../application/administration-student-read-repository";
import {
  encodeAdminStudentCursor,
  isUuid,
} from "../domain/student-list-query";
import {
  deriveEffectivePaidAccess,
  deriveEffectiveAccessSummary,
  formatPrimaryIdentityMethod,
  maskIdentityIdentifier,
} from "../domain/student-presentation";
import type {
  AdminStudentAccessState,
  AdminStudentDetail,
  AdminStudentListItem,
  AdminStudentStatus,
} from "../domain/student-read-model";

type StudentListRow = {
  id: string;
  display_name: string;
  user_status: AdminStudentStatus;
  method_type: IdentityMethodType | null;
  method_identifier: string | null;
  telegram_username: string | null;
  access_state: AdminStudentAccessState;
  active_until: Date | null;
  scheduled_from: Date | null;
  created_at: Date;
  last_session_created_at: Date | null;
  payment_count: number;
  latest_paid_plan: SubscriptionPlanId | null;
};

function mapStudentListRow(
  row: StudentListRow,
): AdminStudentListItem {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.user_status,
    primaryMethod: {
      type: row.method_type,
      label: formatPrimaryIdentityMethod({
        type: row.method_type,
        identifier: row.method_identifier,
        telegramUsername: row.telegram_username,
      }),
    },
    accessState: row.access_state,
    accessUntil: row.active_until?.toISOString(),
    scheduledFrom: row.scheduled_from?.toISOString(),
    registeredAt: row.created_at.toISOString(),
    lastSessionCreatedAt:
      row.last_session_created_at?.toISOString(),
    hasPayments: row.payment_count > 0,
    latestPaidPlan: row.latest_paid_plan ?? undefined,
  };
}

type StudentProfileRow = {
  id: string;
  display_name: string;
  receipt_email: string | null;
  status: AdminStudentStatus;
  created_at: Date;
};

type StudentMethodRow = {
  id: string;
  method_type: IdentityMethodType;
  identifier: string;
  verified_at: Date;
  metadata: unknown;
};

type StudentSessionRow = {
  id: string;
  state: "active" | "expired" | "revoked";
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  authentication_method: SessionAuthenticationMethod | null;
  user_agent_family: string | null;
  browser_version: string | null;
  operating_system: string | null;
  operating_system_version: string | null;
  device_type: SessionDeviceType | null;
  device_vendor: string | null;
  device_model: string | null;
  client_architecture: string | null;
  client_bitness: string | null;
  client_ip: string | null;
  country_code: string | null;
  region: string | null;
  region_code: string | null;
  city: string | null;
  client_timezone: string | null;
  preferred_language: string | null;
  raw_user_agent: string | null;
  cloudflare_ray_id: string | null;
  total_count: number;
  active_count: number;
};

type StudentPaidGrantRow = {
  order_id: string;
  plan_id: SubscriptionPlanId;
  status: "granted" | "revoked";
  period_start: Date;
  period_end: Date;
  granted_at: Date;
  revoked_at: Date | null;
};

type StudentManualGrantRow = {
  id: string;
  status: "granted" | "revoked";
  period_start: Date;
  period_end: Date;
  grant_reason: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
  overlaps_another: boolean;
};

type StudentGracePeriodRow = {
  id: string;
  subscription_id: string;
  renewal_attempt_id: string | null;
  status: "active" | "expired" | "revoked";
  period_start: Date;
  period_end: Date;
};

function recordFromUnknown(
  value: unknown,
): Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataText(
  metadata: Record<string, unknown>,
  key: string,
  maximumLength: number,
) {
  const value = metadata[key];
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : undefined;
}

function metadataScopes(metadata: Record<string, unknown>) {
  const scopes = metadata.requestedScopes;

  if (!Array.isArray(scopes)) return [];

  return [
    ...new Set(
      scopes.filter(
        (scope): scope is string =>
          typeof scope === "string" &&
          scope.length > 0 &&
          scope.length <= 64,
      ),
    ),
  ].slice(0, 16);
}

function metadataPositiveInteger(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata[key];

  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function metadataIsoDate(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadataText(metadata, key, 32);
  if (!value) return undefined;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString();
}

export class PostgresAdministrationStudentReadRepository
  implements AdministrationStudentReadRepository
{
  constructor(private readonly pool: Pool) {}

  async listStudents(
    input: Parameters<
      AdministrationStudentReadRepository["listStudents"]
    >[0],
  ) {
    const normalizedUsername = input.filters.query.replace(
      /^@/,
      "",
    );
    const cursorCreatedAt = input.cursor
      ? new Date(input.cursor.createdAt)
      : null;
    const result = await this.pool.query<StudentListRow>(
      `
        WITH student_rows AS (
          SELECT
            users.id,
            users.display_name,
            users.status AS user_status,
            primary_method.method_type,
            primary_method.identifier AS method_identifier,
            primary_method.telegram_username,
            CASE
              WHEN access_summary.active_until IS NOT NULL
                THEN 'active'
              WHEN access_summary.scheduled_from IS NOT NULL
                THEN 'scheduled'
              WHEN access_summary.latest_ended_at IS NOT NULL
                THEN 'expired'
              WHEN COALESCE(access_summary.grant_count, 0) > 0
                THEN 'revoked'
              ELSE 'none'
            END AS access_state,
            access_summary.active_until,
            access_summary.scheduled_from,
            COALESCE(access_summary.grant_count, 0)
              AS access_basis_count,
            COALESCE(access_summary.paid_count, 0)
              AS paid_grant_count,
            COALESCE(access_summary.manual_count, 0)
              AS manual_grant_count,
            COALESCE(access_summary.grace_count, 0)
              AS grace_period_count,
            users.created_at,
            last_session.created_at AS last_session_created_at,
            COALESCE(payment_summary.payment_count, 0)
              AS payment_count,
            latest_paid_plan.plan_id AS latest_paid_plan
          FROM identity_users users
          LEFT JOIN LATERAL (
            SELECT
              methods.method_type,
              methods.identifier,
              CASE
                WHEN methods.method_type = 'telegram'
                  THEN methods.metadata ->> 'username'
                ELSE NULL
              END AS telegram_username
            FROM identity_methods methods
            WHERE methods.user_id = users.id
            ORDER BY
              methods.verified_at DESC NULLS LAST,
              methods.created_at DESC,
              methods.id DESC
            LIMIT 1
          ) primary_method ON true
          LEFT JOIN LATERAL (
            SELECT sessions.created_at
            FROM identity_sessions sessions
            WHERE sessions.user_id = users.id
            ORDER BY sessions.created_at DESC, sessions.id DESC
            LIMIT 1
          ) last_session ON true
          LEFT JOIN LATERAL (
            WITH RECURSIVE grant_rows AS (
              SELECT
                'paid'::text AS source,
                grants.status,
                grants.period_start,
                grants.period_end
              FROM billing_access_grants grants
              WHERE grants.customer_id = users.id

              UNION ALL

              SELECT
                'manual'::text AS source,
                grants.status,
                grants.period_start,
                grants.period_end
              FROM access_manual_grants grants
              WHERE grants.customer_id = users.id

              UNION ALL

              SELECT
                'grace'::text AS source,
                CASE
                  WHEN grace.status IN ('active', 'expired') THEN 'granted'
                  ELSE 'revoked'
                END AS status,
                grace.period_start,
                grace.period_end
              FROM billing_access_grace_periods grace
              WHERE grace.customer_id = users.id
            ),
            continuous_coverage (coverage_end) AS (
              SELECT max(grant_rows.period_end)
              FROM grant_rows
              WHERE grant_rows.status = 'granted'
                AND grant_rows.period_start <= $1::timestamptz
                AND grant_rows.period_end > $1::timestamptz

              UNION

              SELECT grant_rows.period_end
              FROM continuous_coverage
              JOIN grant_rows
                ON continuous_coverage.coverage_end IS NOT NULL
                AND grant_rows.status = 'granted'
                AND grant_rows.period_start <=
                  continuous_coverage.coverage_end
                AND grant_rows.period_end >
                  continuous_coverage.coverage_end
            )
            SELECT
              count(*)::integer AS grant_count,
              count(*) FILTER (
                WHERE grant_rows.source = 'paid'
              )::integer AS paid_count,
              count(*) FILTER (
                WHERE grant_rows.source = 'manual'
              )::integer AS manual_count,
              count(*) FILTER (
                WHERE grant_rows.source = 'grace'
              )::integer AS grace_count,
              (
                SELECT max(coverage_end)
                FROM continuous_coverage
              ) AS active_until,
              min(grant_rows.period_start) FILTER (
                WHERE grant_rows.status = 'granted'
                  AND grant_rows.period_start > $1::timestamptz
              ) AS scheduled_from,
              max(grant_rows.period_end) FILTER (
                WHERE grant_rows.status = 'granted'
                  AND grant_rows.period_end <= $1::timestamptz
              ) AS latest_ended_at
            FROM grant_rows
          ) access_summary ON true
          LEFT JOIN LATERAL (
            SELECT grants.plan_id
            FROM billing_access_grants grants
            WHERE grants.customer_id = users.id
            ORDER BY
              grants.granted_at DESC,
              grants.order_id DESC
            LIMIT 1
          ) latest_paid_plan ON true
          LEFT JOIN LATERAL (
            SELECT count(payments.id)::integer AS payment_count
            FROM billing_orders orders
            JOIN billing_payments payments
              ON payments.order_id = orders.id
            WHERE orders.customer_id = users.id
          ) payment_summary ON true
          WHERE (
            $2::text = ''
            OR users.id = $3::uuid
            OR (
              $15::boolean
              AND lower(users.receipt_email) = lower($2::text)
            )
            OR strpos(
              lower(users.display_name),
              lower($2::text)
            ) > 0
            OR EXISTS (
              SELECT 1
              FROM identity_methods search_method
              WHERE search_method.user_id = users.id
                AND (
                  (
                    search_method.method_type = 'telegram'
                    AND search_method.identifier = $2::text
                  )
                  OR (
                    search_method.method_type = 'telegram'
                    AND search_method.metadata ->> 'telegramUserId' =
                      $2::text
                  )
                  OR (
                    search_method.method_type IN ('email', 'phone')
                    AND lower(search_method.identifier) =
                      lower($2::text)
                  )
                  OR (
                    search_method.method_type = 'telegram'
                    AND lower(
                      search_method.metadata ->> 'username'
                    ) = lower($4::text)
                  )
                )
            )
          )
        )
        SELECT
          id,
          display_name,
          user_status,
          method_type,
          method_identifier,
          telegram_username,
          access_state,
          active_until,
          scheduled_from,
          created_at,
          last_session_created_at,
          payment_count,
          latest_paid_plan
        FROM student_rows
        WHERE (
            $5::text IS NULL
            OR (
              $5::text = 'not_deleted'
              AND user_status <> 'deleted'
            )
            OR user_status = $5::text
          )
          AND ($6::text IS NULL OR access_state = $6::text)
          AND (
            $7::text IS NULL
            OR ($7::text = 'paid' AND paid_grant_count > 0)
            OR ($7::text = 'manual' AND manual_grant_count > 0)
            OR ($7::text = 'grace' AND grace_period_count > 0)
          )
          AND (
            $8::text IS NULL
            OR latest_paid_plan = $8::text
          )
          AND (
            $9::date IS NULL
            OR (created_at AT TIME ZONE $11::text)::date >= $9::date
          )
          AND (
            $10::date IS NULL
            OR (created_at AT TIME ZONE $11::text)::date <= $10::date
          )
          AND (
            $12::timestamptz IS NULL
            OR created_at < $12::timestamptz
            OR (
              created_at = $12::timestamptz
              AND id < $13::uuid
            )
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $14::integer
      `,
      [
        input.at,
        input.filters.query,
        isUuid(input.filters.query) ? input.filters.query : null,
        normalizedUsername,
        input.filters.status ?? null,
        input.filters.access ?? null,
        input.filters.source ?? null,
        input.filters.plan ?? null,
        input.filters.registeredFrom ?? null,
        input.filters.registeredTo ?? null,
        input.displayTimeZone,
        cursorCreatedAt,
        input.cursor?.id ?? null,
        input.filters.limit + 1,
        input.scope.paymentContext,
      ],
    );
    const hasMore = result.rows.length > input.filters.limit;
    const visibleRows = result.rows.slice(0, input.filters.limit);
    const items = visibleRows.map(mapStudentListRow);
    const lastItem = visibleRows.at(-1);

    return {
      items,
      nextCursor:
        hasMore && lastItem
          ? encodeAdminStudentCursor({
              createdAt: lastItem.created_at.toISOString(),
              id: lastItem.id,
            })
          : undefined,
    };
  }

  async findStudentDetail(
    input: Parameters<
      AdministrationStudentReadRepository["findStudentDetail"]
    >[0],
  ): Promise<AdminStudentDetail | null> {
    if (!isUuid(input.userId)) {
      return null;
    }

    const client = await this.pool.connect();

    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const profile = await client.query<StudentProfileRow>(
        `
          SELECT
            id,
            display_name,
            CASE
              WHEN $2::boolean THEN receipt_email
              ELSE NULL
            END AS receipt_email,
            status,
            created_at
          FROM identity_users
          WHERE id = $1
          LIMIT 1
        `,
        [input.userId, input.scope.paymentContext],
      );
      const student = profile.rows[0];

      if (!student) {
        await client.query("ROLLBACK");
        return null;
      }

      const methods = await client.query<StudentMethodRow>(
        `
          SELECT
            id,
            method_type,
            identifier,
            verified_at,
            metadata
          FROM identity_methods
          WHERE user_id = $1
          ORDER BY verified_at DESC, created_at DESC, id DESC
        `,
        [input.userId],
      );
      const sessions = await client.query<StudentSessionRow>(
        `
          SELECT
            id,
            CASE
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              WHEN expires_at <= $2::timestamptz THEN 'expired'
              ELSE 'active'
            END AS state,
            created_at,
            last_seen_at,
            expires_at,
            revoked_at,
            authentication_method,
            user_agent_family,
            browser_version,
            operating_system,
            operating_system_version,
            device_type,
            device_vendor,
            device_model,
            client_architecture,
            client_bitness,
            host(client_ip) AS client_ip,
            country_code,
            region,
            region_code,
            city,
            client_timezone,
            preferred_language,
            raw_user_agent,
            cloudflare_ray_id,
            count(*) OVER ()::integer AS total_count,
            count(*) FILTER (
              WHERE revoked_at IS NULL
                AND expires_at > $2::timestamptz
            ) OVER ()::integer AS active_count
          FROM identity_sessions
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 100
        `,
        [input.userId, input.at],
      );
      const paidGrants = await client.query<StudentPaidGrantRow>(
        `
          SELECT
            order_id,
            plan_id,
            status,
            period_start,
            period_end,
            granted_at,
            revoked_at
          FROM billing_access_grants
          WHERE customer_id = $1
          ORDER BY granted_at DESC, order_id DESC
        `,
        [input.userId],
      );
      const manualGrants = await client.query<StudentManualGrantRow>(
        `
          SELECT
            grants.id,
            grants.status,
            grants.period_start,
            grants.period_end,
            grants.grant_reason,
            grants.granted_at,
            grants.revoked_at,
            grants.revoke_reason,
            EXISTS (
              SELECT 1
              FROM access_manual_grants other
              WHERE other.customer_id = grants.customer_id
                AND other.id <> grants.id
                AND other.status = 'granted'
                AND other.period_start < grants.period_end
                AND other.period_end > grants.period_start
            ) AS overlaps_another
          FROM access_manual_grants grants
          WHERE grants.customer_id = $1
          ORDER BY grants.granted_at DESC, grants.id DESC
        `,
        [input.userId],
      );
      const gracePeriods = await client.query<StudentGracePeriodRow>(
        `
          SELECT
            grace.id,
            grace.subscription_id,
            CASE
              WHEN $2::boolean THEN (
                SELECT attempt.id
                FROM billing_subscription_renewal_attempts attempt
                WHERE attempt.subscription_id = grace.subscription_id
                  AND attempt.period_start = grace.period_start
                ORDER BY attempt.created_at DESC, attempt.id DESC
                LIMIT 1
              )
              ELSE NULL
            END AS renewal_attempt_id,
            grace.status,
            grace.period_start,
            grace.period_end
          FROM billing_access_grace_periods grace
          WHERE grace.customer_id = $1
          ORDER BY grace.period_start DESC, grace.id DESC
        `,
        [input.userId, input.scope.billingContext],
      );
      const effectiveAccessDecision =
        await new EffectiveAccessService(
          new PostgresEffectiveAccessRepository(client),
        ).getEffectiveAccess(input.userId, input.at);
      const payments = input.scope.billingContext
        ? await client.query<{ payment_count: number }>(
            `
              SELECT count(payments.id)::integer
                AS payment_count
              FROM billing_orders orders
              JOIN billing_payments payments
                ON payments.order_id = orders.id
              WHERE orders.customer_id = $1
            `,
            [input.userId],
          )
        : undefined;
      await client.query("COMMIT");

      const rawPaidGrants = paidGrants.rows.map((grant) => ({
        source: "paid" as const,
        ...(input.scope.billingContext
          ? { orderId: grant.order_id }
          : {}),
        planId: grant.plan_id,
        status: grant.status,
        periodStart: grant.period_start.toISOString(),
        periodEnd: grant.period_end.toISOString(),
        grantedAt: grant.granted_at.toISOString(),
        revokedAt: grant.revoked_at?.toISOString(),
      }));
      const effectiveAccess = deriveEffectivePaidAccess(
        rawPaidGrants,
        input.at,
      );
      const effectiveBasisIds = new Set(
        effectiveAccessDecision.activeBases.map(
          (basis) => `${basis.source}:${basis.id}`,
        ),
      );
      const mappedManualGrants = manualGrants.rows.map((grant) => ({
        id: grant.id,
        source: "manual" as const,
        status: grant.status,
        periodStart: grant.period_start.toISOString(),
        periodEnd: grant.period_end.toISOString(),
        grantReason: grant.grant_reason,
        grantedAt: grant.granted_at.toISOString(),
        revokedAt: grant.revoked_at?.toISOString(),
        revokeReason: grant.revoke_reason ?? undefined,
        effectiveNow: effectiveBasisIds.has(`manual:${grant.id}`),
        overlapsAnotherManualGrant: grant.overlaps_another,
        canRevoke:
          input.scope.canRevokeManualAccess &&
          grant.status === "granted",
      }));
      const mappedGracePeriods = gracePeriods.rows.map((grace) => ({
        id: grace.id,
        source: "grace" as const,
        displayName: "Льготный период автопродления" as const,
        status: grace.status,
        periodStart: grace.period_start.toISOString(),
        periodEnd: grace.period_end.toISOString(),
        effectiveNow:
          grace.status === "active" &&
          grace.period_start.getTime() <= input.at.getTime() &&
          grace.period_end.getTime() > input.at.getTime(),
        ...(input.scope.billingContext
          ? {
              subscriptionId: grace.subscription_id,
              renewalAttemptId: grace.renewal_attempt_id ?? undefined,
            }
          : {}),
      }));

      return {
        id: student.id,
        displayName: student.display_name,
        paymentContextVisible: input.scope.paymentContext,
        billingContextVisible: input.scope.billingContext,
        ...(input.scope.paymentContext
          ? {
              receiptEmail:
                student.receipt_email ?? undefined,
            }
          : {}),
        status: student.status,
        createdAt: student.created_at.toISOString(),
        methods: methods.rows.map((method) => {
          const metadata = recordFromUnknown(method.metadata);
          const telegramUsername =
            method.method_type === "telegram"
              ? metadataText(metadata, "username", 64)
              : undefined;

          return {
            id: method.id,
            type: method.method_type,
            maskedIdentifier: maskIdentityIdentifier(
              method.method_type,
              method.identifier,
            ),
            verifiedAt: method.verified_at.toISOString(),
            telegramUsername,
            telegramProfile:
              method.method_type === "telegram"
                ? {
                    subject: method.identifier,
                    metadataVersion: metadataPositiveInteger(
                      metadata,
                      "profileMetadataVersion",
                    ),
                    userId: metadataText(
                      metadata,
                      "telegramUserId",
                      20,
                    ),
                    profileName: metadataText(
                      metadata,
                      "profileName",
                      160,
                    ),
                    firstName: metadataText(
                      metadata,
                      "firstName",
                      80,
                    ),
                    lastName: metadataText(
                      metadata,
                      "lastName",
                      80,
                    ),
                    username: telegramUsername,
                    photoUrl: normalizeUserAvatarUrl(
                      metadata.photoUrl,
                    ),
                    requestedScopes: metadataScopes(metadata),
                    tokenIssuedAt: metadataIsoDate(
                      metadata,
                      "tokenIssuedAt",
                    ),
                    tokenExpiresAt: metadataIsoDate(
                      metadata,
                      "tokenExpiresAt",
                    ),
                  }
                : undefined,
          };
        }),
        sessions: sessions.rows.map((session) => ({
          id: session.id,
          state: session.state,
          createdAt: session.created_at.toISOString(),
          lastSeenAt: session.last_seen_at.toISOString(),
          expiresAt: session.expires_at.toISOString(),
          revokedAt: session.revoked_at?.toISOString(),
          authenticationMethod:
            session.authentication_method ?? undefined,
          userAgentFamily:
            session.user_agent_family ?? undefined,
          browserVersion:
            session.browser_version ?? undefined,
          operatingSystem:
            session.operating_system ?? undefined,
          operatingSystemVersion:
            session.operating_system_version ?? undefined,
          deviceType: session.device_type ?? undefined,
          deviceVendor: session.device_vendor ?? undefined,
          deviceModel: session.device_model ?? undefined,
          architecture:
            session.client_architecture ?? undefined,
          bitness: session.client_bitness ?? undefined,
          ipAddress: session.client_ip ?? undefined,
          countryCode: session.country_code ?? undefined,
          region: session.region ?? undefined,
          regionCode: session.region_code ?? undefined,
          city: session.city ?? undefined,
          timezone: session.client_timezone ?? undefined,
          preferredLanguage:
            session.preferred_language ?? undefined,
          rawUserAgent: session.raw_user_agent ?? undefined,
          cloudflareRayId:
            session.cloudflare_ray_id ?? undefined,
        })),
        sessionCount: sessions.rows[0]?.total_count ?? 0,
        activeSessionCount:
          sessions.rows[0]?.active_count ?? 0,
        sessionsTruncated:
          (sessions.rows[0]?.total_count ?? 0) >
          sessions.rows.length,
        paidGrants: effectiveAccess.grants,
        manualGrants: mappedManualGrants,
        gracePeriods: mappedGracePeriods,
        effectiveAccess: deriveEffectiveAccessSummary(
          [
            ...effectiveAccess.grants,
            ...mappedManualGrants,
            ...mappedGracePeriods,
          ],
          input.at,
        ),
        ...(input.scope.billingContext
          ? {
              paymentCount:
                payments?.rows[0]?.payment_count ?? 0,
            }
          : {}),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
