import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { purgeIdentitySessionTechnicalData } from "../../scripts/lib/identity-session-retention.mjs";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

describe("срок хранения технического контекста сессий", () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    application_name: "academy-session-retention-integration-tests",
    max: 2,
  });
  const userId = randomUUID();
  const oldSessionId = randomUUID();
  const recentSessionId = randomUUID();

  beforeAll(async () => {
    await pool.query("SELECT 1");
    await pool.query(
      `
        INSERT INTO identity_users (
          id,
          display_name,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          'Проверка срока хранения',
          'active',
          '2025-01-01T00:00:00.000Z',
          '2025-01-01T00:00:00.000Z'
        )
      `,
      [userId],
    );
    await pool.query(
      `
        INSERT INTO identity_sessions (
          id,
          user_id,
          token_sha256,
          expires_at,
          created_at,
          last_seen_at,
          user_agent_family,
          client_ip,
          country_code,
          region,
          city,
          browser_version,
          operating_system,
          device_type,
          raw_user_agent,
          cloudflare_ray_id
        )
        VALUES
          (
            $1,
            $3,
            repeat('a', 64),
            '2025-08-01T00:00:00.000Z',
            '2025-07-29T23:59:59.000Z',
            '2025-07-30T00:00:00.000Z',
            'Google Chrome',
            '203.0.113.42',
            'RU',
            'Москва',
            'Москва',
            '138.0.0.0',
            'macOS',
            'desktop',
            'Retention integration user agent',
            '0123456789abcdef-DME'
          ),
          (
            $2,
            $3,
            repeat('b', 64),
            '2026-08-01T00:00:00.000Z',
            '2025-07-30T00:00:00.000Z',
            '2025-07-30T00:00:00.000Z',
            'Safari',
            '2001:db8::42',
            'RU',
            'Москва',
            'Москва',
            '18.5',
            'macOS',
            'desktop',
            'Recent integration user agent',
            'fedcba9876543210-DME'
          )
      `,
      [oldSessionId, recentSessionId, userId],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("обезличивает только технические поля старше 12 месяцев и сохраняет сессию", async () => {
    const now = new Date("2026-07-30T00:00:00.000Z");

    await expect(
      purgeIdentitySessionTechnicalData(pool, { now }),
    ).resolves.toBe(1);

    const result = await pool.query<{
      id: string;
      token_sha256: string;
      created_at: Date;
      last_seen_at: Date;
      user_agent_family: string | null;
      client_ip: string | null;
      country_code: string | null;
      raw_user_agent: string | null;
      cloudflare_ray_id: string | null;
    }>(
      `
        SELECT
          id,
          token_sha256,
          created_at,
          last_seen_at,
          user_agent_family,
          host(client_ip) AS client_ip,
          country_code,
          raw_user_agent,
          cloudflare_ray_id
        FROM identity_sessions
        WHERE id = ANY($1::uuid[])
        ORDER BY created_at
      `,
      [[oldSessionId, recentSessionId]],
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: oldSessionId,
        token_sha256: "a".repeat(64),
        created_at: new Date("2025-07-29T23:59:59.000Z"),
        last_seen_at: new Date("2025-07-30T00:00:00.000Z"),
        user_agent_family: null,
        client_ip: null,
        country_code: null,
        raw_user_agent: null,
        cloudflare_ray_id: null,
      }),
      expect.objectContaining({
        id: recentSessionId,
        token_sha256: "b".repeat(64),
        user_agent_family: "Safari",
        client_ip: "2001:db8::42",
        country_code: "RU",
        raw_user_agent: "Recent integration user agent",
        cloudflare_ray_id: "fedcba9876543210-DME",
      }),
    ]);

    await expect(
      purgeIdentitySessionTechnicalData(pool, { now }),
    ).resolves.toBe(0);
  });
});
