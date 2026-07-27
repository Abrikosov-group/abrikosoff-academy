import { afterEach, describe, expect, it, vi } from "vitest";
import { getBillingConfig } from "@/modules/billing/server/billing-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBillingConfig", () => {
  it("требует отдельный demo-secret в production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_MODE", "demo");
    vi.stubEnv("PAYMENT_DEFAULT_PROVIDER", "demo");
    vi.stubEnv("DEMO_WEBHOOK_SECRET", "");

    expect(() => getBillingConfig()).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_NOT_CONFIGURED",
        httpStatus: 503,
      }),
    );
  });

  it("принимает явно заданный production demo-secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_MODE", "demo");
    vi.stubEnv("PAYMENT_DEFAULT_PROVIDER", "demo");
    vi.stubEnv("DEMO_WEBHOOK_SECRET", "production-demo-secret-2026");

    expect(getBillingConfig().demoWebhookSecret).toBe(
      "production-demo-secret-2026",
    );
  });
});
