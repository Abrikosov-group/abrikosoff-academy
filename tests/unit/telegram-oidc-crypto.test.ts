import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeTelegramAuthorizationCode } from "@/modules/identity/server/telegram-oidc";

const { proxyAgentMock, undiciFetchMock } = vi.hoisted(() => ({
  proxyAgentMock: vi.fn(),
  undiciFetchMock: vi.fn(),
}));

vi.mock("undici", () => ({
  fetch: undiciFetchMock,
  ProxyAgent: proxyAgentMock,
}));

const clientId = "8802171680";
const nonce = "nonce-value";
const config = {
  clientId,
  clientSecret: "telegram-crypto-client-secret-for-tests",
  redirectUri:
    "https://academy.abrikosoff.com/api/auth/telegram/callback",
};
const callbackUrl = new URL(
  `${config.redirectUri}?code=authorization-code&state=state-value`,
);

let privateKey: CryptoKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let idToken: string;

async function signedTelegramIdToken(tokenNonce: string) {
  const payload = {
    aud: 8802171680,
    id: 987654321,
    name: "Светлана Федотова",
    nonce: tokenNonce,
    preferred_username: "svetlana",
  } as unknown as JWTPayload;

  return new SignJWT(payload)
    .setProtectedHeader({
      alg: "RS256",
      kid: "telegram-test-key",
    })
    .setIssuer("https://oauth.telegram.org")
    .setSubject("123456789")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("Telegram ID-токен", () => {
  beforeAll(async () => {
    const keyPair = await generateKeyPair("RS256", {
      extractable: true,
    });

    privateKey = keyPair.privateKey;
    publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.alg = "RS256";
    publicJwk.kid = "telegram-test-key";
    publicJwk.use = "sig";
  });

  beforeEach(async () => {
    undiciFetchMock.mockReset();
    idToken = await signedTelegramIdToken(nonce);
    undiciFetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url === "https://oauth.telegram.org/token") {
        return new Response(
          JSON.stringify({
            id_token: idToken,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          },
        );
      }

      if (
        url ===
        "https://oauth.telegram.org/.well-known/jwks.json"
      ) {
        return new Response(
          JSON.stringify({
            keys: [publicJwk],
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          },
        );
      }

      throw new Error(`Неожиданный тестовый URL: ${url}`);
    });
  });

  it("проверяет реальную RS256-подпись и числовой audience", async () => {
    await expect(
      exchangeTelegramAuthorizationCode(
        config,
        callbackUrl,
        {
          codeVerifier: "pkce-code-verifier",
          nonce,
        },
      ),
    ).resolves.toEqual({
      subject: "123456789",
      displayName: "Светлана Федотова",
      metadata: {
        username: "svetlana",
        photoUrl: undefined,
        telegramUserId: "987654321",
      },
    });

    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
  });

  it("отклоняет корректно подписанный токен с другим nonce", async () => {
    idToken = await signedTelegramIdToken("other-nonce");

    await expect(
      exchangeTelegramAuthorizationCode(
        {
          ...config,
          clientSecret:
            "telegram-crypto-rotated-secret-for-tests",
        },
        callbackUrl,
        {
          codeVerifier: "pkce-code-verifier",
          nonce,
        },
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "INVALID_LOGIN",
      httpStatus: 401,
    });
  });
});
