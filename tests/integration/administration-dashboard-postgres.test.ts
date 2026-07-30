import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { AdministrationDashboardReadService } from "@/modules/administration/application/administration-dashboard-read-service";
import { configuredPermissionsForRole } from "@/modules/administration/domain/permissions";
import type { AdminPermission } from "@/modules/administration/domain/types";
import { PostgresAdministrationDashboardReadRepository } from "@/modules/administration/infrastructure/postgres-administration-dashboard-read-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const at = new Date("2040-08-30T12:00:00.000Z");
const displayTimeZone = "Europe/Moscow";

describe("read-only дашборд Administration с PostgreSQL", () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    application_name: "academy-admin-dashboard-integration-tests",
    max: 4,
  });
  const service = new AdministrationDashboardReadService(
    new PostgresAdministrationDashboardReadRepository(pool),
  );

  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("считает один снимок по точным состояниям и границам времени", async () => {
    const userIds: string[] = [];
    const orderIds: string[] = [];
    const webhookIds: string[] = [];
    const ownerPermissions = configuredPermissionsForRole("owner");
    const baseline = await service.getDashboardMetrics({
      at,
      displayTimeZone,
      permissions: ownerPermissions,
    });

    async function insertUser(
      status: "active" | "blocked" | "deleted",
      createdAt: string,
    ) {
      const userId = randomUUID();
      userIds.push(userId);
      await pool.query(
        `
          INSERT INTO identity_users (
            id,
            display_name,
            status,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $4)
        `,
        [
          userId,
          `Дашборд ${userId}`,
          status,
          createdAt,
        ],
      );
      return userId;
    }

    async function insertOrder(
      userId: string,
      status: "pending" | "paid" = "pending",
    ) {
      const orderId = randomUUID();
      orderIds.push(orderId);
      await pool.query(
        `
          INSERT INTO billing_orders (
            id,
            customer_id,
            plan_id,
            legal_entity_id,
            country_code,
            amount_minor,
            currency,
            status,
            idempotency_key,
            selected_provider,
            merchant_account_id,
            offer_accepted_at,
            offer_version,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            'monthly',
            'ip-fedotova',
            'RU',
            150000,
            'RUB',
            $3,
            $4,
            'demo',
            'dashboard-integration',
            $5,
            'dashboard-integration',
            $5,
            $5
          )
        `,
        [
          orderId,
          userId,
          status,
          randomUUID(),
          at.toISOString(),
        ],
      );
      return orderId;
    }

    async function insertGrant(input: {
      createdAt?: string;
      userId: string;
      status?: "granted" | "revoked";
      periodStart: string;
      periodEnd: string;
    }) {
      const orderId = await insertOrder(input.userId, "paid");
      const status = input.status ?? "granted";
      const createdAt = input.createdAt ?? at.toISOString();
      await pool.query(
        `
          INSERT INTO billing_access_grants (
            order_id,
            customer_id,
            plan_id,
            status,
            period_start,
            period_end,
            granted_at,
            revoked_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            'monthly',
            $3::text,
            $4::timestamptz,
            $5::timestamptz,
            $6::timestamptz,
            CASE
              WHEN $3::text = 'revoked'
                THEN $6::timestamptz
              ELSE NULL
            END,
            $6::timestamptz,
            $6::timestamptz
          )
        `,
        [
          orderId,
          input.userId,
          status,
          input.periodStart,
          input.periodEnd,
          createdAt,
        ],
      );
    }

    async function insertPayment(
      userId: string,
      status:
        | "created"
        | "pending"
        | "requires_action"
        | "succeeded"
        | "failed",
      updatedAt: string,
    ) {
      const orderId = await insertOrder(userId);
      await pool.query(
        `
          INSERT INTO billing_payments (
            id,
            order_id,
            provider,
            merchant_account_id,
            external_payment_id,
            provider_operation_key,
            status,
            amount_minor,
            currency,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            'demo',
            'dashboard-integration',
            $3,
            $4,
            $5,
            150000,
            'RUB',
            $6,
            $6
          )
        `,
        [
          randomUUID(),
          orderId,
          randomUUID(),
          randomUUID(),
          status,
          updatedAt,
        ],
      );
    }

    async function insertWebhookEvent(
      processingStatus: "failed" | "applied",
      receivedAt = at.toISOString(),
    ) {
      const webhookId = randomUUID();
      webhookIds.push(webhookId);
      await pool.query(
        `
          INSERT INTO billing_webhook_events (
            id,
            provider,
            merchant_account_id,
            external_event_id,
            event_type,
            payload_sha256,
            payload,
            processing_status,
            received_at,
            processed_at
          )
          VALUES (
            $1,
            'demo',
            'dashboard-integration',
            $2,
            'payment.updated',
            $3,
            '{}'::jsonb,
            $4::text,
            $5::timestamptz,
            CASE
              WHEN $4::text = 'applied'
                THEN $5::timestamptz
              ELSE NULL
            END
          )
        `,
        [
          webhookId,
          randomUUID(),
          "a".repeat(64),
          processingStatus,
          receivedAt,
        ],
      );
    }

    try {
      const activeRecent = await insertUser(
        "active",
        "2040-08-30T08:00:00.000Z",
      );
      const blockedThisMonth = await insertUser(
        "blocked",
        "2040-08-10T08:00:00.000Z",
      );
      await insertUser(
        "deleted",
        "2040-08-29T08:00:00.000Z",
      );
      const activeOld = await insertUser(
        "active",
        "2040-06-01T08:00:00.000Z",
      );
      await insertUser(
        "active",
        "2040-08-30T12:00:01.000Z",
      );

      await insertGrant({
        userId: activeRecent,
        periodStart: "2040-08-01T00:00:00.000Z",
        periodEnd: "2040-09-01T00:00:00.000Z",
      });
      await insertGrant({
        userId: activeRecent,
        periodStart: "2040-08-15T00:00:00.000Z",
        periodEnd: "2040-10-01T00:00:00.000Z",
      });
      await insertGrant({
        userId: activeOld,
        periodStart: "2040-08-31T00:00:00.000Z",
        periodEnd: "2040-10-01T00:00:00.000Z",
      });
      await insertGrant({
        userId: blockedThisMonth,
        periodStart: "2040-07-01T00:00:00.000Z",
        periodEnd: at.toISOString(),
      });
      await insertGrant({
        userId: activeOld,
        status: "revoked",
        periodStart: "2040-08-01T00:00:00.000Z",
        periodEnd: "2040-09-01T00:00:00.000Z",
      });
      await insertGrant({
        createdAt: "2040-08-30T12:00:01.000Z",
        userId: activeOld,
        periodStart: "2040-08-01T00:00:00.000Z",
        periodEnd: "2040-09-01T00:00:00.000Z",
      });

      await insertPayment(
        activeRecent,
        "pending",
        "2040-08-30T11:44:59.000Z",
      );
      await insertPayment(
        activeRecent,
        "requires_action",
        "2040-08-30T11:45:00.000Z",
      );
      await insertPayment(
        activeRecent,
        "created",
        "2040-08-30T11:45:01.000Z",
      );
      await insertPayment(
        activeRecent,
        "succeeded",
        "2040-08-30T10:00:00.000Z",
      );
      await insertPayment(
        activeRecent,
        "failed",
        "2040-08-30T10:00:00.000Z",
      );

      await insertWebhookEvent("failed");
      await insertWebhookEvent("applied");
      await insertWebhookEvent(
        "failed",
        "2040-08-30T12:00:01.000Z",
      );

      const result = await service.getDashboardMetrics({
        at,
        displayTimeZone,
        permissions: ownerPermissions,
      });

      expect(result).toEqual({
        generatedAt: at.toISOString(),
        displayTimeZone,
        periods: {
          last7DaysFrom: "2040-08-24",
          last30DaysFrom: "2040-08-01",
          through: "2040-08-30",
        },
        students: {
          activeStudents:
            (baseline.students?.activeStudents ?? 0) + 2,
          newStudentsLast7Days:
            (baseline.students?.newStudentsLast7Days ?? 0) + 1,
          newStudentsLast30Days:
            (baseline.students?.newStudentsLast30Days ?? 0) + 2,
        },
        access: {
          activePaidAccessStudents:
            (baseline.access?.activePaidAccessStudents ?? 0) + 1,
        },
        billing: {
          stalePendingPayments:
            (baseline.billing?.stalePendingPayments ?? 0) + 2,
          failedWebhookEvents:
            (baseline.billing?.failedWebhookEvents ?? 0) + 1,
        },
      });
    } finally {
      await pool.query(
        "DELETE FROM billing_webhook_events WHERE id = ANY($1::uuid[])",
        [webhookIds],
      );
      await pool.query(
        "DELETE FROM billing_payments WHERE order_id = ANY($1::uuid[])",
        [orderIds],
      );
      await pool.query(
        "DELETE FROM billing_access_grants WHERE order_id = ANY($1::uuid[])",
        [orderIds],
      );
      await pool.query(
        "DELETE FROM billing_orders WHERE id = ANY($1::uuid[])",
        [orderIds],
      );
      await pool.query(
        "DELETE FROM identity_users WHERE id = ANY($1::uuid[])",
        [userIds],
      );
    }
  });

  it("не сериализует предметные группы без их разрешений", async () => {
    await expect(
      service.getDashboardMetrics({
        at,
        displayTimeZone,
        permissions: new Set<AdminPermission>([
          "dashboard.read",
        ]),
      }),
    ).resolves.toEqual({
      generatedAt: at.toISOString(),
      displayTimeZone,
      periods: {
        last7DaysFrom: "2040-08-24",
        last30DaysFrom: "2040-08-01",
        through: "2040-08-30",
      },
    });
  });
});
