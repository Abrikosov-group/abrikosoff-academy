import "server-only";

import type { PoolClient } from "pg";
import type {
  LockedManualAccessGrant,
  ManualAccessAdministrationRepository,
} from "../application/manual-access-administration-repository";

type ManualGrantRow = {
  id: string;
  customer_id: string;
  status: "granted" | "revoked";
  period_start: Date;
  period_end: Date;
  granted_at: Date;
  revoked_at: Date | null;
};

export class PostgresManualAccessAdministrationRepository
  implements ManualAccessAdministrationRepository
{
  async countOverlaps(
    client: PoolClient,
    input: {
      customerId: string;
      periodStart: Date;
      periodEnd: Date;
    },
  ) {
    const result = await client.query<{ count: number }>(
      `
        SELECT count(*)::integer AS count
        FROM access_manual_grants
        WHERE customer_id = $1
          AND status = 'granted'
          AND period_start < $3
          AND period_end > $2
      `,
      [input.customerId, input.periodStart, input.periodEnd],
    );

    return result.rows[0]?.count ?? 0;
  }

  async insertGrant(
    client: PoolClient,
    input: {
      id: string;
      customerId: string;
      periodStart: Date;
      periodEnd: Date;
      reason: string;
      actorUserId: string;
      grantedAt: Date;
      commandExecutionId: string;
    },
  ) {
    await client.query(
      `
        INSERT INTO access_manual_grants (
          id,
          customer_id,
          status,
          period_start,
          period_end,
          grant_reason,
          granted_by_user_id,
          granted_at,
          command_execution_id,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          'granted',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $7,
          $7
        )
      `,
      [
        input.id,
        input.customerId,
        input.periodStart,
        input.periodEnd,
        input.reason,
        input.actorUserId,
        input.grantedAt,
        input.commandExecutionId,
      ],
    );
  }

  async lockGrant(
    client: PoolClient,
    grantId: string,
  ): Promise<LockedManualAccessGrant | null> {
    const result = await client.query<ManualGrantRow>(
      `
        SELECT
          id,
          customer_id,
          status,
          period_start,
          period_end,
          granted_at,
          revoked_at
        FROM access_manual_grants
        WHERE id = $1
        FOR UPDATE
      `,
      [grantId],
    );
    const row = result.rows[0];

    return row
      ? {
          id: row.id,
          customerId: row.customer_id,
          status: row.status,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          grantedAt: row.granted_at,
          revokedAt: row.revoked_at ?? undefined,
        }
      : null;
  }

  async revokeGrant(
    client: PoolClient,
    input: {
      grantId: string;
      actorUserId: string;
      reason: string;
      revokedAt: Date;
    },
  ) {
    const result = await client.query<{ id: string }>(
      `
        UPDATE access_manual_grants
        SET
          status = 'revoked',
          revoked_by_user_id = $2,
          revoke_reason = $3,
          revoked_at = $4,
          updated_at = $4
        WHERE id = $1
          AND status = 'granted'
        RETURNING id
      `,
      [
        input.grantId,
        input.actorUserId,
        input.reason,
        input.revokedAt,
      ],
    );

    if (!result.rows[0]) {
      throw new TypeError(
        "Ручной грант изменился без удержания блокировки.",
      );
    }
  }
}
