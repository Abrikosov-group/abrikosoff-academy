import { afterEach, describe, expect, it, vi } from "vitest";
import { requireBillingRequestOrigin } from "@/modules/billing/server/request-origin";

describe("requireBillingRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("отклоняет production-запрос без доверенного APP_BASE_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");
    const request = new Request(
      "https://academy.abrikosoff.com/api/subscriptions/renewal",
      {
        method: "POST",
        headers: { Origin: "https://academy.abrikosoff.com" },
      },
    );

    expect(() => requireBillingRequestOrigin(request)).toThrowError(
      expect.objectContaining({
        code: "INVALID_REQUEST_ORIGIN",
        httpStatus: 403,
      }),
    );
  });

  it("принимает настроенный production-origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://academy.abrikosoff.com");
    const request = new Request(
      "https://internal-app:3000/api/subscriptions/renewal",
      {
        method: "POST",
        headers: { Origin: "https://academy.abrikosoff.com" },
      },
    );

    expect(() => requireBillingRequestOrigin(request)).not.toThrow();
  });

  it("сохраняет локальную проверку по origin запроса", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "");
    const request = new Request(
      "http://127.0.0.1:3000/api/subscriptions/renewal",
      {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:3000" },
      },
    );

    expect(() => requireBillingRequestOrigin(request)).not.toThrow();
  });
});
