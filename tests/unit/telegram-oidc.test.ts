import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramAuthorizationUrl,
  exchangeTelegramAuthorizationCode,
} from "@/modules/identity/server/telegram-oidc";

const { authorizationCodeGrantMock } = vi.hoisted(() => ({
  authorizationCodeGrantMock: vi.fn(),
}));

vi.mock("openid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openid-client")>()),
  authorizationCodeGrant: authorizationCodeGrantMock,
}));

const telegramConfig = {
  clientId: "8802171680",
  clientSecret: "telegram-oidc-client-secret-for-tests",
  redirectUri:
    "https://academy.abrikosoff.com/api/auth/telegram/callback",
};

describe("buildTelegramAuthorizationUrl", () => {
  it("создаёт Telegram OIDC запрос с Code Flow, PKCE, state и nonce", () => {
    const url = buildTelegramAuthorizationUrl(
      telegramConfig,
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

describe("exchangeTelegramAuthorizationCode", () => {
  it("передаёт state, nonce и PKCE verifier при обмене кода", async () => {
    authorizationCodeGrantMock.mockResolvedValue({
      claims: () => ({
        sub: "123456789",
        id: 987654321,
        name: "Светлана Федотова",
        preferred_username: "svetlana",
      }),
    });

    const currentUrl = new URL(
      "https://academy.abrikosoff.com/api/auth/telegram/callback" +
        "?code=authorization-code&state=state-value",
    );

    const identity = await exchangeTelegramAuthorizationCode(
      telegramConfig,
      currentUrl,
      {
        state: "state-value",
        nonce: "nonce-value",
        codeVerifier: "pkce-code-verifier",
      },
    );

    expect(authorizationCodeGrantMock).toHaveBeenCalledOnce();
    expect(authorizationCodeGrantMock).toHaveBeenCalledWith(
      expect.anything(),
      new URL(
        "https://academy.abrikosoff.com/api/auth/telegram/callback" +
          "?code=authorization-code&state=state-value",
      ),
      {
        expectedState: "state-value",
        expectedNonce: "nonce-value",
        pkceCodeVerifier: "pkce-code-verifier",
        idTokenExpected: true,
      },
    );
    expect(identity).toEqual({
      subject: "123456789",
      displayName: "Светлана Федотова",
      metadata: {
        username: "svetlana",
        photoUrl: undefined,
        telegramUserId: "987654321",
      },
    });
  });

  it("сохраняет JWKS-кэш и обновляет конфигурацию после ротации", async () => {
    authorizationCodeGrantMock.mockResolvedValue({
      claims: () => ({
        sub: "123456789",
      }),
    });
    const currentUrl = new URL(
      "https://academy.abrikosoff.com/api/auth/telegram/callback" +
        "?code=authorization-code&state=state-value",
    );
    const input = {
      state: "state-value",
      nonce: "nonce-value",
      codeVerifier: "pkce-code-verifier",
    };

    await exchangeTelegramAuthorizationCode(
      telegramConfig,
      currentUrl,
      input,
    );
    await exchangeTelegramAuthorizationCode(
      telegramConfig,
      currentUrl,
      input,
    );
    await exchangeTelegramAuthorizationCode(
      {
        ...telegramConfig,
        clientSecret:
          "rotated-telegram-oidc-client-secret-for-tests",
      },
      currentUrl,
      input,
    );

    expect(authorizationCodeGrantMock).toHaveBeenCalledTimes(3);
    expect(authorizationCodeGrantMock.mock.calls[1]?.[0]).toBe(
      authorizationCodeGrantMock.mock.calls[0]?.[0],
    );
    expect(authorizationCodeGrantMock.mock.calls[2]?.[0]).not.toBe(
      authorizationCodeGrantMock.mock.calls[1]?.[0],
    );
  });

  it("отклоняет вход, если Telegram не вернул claims", async () => {
    authorizationCodeGrantMock.mockResolvedValue({
      claims: () => undefined,
    });

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        new URL(
          "https://academy.abrikosoff.com/api/auth/telegram/callback" +
            "?code=authorization-code&state=state-value",
        ),
        {
          state: "state-value",
          nonce: "nonce-value",
          codeVerifier: "pkce-code-verifier",
        },
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "INVALID_LOGIN",
      publicMessage: "Telegram не вернул подтверждение личности.",
      httpStatus: 401,
    });
  });
});
