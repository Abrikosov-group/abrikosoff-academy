import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getIdentityConfig,
  resolveIdentityPublicBaseUrl,
} from "@/modules/identity/server/identity-config";

const callbackUrl =
  "https://academy.abrikosoff.com/api/auth/telegram/callback";

function configureTelegram() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_BASE_URL", "https://academy.abrikosoff.com");
  vi.stubEnv("TELEGRAM_OIDC_CLIENT_ID", "8802171680");
  vi.stubEnv(
    "TELEGRAM_OIDC_CLIENT_SECRET",
    "telegram-oidc-client-secret-for-tests",
  );
  vi.stubEnv("TELEGRAM_OIDC_REDIRECT_URI", callbackUrl);
}

describe("getIdentityConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("включает Telegram только при полной согласованной OIDC-конфигурации", () => {
    configureTelegram();

    expect(getIdentityConfig().telegram).toEqual({
      clientId: "8802171680",
      clientSecret: "telegram-oidc-client-secret-for-tests",
      redirectUri: callbackUrl,
    });
  });

  it("отключает Telegram при callback другого домена", () => {
    configureTelegram();
    vi.stubEnv(
      "TELEGRAM_OIDC_REDIRECT_URI",
      "https://example.com/api/auth/telegram/callback",
    );

    expect(getIdentityConfig().telegram).toBeUndefined();
  });

  it("отключает Telegram при неполной конфигурации", () => {
    configureTelegram();
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_SECRET", "");

    expect(getIdentityConfig().telegram).toBeUndefined();
  });

  it("принимает отдельный HTTPS-прокси без реквизитов доступа", () => {
    configureTelegram();
    vi.stubEnv(
      "TELEGRAM_HTTPS_PROXY_URL",
      "http://telegram-egress-tunnel:3128",
    );

    expect(getIdentityConfig().telegram).toEqual({
      clientId: "8802171680",
      clientSecret: "telegram-oidc-client-secret-for-tests",
      proxyUrl: "http://telegram-egress-tunnel:3128/",
      redirectUri: callbackUrl,
    });
  });

  it.each([
    "socks5://telegram-egress-tunnel:1080",
    "http://user:password@telegram-egress-tunnel:3128",
    "http://telegram-egress-tunnel:3128/path",
    "http://telegram-egress-tunnel:3128/?token=secret",
  ])(
    "отключает Telegram при небезопасном URL прокси: %s",
    (proxyUrl) => {
      configureTelegram();
      vi.stubEnv("TELEGRAM_HTTPS_PROXY_URL", proxyUrl);

      expect(getIdentityConfig().telegram).toBeUndefined();
    },
  );

  it("возвращает канонический публичный origin вместо внутреннего адреса", () => {
    configureTelegram();

    expect(
      resolveIdentityPublicBaseUrl(
        "http://127.0.0.1:3100/api/auth/logout",
      ),
    ).toBe("https://academy.abrikosoff.com");
  });

  it.each([
    "http://academy.abrikosoff.com",
    "https://user:password@academy.abrikosoff.com",
    "https://academy.abrikosoff.com/nested",
    "https://academy.abrikosoff.com/?source=test",
  ])(
    "отклоняет небезопасный production APP_BASE_URL: %s",
    (publicBaseUrl) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_BASE_URL", publicBaseUrl);

      expect(() =>
        resolveIdentityPublicBaseUrl(
          "http://127.0.0.1:3100/api/auth/logout",
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "AUTH_NOT_CONFIGURED",
        }),
      );
    },
  );
});
