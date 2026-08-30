import { describe, expect, it, vi } from "vitest";
import {
  inspectEffectiveAccessShadowReadiness,
  readEffectiveAccessShadowConfiguration,
} from "../../scripts/lib/effective-access-shadow-readiness.mjs";

function createClient(row: Record<string, unknown>) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [] }),
  };
}

const configuration = {
  effectiveAccessMode: "shadow",
  manualAccessGrantingEnabled: false,
};

const readyRow = {
  evaluated_at: new Date("2026-08-30T12:00:00.000Z"),
  transaction_read_only: true,
  manual_grant_history_present: false,
  observed_user_count: "6",
  legacy_can_read_count: "2",
  v2_can_read_count: "2",
  legacy_only_count: "0",
  v2_only_count: "0",
  period_boundary_mismatch_count: "0",
};

describe("локальная готовность effective access v2", () => {
  it("принимает только безопасную shadow-конфигурацию", () => {
    expect(readEffectiveAccessShadowConfiguration({})).toEqual(
      configuration,
    );
    expect(() =>
      readEffectiveAccessShadowConfiguration({
        EFFECTIVE_ACCESS_MODE: "v2",
      }),
    ).toThrowError("только в режиме shadow");
    expect(() =>
      readEffectiveAccessShadowConfiguration({
        MANUAL_ACCESS_GRANTING_ENABLED: "true",
      }),
    ).toThrowError("должна быть выключена");
  });

  it("подтверждает совпадение legacy и v2 в одном read-only снимке", async () => {
    const client = createClient(readyRow);

    await expect(
      inspectEffectiveAccessShadowReadiness(
        client,
        configuration,
      ),
    ).resolves.toEqual({
      status: "ready",
      evaluatedAt: "2026-08-30T12:00:00.000Z",
      configuration,
      observation: {
        observedUserCount: 6,
        legacyCanReadCount: 2,
        v2CanReadCount: 2,
        mismatchCount: 0,
        legacyOnlyCount: 0,
        v2OnlyCount: 0,
        periodBoundaryMismatchCount: 0,
        manualGrantHistoryPresent: false,
      },
      blockers: [],
    });
    expect(client.query.mock.calls[0]?.[0]).toContain(
      "REPEATABLE READ READ ONLY",
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      "billing_access_grants",
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      "latest_subscriptions AS MATERIALIZED",
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      "active_access_bases AS MATERIALIZED",
    );
    expect(client.query.mock.calls[1]?.[0]).not.toContain(
      "LEFT JOIN LATERAL",
    );
    expect(client.query.mock.calls[2]?.[0]).toBe("COMMIT");
  });

  it("блокирует переключение при несовпадении или ручной истории", async () => {
    const client = createClient({
      ...readyRow,
      manual_grant_history_present: true,
      legacy_can_read_count: "3",
      v2_can_read_count: "2",
      legacy_only_count: "2",
      v2_only_count: "1",
      period_boundary_mismatch_count: "1",
    });

    await expect(
      inspectEffectiveAccessShadowReadiness(
        client,
        configuration,
      ),
    ).resolves.toMatchObject({
      status: "blocked",
      blockers: [
        "MANUAL_GRANT_HISTORY_PRESENT",
        "EFFECTIVE_ACCESS_LEGACY_ONLY",
        "EFFECTIVE_ACCESS_V2_ONLY",
        "EFFECTIVE_ACCESS_PERIOD_BOUNDARY_MISMATCH",
      ],
      observation: {
        mismatchCount: 4,
        periodBoundaryMismatchCount: 1,
        manualGrantHistoryPresent: true,
      },
    });
  });

  it("пытается откатить read-only снимок после ошибки запроса", async () => {
    const failure = new Error("database unavailable");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(
      inspectEffectiveAccessShadowReadiness(
        client,
        configuration,
      ),
    ).rejects.toBe(failure);
    expect(client.query.mock.calls[2]?.[0]).toBe("ROLLBACK");
  });
});
