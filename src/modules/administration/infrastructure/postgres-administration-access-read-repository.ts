import "server-only";

import type { Pool } from "pg";
import type { SubscriptionPlanId } from "@/modules/billing/domain/types";
import type { AdministrationAccessReadRepository } from "../application/administration-access-read-repository";
import {
  encodeAdminAccessCursor,
  type AdminAccessListItem,
  type AdminAccessSource,
  type AdminAccessState,
} from "../domain/access-read-model";

type AccessRow = {
  id: string;
  customer_id: string;
  display_name: string;
  source: AdminAccessSource;
  state: AdminAccessState;
  period_start: Date;
  period_end: Date;
  plan_id: SubscriptionPlanId | null;
  grant_reason: string | null;
  granted_at: Date | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
  overlaps_another: boolean;
  access_remains_after_revoke: boolean;
};

export class PostgresAdministrationAccessReadRepository
  implements AdministrationAccessReadRepository
{
  constructor(private readonly pool: Pool) {}

  async listAccess(
    input: Parameters<AdministrationAccessReadRepository["listAccess"]>[0],
  ) {
    const result = await this.pool.query<AccessRow>(
      `
        WITH access_rows AS (
          SELECT
            grants.order_id AS id,
            grants.customer_id,
            'paid'::text AS source,
            CASE
              WHEN grants.status = 'revoked' THEN 'revoked'
              WHEN grants.period_start > $1 THEN 'scheduled'
              WHEN grants.period_end <= $1 THEN 'expired'
              ELSE 'active'
            END AS state,
            grants.period_start,
            grants.period_end,
            grants.plan_id,
            NULL::text AS grant_reason,
            grants.granted_at,
            grants.revoked_at,
            NULL::text AS revoke_reason,
            false AS overlaps_another,
            false AS access_remains_after_revoke
          FROM billing_access_grants grants

          UNION ALL

          SELECT
            grants.id,
            grants.customer_id,
            'manual'::text AS source,
            CASE
              WHEN grants.status = 'revoked' THEN 'revoked'
              WHEN grants.period_start > $1 THEN 'scheduled'
              WHEN grants.period_end <= $1 THEN 'expired'
              ELSE 'active'
            END AS state,
            grants.period_start,
            grants.period_end,
            NULL::text AS plan_id,
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
            ) AS overlaps_another,
            (
              EXISTS (
                SELECT 1
                FROM billing_access_grants paid
                WHERE paid.customer_id = grants.customer_id
                  AND paid.status = 'granted'
                  AND paid.period_start <= $1
                  AND paid.period_end > $1
              )
              OR EXISTS (
                SELECT 1
                FROM access_manual_grants other
                WHERE other.customer_id = grants.customer_id
                  AND other.id <> grants.id
                  AND other.status = 'granted'
                  AND other.period_start <= $1
                  AND other.period_end > $1
              )
              OR EXISTS (
                SELECT 1
                FROM billing_access_grace_periods grace
                WHERE grace.customer_id = grants.customer_id
                  AND grace.status = 'active'
                  AND grace.period_start <= $1
                  AND grace.period_end > $1
              )
            ) AS access_remains_after_revoke
          FROM access_manual_grants grants

          UNION ALL

          SELECT
            grace.id,
            grace.customer_id,
            'grace'::text AS source,
            CASE
              WHEN grace.status = 'revoked' THEN 'revoked'
              WHEN grace.period_start > $1 THEN 'scheduled'
              WHEN grace.period_end <= $1 OR grace.status = 'expired'
                THEN 'expired'
              ELSE 'active'
            END AS state,
            grace.period_start,
            grace.period_end,
            NULL::text AS plan_id,
            NULL::text AS grant_reason,
            grace.created_at AS granted_at,
            grace.revoked_at,
            NULL::text AS revoke_reason,
            false AS overlaps_another,
            false AS access_remains_after_revoke
          FROM billing_access_grace_periods grace
        )
        SELECT
          rows.*,
          users.display_name
        FROM access_rows rows
        JOIN identity_users users ON users.id = rows.customer_id
        WHERE ($2::text IS NULL OR rows.source = $2)
          AND ($3::text IS NULL OR rows.state = $3)
          AND (
            $4::text = ''
            OR users.id::text = $4
            OR strpos(lower(users.display_name), lower($4)) > 0
            OR EXISTS (
              SELECT 1
              FROM identity_methods methods
              WHERE methods.user_id = users.id
                AND (
                  lower(methods.identifier) = lower($4)
                  OR lower(methods.metadata ->> 'username') =
                    lower(regexp_replace($4, '^@', ''))
                )
            )
          )
          AND (
            $5::timestamptz IS NULL
            OR rows.period_start < $5
            OR (rows.period_start = $5 AND rows.source > $6)
            OR (
              rows.period_start = $5
              AND rows.source = $6
              AND rows.id < $7::uuid
            )
          )
        ORDER BY rows.period_start DESC, rows.source ASC, rows.id DESC
        LIMIT $8
      `,
      [
        input.at,
        input.source ?? null,
        input.state ?? null,
        input.query,
        input.cursor ? new Date(input.cursor.sortAt) : null,
        input.cursor?.source ?? null,
        input.cursor?.id ?? null,
        input.limit + 1,
      ],
    );
    const visible = result.rows.slice(0, input.limit);
    const items = visible.map(
      (row): AdminAccessListItem => ({
        id: row.id,
        customerId: row.customer_id,
        customerDisplayName: row.display_name,
        source: row.source,
        state: row.state,
        periodStart: row.period_start.toISOString(),
        periodEnd: row.period_end.toISOString(),
        planId: row.plan_id ?? undefined,
        grantReason: row.grant_reason ?? undefined,
        grantedAt: row.granted_at?.toISOString(),
        revokedAt: row.revoked_at?.toISOString(),
        revokeReason: row.revoke_reason ?? undefined,
        overlapsAnotherManualGrant: row.overlaps_another,
        accessRemainsAfterRevoke: row.access_remains_after_revoke,
        canRevoke:
          input.canRevokeManualAccess &&
          row.source === "manual" &&
          row.state !== "revoked",
      }),
    );
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > input.limit && last
          ? encodeAdminAccessCursor({
              sortAt: last.period_start.toISOString(),
              source: last.source,
              id: last.id,
            })
          : undefined,
    };
  }
}
