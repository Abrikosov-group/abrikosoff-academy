import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { inspectEffectiveAccessShadowReadiness } from "../../scripts/lib/effective-access-shadow-readiness.mjs";

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

    try {
      await client.query(`
        CREATE TEMP TABLE identity_users (
          id uuid PRIMARY KEY
        );
        CREATE TEMP TABLE billing_subscriptions (
          customer_id uuid NOT NULL,
          status text NOT NULL,
          current_period_end timestamptz,
          created_at timestamptz NOT NULL
        );
        CREATE TEMP TABLE billing_access_grants (
          customer_id uuid NOT NULL,
          status text NOT NULL,
          revoked_at timestamptz,
          granted_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL,
          period_start timestamptz NOT NULL,
          period_end timestamptz NOT NULL
        );
        CREATE TEMP TABLE access_manual_grants (
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
          VALUES ($1), ($2), ($3), ($4)
        `,
        [
          noAccessUserId,
          matchingUserId,
          legacyOnlyUserId,
          v2OnlyUserId,
        ],
      );
      await client.query(
        `
          INSERT INTO billing_subscriptions (
            customer_id,
            status,
            current_period_end,
            created_at
          )
          VALUES
            ($1, 'active', '2100-01-01T00:00:00.000Z', now()),
            ($2, 'grace_period', '2100-01-01T00:00:00.000Z', now())
        `,
        [matchingUserId, legacyOnlyUserId],
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
            )
        `,
        [matchingUserId, v2OnlyUserId],
      );

      await expect(
        inspectEffectiveAccessShadowReadiness(client, {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        observation: {
          observedUserCount: 4,
          legacyCanReadCount: 2,
          v2CanReadCount: 2,
          mismatchCount: 2,
          legacyOnlyCount: 1,
          v2OnlyCount: 1,
          manualGrantHistoryPresent: false,
        },
        blockers: [
          "EFFECTIVE_ACCESS_LEGACY_ONLY",
          "EFFECTIVE_ACCESS_V2_ONLY",
        ],
      });

      const rowsAfterCheck = await client.query<{ count: string }>(
        "SELECT count(*) FROM identity_users",
      );

      expect(rowsAfterCheck.rows[0]?.count).toBe("4");

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
          manualGrantHistoryPresent: false,
        },
        blockers: [],
      });
    } finally {
      client.release();
    }
  });
});
