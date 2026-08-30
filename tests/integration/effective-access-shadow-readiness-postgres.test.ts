import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { inspectEffectiveAccessShadowReadiness } from "../../scripts/lib/effective-access-shadow-readiness.mjs";
import { EffectiveAccessService } from "../../src/modules/access/application/effective-access-service";
import { PostgresEffectiveAccessRepository } from "../../src/modules/access/infrastructure/postgres-effective-access-repository";
import { hasCurrentSubscriptionAccess } from "../../src/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "../../src/modules/billing/infrastructure/postgres-payment-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

describe("shadow-проверка effective access с PostgreSQL", () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    application_name: "academy-shadow-readiness-integration-tests",
    max: 1,
  });

  afterAll(async () => {
    await pool.end();
  });

  it("считает оба вида несовпадений без изменения данных", async () => {
    const client = await pool.connect();
    const noAccessUserId = randomUUID();
    const matchingUserId = randomUUID();
    const legacyOnlyUserId = randomUUID();
    const v2OnlyUserId = randomUUID();
    const boundaryMismatchUserId = randomUUID();
    const nullPeriodEndUserId = randomUUID();

    try {
      await client.query(`
        CREATE TEMP TABLE identity_users (
          id uuid PRIMARY KEY
        );
        CREATE TEMP TABLE billing_subscriptions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id uuid NOT NULL,
          plan_id text NOT NULL DEFAULT 'monthly',
          status text NOT NULL,
          current_period_start timestamptz,
          current_period_end timestamptz,
          auto_renew boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL
        );
        CREATE TEMP TABLE billing_access_grants (
          order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id uuid NOT NULL,
          plan_id text NOT NULL DEFAULT 'monthly',
          status text NOT NULL,
          revoked_at timestamptz,
          granted_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL,
          period_start timestamptz NOT NULL,
          period_end timestamptz NOT NULL
        );
        CREATE TEMP TABLE access_manual_grants (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id uuid NOT NULL,
          status text NOT NULL,
          revoked_at timestamptz,
          granted_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL,
          period_start timestamptz NOT NULL,
          period_end timestamptz NOT NULL
        );
      `);
      await client.query(
        `
          INSERT INTO identity_users (id)
          VALUES ($1), ($2), ($3), ($4), ($5), ($6)
        `,
        [
          noAccessUserId,
          matchingUserId,
          legacyOnlyUserId,
          v2OnlyUserId,
          boundaryMismatchUserId,
          nullPeriodEndUserId,
        ],
      );
      await client.query(
        `
          INSERT INTO billing_subscriptions (
            customer_id,
            status,
            current_period_start,
            current_period_end,
            created_at
          )
          VALUES
            (
              $1,
              'active',
              '2020-01-01T00:00:00.000658Z',
              '2100-01-01T00:00:00.000658Z',
              now()
            ),
            (
              $2,
              'grace_period',
              '2020-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z',
              now()
            ),
            (
              $3,
              'active',
              '2020-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z',
              now()
            ),
            (
              $4,
              'active',
              '2020-01-01T00:00:00.000Z',
              NULL,
              now()
            )
        `,
        [
          matchingUserId,
          legacyOnlyUserId,
          boundaryMismatchUserId,
          nullPeriodEndUserId,
        ],
      );
      await client.query(
        `
          INSERT INTO billing_access_grants (
            customer_id,
            status,
            granted_at,
            created_at,
            period_start,
            period_end
          )
          VALUES
            (
              $1,
              'granted',
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z'
            ),
            (
              $2,
              'granted',
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z'
            ),
            (
              $3,
              'granted',
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z',
              '2099-01-01T00:00:00.000Z'
            )
        `,
        [matchingUserId, v2OnlyUserId, boundaryMismatchUserId],
      );

      const report = await inspectEffectiveAccessShadowReadiness(
        client,
        {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        },
      );

      expect(report).toMatchObject({
        status: "blocked",
        observation: {
          observedUserCount: 6,
          legacyCanReadCount: 3,
          v2CanReadCount: 3,
          mismatchCount: 3,
          legacyOnlyCount: 1,
          v2OnlyCount: 1,
          periodBoundaryMismatchCount: 1,
          futureV2ActivationCount: 0,
          ambiguousLatestSubscriptionCount: 0,
          manualGrantHistoryPresent: false,
        },
        blockers: [
          "EFFECTIVE_ACCESS_LEGACY_ONLY",
          "EFFECTIVE_ACCESS_V2_ONLY",
          "EFFECTIVE_ACCESS_PERIOD_BOUNDARY_MISMATCH",
        ],
      });

      const evaluatedAt = new Date(report.evaluatedAt);
      const service = new EffectiveAccessService(
        new PostgresEffectiveAccessRepository(client),
      );
      const actualDecisions: Array<{
        legacyCanRead: boolean;
        v2CanRead: boolean;
      }> = [];

      for (const userId of [
        noAccessUserId,
        matchingUserId,
        legacyOnlyUserId,
        v2OnlyUserId,
        boundaryMismatchUserId,
        nullPeriodEndUserId,
      ]) {
        const subscription = await getSubscriptionSummary(client, userId);
        const effectiveAccess = await service.getEffectiveAccess(
          userId,
          evaluatedAt,
        );

        actualDecisions.push({
          legacyCanRead: hasCurrentSubscriptionAccess(
            subscription,
            evaluatedAt,
          ),
          v2CanRead: effectiveAccess.canReadCourses,
        });
      }

      expect(
        actualDecisions.filter((decision) => decision.legacyCanRead),
      ).toHaveLength(report.observation.legacyCanReadCount);
      expect(
        actualDecisions.filter((decision) => decision.v2CanRead),
      ).toHaveLength(report.observation.v2CanReadCount);
      expect(
        actualDecisions.filter(
          (decision) => decision.legacyCanRead && !decision.v2CanRead,
        ),
      ).toHaveLength(report.observation.legacyOnlyCount);
      expect(
        actualDecisions.filter(
          (decision) => decision.v2CanRead && !decision.legacyCanRead,
        ),
      ).toHaveLength(report.observation.v2OnlyCount);

      const nullPeriodEndSubscription =
        await getSubscriptionSummary(client, nullPeriodEndUserId);
      expect(nullPeriodEndSubscription?.currentPeriodEnd).toBeUndefined();
      expect(
        hasCurrentSubscriptionAccess(
          nullPeriodEndSubscription,
          evaluatedAt,
        ),
      ).toBe(false);

      const rowsAfterCheck = await client.query<{ count: string }>(
        "SELECT count(*) FROM identity_users",
      );

      expect(rowsAfterCheck.rows[0]?.count).toBe("6");

      await client.query(`
        TRUNCATE
          identity_users,
          billing_subscriptions,
          billing_access_grants,
          access_manual_grants
      `);

      await expect(
        inspectEffectiveAccessShadowReadiness(client, {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        }),
      ).resolves.toMatchObject({
        status: "ready",
        observation: {
          observedUserCount: 0,
          mismatchCount: 0,
          periodBoundaryMismatchCount: 0,
          futureV2ActivationCount: 0,
          ambiguousLatestSubscriptionCount: 0,
          manualGrantHistoryPresent: false,
        },
        blockers: [],
      });

      const futureUserId = randomUUID();
      const ambiguousSubscriptionUserId = randomUUID();

      await client.query(
        `
          INSERT INTO identity_users (id)
          VALUES ($1), ($2)
        `,
        [futureUserId, ambiguousSubscriptionUserId],
      );
      await client.query(
        `
          INSERT INTO billing_subscriptions (
            id,
            customer_id,
            status,
            current_period_start,
            current_period_end,
            created_at
          )
          VALUES
            (
              '00000000-0000-0000-0000-000000000001',
              $1,
              'active',
              '2020-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z'
            ),
            (
              '00000000-0000-0000-0000-000000000002',
              $1,
              'canceled',
              '2020-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z'
            ),
            (
              gen_random_uuid(),
              $2,
              'pending',
              '2090-01-01T00:00:00.000Z',
              '2100-01-01T00:00:00.000Z',
              '2020-01-01T00:00:00.000Z'
            )
        `,
        [ambiguousSubscriptionUserId, futureUserId],
      );
      await client.query(
        `
          INSERT INTO billing_access_grants (
            customer_id,
            status,
            granted_at,
            created_at,
            period_start,
            period_end
          )
          VALUES (
            $1,
            'granted',
            '2020-01-01T00:00:00.000Z',
            '2020-01-01T00:00:00.000Z',
            '2090-01-01T00:00:00.000Z',
            '2100-01-01T00:00:00.000Z'
          )
        `,
        [futureUserId],
      );

      await expect(
        inspectEffectiveAccessShadowReadiness(client, {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        observation: {
          observedUserCount: 2,
          mismatchCount: 1,
          futureV2ActivationCount: 1,
          ambiguousLatestSubscriptionCount: 1,
          manualGrantHistoryPresent: false,
        },
        blockers: [
          "EFFECTIVE_ACCESS_FUTURE_ACTIVATION",
          "LEGACY_SUBSCRIPTION_ORDER_AMBIGUOUS",
        ],
      });
    } finally {
      client.release();
    }
  });
});
