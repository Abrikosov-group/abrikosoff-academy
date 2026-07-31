import "server-only";

import type { Pool } from "pg";
import type { EffectiveAccessRepository } from "../application/effective-access-repository";
import type { EffectiveAccessBasis } from "../domain/effective-access";

type ActiveBasisRow = {
  id: string;
  source: "paid" | "manual";
  plan_id: "monthly" | "annual" | null;
  period_start: Date;
  period_end: Date;
};

export class PostgresEffectiveAccessRepository
  implements EffectiveAccessRepository
{
  constructor(private readonly pool: Pool) {}

  async listActiveBases(userId: string, at: Date) {
    const result = await this.pool.query<ActiveBasisRow>(
      `
        SELECT
          grants.order_id AS id,
          'paid'::text AS source,
          grants.plan_id,
          grants.period_start,
          grants.period_end
        FROM billing_access_grants grants
        WHERE grants.customer_id = $1
          AND grants.status = 'granted'
          AND grants.granted_at <= $2
          AND grants.created_at <= $2
          AND grants.period_start <= $2
          AND grants.period_end > $2

        UNION ALL

        SELECT
          grants.id,
          'manual'::text AS source,
          NULL::text AS plan_id,
          grants.period_start,
          grants.period_end
        FROM access_manual_grants grants
        WHERE grants.customer_id = $1
          AND grants.status = 'granted'
          AND grants.granted_at <= $2
          AND grants.created_at <= $2
          AND grants.period_start <= $2
          AND grants.period_end > $2

        ORDER BY period_end, period_start, source, id
      `,
      [userId, at],
    );

    return result.rows.map((row): EffectiveAccessBasis => {
      const common = {
        id: row.id,
        periodStart: row.period_start.toISOString(),
        periodEnd: row.period_end.toISOString(),
      };

      if (row.source === "paid") {
        if (!row.plan_id) {
          throw new Error(
            "Оплаченное основание доступа не содержит тариф.",
          );
        }

        return {
          ...common,
          source: "paid",
          planId: row.plan_id,
        };
      }

      return {
        ...common,
        source: "manual",
      };
    });
  }

  async hasManualGrantHistory() {
    const result = await this.pool.query<{ present: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM access_manual_grants
        ) AS present
      `,
    );

    return result.rows[0]?.present ?? false;
  }
}
