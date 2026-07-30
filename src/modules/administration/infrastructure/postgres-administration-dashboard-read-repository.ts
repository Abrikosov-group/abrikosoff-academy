import "server-only";

import type { Pool } from "pg";
import type { AdministrationDashboardReadRepository } from "../application/administration-dashboard-read-repository";
import type { AdminDashboardMetrics } from "../domain/dashboard-read-model";

type DashboardMetricsRow = {
  generated_at: Date;
  last_7_days_from: string;
  last_30_days_from: string;
  through_date: string;
  active_students: number | null;
  new_students_last_7_days: number | null;
  new_students_last_30_days: number | null;
  active_paid_access_students: number | null;
  stale_pending_payments: number | null;
  failed_webhook_events: number | null;
};

export class PostgresAdministrationDashboardReadRepository
  implements AdministrationDashboardReadRepository
{
  constructor(private readonly pool: Pool) {}

  async getDashboardMetrics(
    input: Parameters<
      AdministrationDashboardReadRepository["getDashboardMetrics"]
    >[0],
  ): Promise<AdminDashboardMetrics> {
    const result = await this.pool.query<DashboardMetricsRow>(
      `
        WITH local_clock AS (
          SELECT
            $1::timestamptz AS generated_at,
            ($1::timestamptz AT TIME ZONE $2::text)::date
              AS local_today
        ),
        boundaries AS (
          SELECT
            generated_at,
            local_today,
            local_today - 6 AS last_7_days_from,
            local_today - 29 AS last_30_days_from,
            (local_today - 6) AT TIME ZONE $2::text
              AS last_7_days_started_at,
            (local_today - 29) AT TIME ZONE $2::text
              AS last_30_days_started_at
          FROM local_clock
        ),
        student_metrics AS (
          SELECT
            count(*) FILTER (
              WHERE users.status = 'active'
                AND users.created_at <= boundaries.generated_at
            )::integer AS active_students,
            count(*) FILTER (
              WHERE users.status <> 'deleted'
                AND users.created_at >=
                  boundaries.last_7_days_started_at
                AND users.created_at <= boundaries.generated_at
            )::integer AS new_students_last_7_days,
            count(*) FILTER (
              WHERE users.status <> 'deleted'
                AND users.created_at >=
                  boundaries.last_30_days_started_at
                AND users.created_at <= boundaries.generated_at
            )::integer AS new_students_last_30_days
          FROM identity_users users
          CROSS JOIN boundaries
          WHERE $3::boolean
        ),
        access_metrics AS (
          SELECT
            count(DISTINCT grants.customer_id)::integer
              AS active_paid_access_students
          FROM billing_access_grants grants
          CROSS JOIN boundaries
          WHERE $4::boolean
            AND grants.status = 'granted'
            AND grants.created_at <= boundaries.generated_at
            AND grants.period_start <= boundaries.generated_at
            AND grants.period_end > boundaries.generated_at
        ),
        billing_metrics AS (
          SELECT
            (
              SELECT count(*)::integer
              FROM billing_payments payments
              WHERE payments.status IN (
                'created',
                'pending',
                'requires_action'
              )
                AND payments.updated_at <=
                  boundaries.generated_at - interval '15 minutes'
            ) AS stale_pending_payments,
            (
              SELECT count(*)::integer
              FROM billing_webhook_events webhook_events
              WHERE webhook_events.processing_status = 'failed'
                AND webhook_events.received_at <=
                  boundaries.generated_at
            ) AS failed_webhook_events
          FROM boundaries
          WHERE $5::boolean
        )
        SELECT
          boundaries.generated_at,
          boundaries.last_7_days_from::text,
          boundaries.last_30_days_from::text,
          boundaries.local_today::text AS through_date,
          CASE
            WHEN $3::boolean THEN student_metrics.active_students
            ELSE NULL
          END AS active_students,
          CASE
            WHEN $3::boolean
              THEN student_metrics.new_students_last_7_days
            ELSE NULL
          END AS new_students_last_7_days,
          CASE
            WHEN $3::boolean
              THEN student_metrics.new_students_last_30_days
            ELSE NULL
          END AS new_students_last_30_days,
          CASE
            WHEN $4::boolean
              THEN access_metrics.active_paid_access_students
            ELSE NULL
          END AS active_paid_access_students,
          CASE
            WHEN $5::boolean
              THEN billing_metrics.stale_pending_payments
            ELSE NULL
          END AS stale_pending_payments,
          CASE
            WHEN $5::boolean
              THEN billing_metrics.failed_webhook_events
            ELSE NULL
          END AS failed_webhook_events
        FROM boundaries
        CROSS JOIN student_metrics
        CROSS JOIN access_metrics
        LEFT JOIN billing_metrics ON true
      `,
      [
        input.at,
        input.displayTimeZone,
        input.scope.students,
        input.scope.paidAccess,
        input.scope.billing,
      ],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error(
        "PostgreSQL не вернул снимок административного дашборда.",
      );
    }

    return {
      generatedAt: row.generated_at.toISOString(),
      displayTimeZone: input.displayTimeZone,
      periods: {
        last7DaysFrom: row.last_7_days_from,
        last30DaysFrom: row.last_30_days_from,
        through: row.through_date,
      },
      ...(row.active_students === null
        ? {}
        : {
            students: {
              activeStudents: row.active_students,
              newStudentsLast7Days:
                row.new_students_last_7_days ?? 0,
              newStudentsLast30Days:
                row.new_students_last_30_days ?? 0,
            },
          }),
      ...(row.active_paid_access_students === null
        ? {}
        : {
            access: {
              activePaidAccessStudents:
                row.active_paid_access_students,
            },
          }),
      ...(row.stale_pending_payments === null
        ? {}
        : {
            billing: {
              stalePendingPayments:
                row.stale_pending_payments,
              failedWebhookEvents:
                row.failed_webhook_events ?? 0,
            },
          }),
    };
  }
}
