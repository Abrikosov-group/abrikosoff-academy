import { describe, expect, it } from "vitest";
import { buildTelegramAuthorizationUrl } from "@/modules/identity/server/telegram-oidc";

describe("buildTelegramAuthorizationUrl", () => {
  it("создаёт Telegram OIDC запрос с Code Flow, PKCE, state и nonce", () => {
    const url = buildTelegramAuthorizationUrl(
      {
        clientId: "8802171680",
        clientSecret: "telegram-oidc-client-secret-for-tests",
        redirectUri:
          "https://academy.abrikosoff.com/api/auth/telegram/callback",
      },
      {
        state: "state-value",
        nonce: "nonce-value",
        codeChallenge: "pkce-challenge",
      },
    );

    expect(url.origin).toBe("https://oauth.telegram.org");
    expect(url.pathname).toBe("/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "8802171680",
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
      nonce: "nonce-value",
      redirect_uri:
        "https://academy.abrikosoff.com/api/auth/telegram/callback",
      response_type: "code",
      scope: "openid profile",
      state: "state-value",
    });
  });
});
