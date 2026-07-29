import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAdministrationRequestOrigin } from "@/modules/administration/server/request-origin";

describe("requireAdministrationRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("принимает точный origin приложения", () => {
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy.abrikosoff.com",
    );
    const request = new Request(
      "https://academy.abrikosoff.com/api/admin/auth/telegram/start",
      {
        method: "POST",
        headers: {
          Origin: "https://academy.abrikosoff.com",
        },
      },
    );

    expect(() =>
      requireAdministrationRequestOrigin(request),
    ).not.toThrow();
  });

  it.each([
    undefined,
    "https://example.com",
    "https://academy.abrikosoff.com.evil.example",
  ])("отклоняет неподтверждённый origin: %s", (origin) => {
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy.abrikosoff.com",
    );
    const headers = origin ? { Origin: origin } : undefined;
    const request = new Request(
      "https://academy.abrikosoff.com/api/admin/auth/telegram/start",
      {
        method: "POST",
        headers,
      },
    );

    expect(() =>
      requireAdministrationRequestOrigin(request),
    ).toThrowError(
      expect.objectContaining({
        code: "ADMIN_PERMISSION_DENIED",
        httpStatus: 403,
      }),
    );
  });

  it.each([
    "не url",
    "https://user:password@academy.abrikosoff.com",
    "https://academy.abrikosoff.com/nested",
    "https://academy.abrikosoff.com/?source=test",
  ])(
    "отклоняет запрос при небезопасном APP_BASE_URL: %s",
    (appBaseUrl) => {
      vi.stubEnv("APP_BASE_URL", appBaseUrl);
      const request = new Request(
        "https://academy.abrikosoff.com/api/admin/auth/telegram/start",
        {
          method: "POST",
          headers: {
            Origin: "https://academy.abrikosoff.com",
          },
        },
      );

      expect(() =>
        requireAdministrationRequestOrigin(request),
      ).toThrowError(
        expect.objectContaining({
          code: "ADMIN_PERMISSION_DENIED",
          httpStatus: 403,
        }),
      );
    },
  );

  it("требует HTTPS для production APP_BASE_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "http://academy.abrikosoff.com",
    );
    const request = new Request(
      "http://academy.abrikosoff.com/api/admin/auth/telegram/start",
      {
        method: "POST",
        headers: {
          Origin: "http://academy.abrikosoff.com",
        },
      },
    );

    expect(() =>
      requireAdministrationRequestOrigin(request),
    ).toThrowError(
      expect.objectContaining({
        code: "ADMIN_PERMISSION_DENIED",
        httpStatus: 403,
      }),
    );
  });
});
