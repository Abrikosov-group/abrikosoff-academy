import {
  customFetch as joseCustomFetch,
  type RemoteJWKSetOptions,
} from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTelegramAuthorizationUrl,
  exchangeTelegramAuthorizationCode,
} from "@/modules/identity/server/telegram-oidc";

const {
  createRemoteJWKSetMock,
  jwtVerifyMock,
  proxyAgentMock,
  proxyDispatcher,
  remoteJwks,
  undiciFetchMock,
} = vi.hoisted(() => {
  const dispatcher = { type: "proxy-dispatcher" };
  const jwks = vi.fn();

  return {
    createRemoteJWKSetMock: vi.fn(() => jwks),
    jwtVerifyMock: vi.fn(),
    proxyAgentMock: vi.fn(function ProxyAgentMock() {
      return dispatcher;
    }),
    proxyDispatcher: dispatcher,
    remoteJwks: jwks,
    undiciFetchMock: vi.fn(),
  };
});

vi.mock("jose", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jose")>()),
  createRemoteJWKSet: createRemoteJWKSetMock,
  jwtVerify: jwtVerifyMock,
}));

vi.mock("undici", () => ({
  fetch: undiciFetchMock,
  ProxyAgent: proxyAgentMock,
}));

const telegramConfig = {
  clientId: "8802171680",
  clientSecret: "telegram-oidc-client-secret-for-tests",
  redirectUri:
    "https://academy.abrikosoff.com/api/auth/telegram/callback",
};

const currentUrl = () =>
  new URL(
    "https://academy.abrikosoff.com/api/auth/telegram/callback" +
      "?code=authorization-code&state=state-value",
  );

const exchangeInput = {
  nonce: "nonce-value",
  codeVerifier: "pkce-code-verifier",
};

function tokenResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function mockSuccessfulTelegramResponse(
  audience: string | number | Array<string | number> =
    telegramConfig.clientId,
) {
  undiciFetchMock.mockImplementation(async () =>
    tokenResponse({
      id_token: "signed-telegram-id-token",
    }),
  );
  jwtVerifyMock.mockResolvedValue({
    payload: {
      aud: audience,
      exp: 1_800_000_000,
      iat: 1_799_996_400,
      id: 987654321,
      iss: "https://oauth.telegram.org",
      name: "Светлана Федотова",
      nonce: exchangeInput.nonce,
      preferred_username: "svetlana",
      sub: "123456789",
    },
  });
}

describe("buildTelegramAuthorizationUrl", () => {
  it("создаёт Telegram OIDC запрос с Code Flow, PKCE, state и nonce", () => {
    const url = buildTelegramAuthorizationUrl(
      telegramConfig,
      {
        state: "state-value",
        nonce: exchangeInput.nonce,
        codeChallenge: "pkce-challenge",
      },
    );

    expect(url.origin).toBe("https://oauth.telegram.org");
    expect(url.pathname).toBe("/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: telegramConfig.clientId,
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
      nonce: exchangeInput.nonce,
      redirect_uri: telegramConfig.redirectUri,
      response_type: "code",
      scope: "openid profile",
      state: "state-value",
    });
  });
});

describe("exchangeTelegramAuthorizationCode", () => {
  beforeEach(() => {
    createRemoteJWKSetMock.mockClear();
    jwtVerifyMock.mockReset();
    proxyAgentMock.mockClear();
    undiciFetchMock.mockReset();
  });

  it("обменивает code с PKCE и проверяет подписанный ID-токен", async () => {
    mockSuccessfulTelegramResponse();

    const identity = await exchangeTelegramAuthorizationCode(
      telegramConfig,
      currentUrl(),
      exchangeInput,
    );

    expect(undiciFetchMock).toHaveBeenCalledOnce();
    const [endpoint, request] = undiciFetchMock.mock.calls[0]!;
    const body = new URLSearchParams(String(request?.body));

    expect(endpoint).toBe("https://oauth.telegram.org/token");
    expect(request).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${telegramConfig.clientId}:${telegramConfig.clientSecret}`,
        ).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect(Object.fromEntries(body)).toEqual({
      client_id: telegramConfig.clientId,
      code: "authorization-code",
      code_verifier: exchangeInput.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: telegramConfig.redirectUri,
    });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "signed-telegram-id-token",
      remoteJwks,
      {
        algorithms: ["RS256"],
        clockTolerance: 5,
        issuer: "https://oauth.telegram.org",
        maxTokenAge: "10m",
        requiredClaims: ["sub", "iat", "exp", "nonce"],
      },
    );
    expect(identity).toEqual({
      subject: "123456789",
      displayName: "Светлана Федотова",
      metadata: {
        profileMetadataVersion: 1,
        username: "svetlana",
        photoUrl: undefined,
        telegramUserId: "987654321",
        profileName: "Светлана Федотова",
        firstName: undefined,
        lastName: undefined,
        requestedScopes: ["openid", "profile"],
        tokenIssuedAt: new Date(
          1_799_996_400 * 1_000,
        ).toISOString(),
        tokenExpiresAt: new Date(
          1_800_000_000 * 1_000,
        ).toISOString(),
      },
    });
  });

  it("принимает документированный ответ только с нужным ID-токеном", async () => {
    mockSuccessfulTelegramResponse();

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        currentUrl(),
        exchangeInput,
      ),
    ).resolves.toMatchObject({
      subject: "123456789",
    });

    expect(undiciFetchMock).toHaveBeenCalledOnce();
  });

  it("принимает числовой Telegram audience, равный Client ID", async () => {
    mockSuccessfulTelegramResponse(8802171680);

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        currentUrl(),
        exchangeInput,
      ),
    ).resolves.toMatchObject({
      subject: "123456789",
    });
  });

  it.each([
    "wrong-client",
    8802171681,
    ["8802171680", "other-audience"],
    undefined,
  ])("отклоняет неподходящий audience", async (audience) => {
    mockSuccessfulTelegramResponse();
    jwtVerifyMock.mockResolvedValue({
      payload: {
        aud: audience,
        exp: 1_800_000_000,
        iat: 1_799_996_400,
        iss: "https://oauth.telegram.org",
        nonce: exchangeInput.nonce,
        sub: "123456789",
      },
    });

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        currentUrl(),
        exchangeInput,
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "INVALID_LOGIN",
      httpStatus: 401,
    });
  });

  it("отклоняет ID-токен с другим nonce", async () => {
    mockSuccessfulTelegramResponse();
    jwtVerifyMock.mockResolvedValue({
      payload: {
        aud: telegramConfig.clientId,
        exp: 1_800_000_000,
        iat: 1_799_996_400,
        iss: "https://oauth.telegram.org",
        nonce: "other-nonce",
        sub: "123456789",
      },
    });

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        currentUrl(),
        exchangeInput,
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "INVALID_LOGIN",
      httpStatus: 401,
    });
  });

  it.each([
    { error: "invalid_grant" },
    { access_token: "not-an-id-token" },
    null,
  ])("отклоняет ответ без ID-токена", async (payload) => {
    undiciFetchMock.mockResolvedValue(tokenResponse(payload));

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        currentUrl(),
        exchangeInput,
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "INVALID_LOGIN",
      httpStatus: 401,
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("отклоняет callback с повторяющимся code", async () => {
    mockSuccessfulTelegramResponse();
    const duplicateCodeUrl = currentUrl();
    duplicateCodeUrl.searchParams.append(
      "code",
      "other-authorization-code",
    );

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        duplicateCodeUrl,
        exchangeInput,
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "INVALID_LOGIN",
    });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { code: "ETIMEDOUT" },
    new AggregateError([
      Object.assign(new Error("IPv4"), { code: "ENETUNREACH" }),
      Object.assign(new Error("IPv6"), { code: "EHOSTUNREACH" }),
    ]),
    new TypeError("fetch failed", {
      cause: new DOMException(
        "Request was cancelled.",
        "AbortError",
      ),
    }),
    { status: 503 },
  ])(
    "возвращает временную ошибку при недоступности token endpoint",
    async (transportError) => {
      undiciFetchMock.mockRejectedValue(transportError);

      await expect(
        exchangeTelegramAuthorizationCode(
          telegramConfig,
          currentUrl(),
          exchangeInput,
        ),
      ).rejects.toMatchObject({
        name: "IdentityError",
        code: "AUTH_UNAVAILABLE",
        publicMessage: "Telegram временно недоступен.",
        httpStatus: 503,
      });
    },
  );

  it.each([429, 503])(
    "возвращает временную ошибку при HTTP %s от token endpoint",
    async (status) => {
      undiciFetchMock.mockResolvedValue(
        tokenResponse(
          {
            error: "temporarily_unavailable",
          },
          status,
        ),
      );

      await expect(
        exchangeTelegramAuthorizationCode(
          telegramConfig,
          currentUrl(),
          exchangeInput,
        ),
      ).rejects.toMatchObject({
        name: "IdentityError",
        code: "AUTH_UNAVAILABLE",
        httpStatus: 503,
      });
    },
  );

  it("возвращает временную ошибку при недоступности JWKS", async () => {
    undiciFetchMock.mockResolvedValue(
      tokenResponse({
        id_token: "signed-telegram-id-token",
      }),
    );
    jwtVerifyMock.mockRejectedValue(
      Object.assign(new Error("JWKS timed out"), {
        code: "ERR_JWKS_TIMEOUT",
      }),
    );

    await expect(
      exchangeTelegramAuthorizationCode(
        telegramConfig,
        currentUrl(),
        exchangeInput,
      ),
    ).rejects.toMatchObject({
      name: "IdentityError",
      code: "AUTH_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("использует один изолированный прокси для token endpoint и JWKS", async () => {
    const proxyConfig = {
      ...telegramConfig,
      clientSecret:
        "telegram-oidc-proxy-client-secret-for-tests",
      proxyUrl: "http://telegram-egress-tunnel:3128/",
    };

    mockSuccessfulTelegramResponse();

    await exchangeTelegramAuthorizationCode(
      proxyConfig,
      currentUrl(),
      exchangeInput,
    );

    expect(proxyAgentMock).toHaveBeenCalledWith(proxyConfig.proxyUrl);
    expect(undiciFetchMock.mock.calls[0]?.[1]).toMatchObject({
      dispatcher: proxyDispatcher,
    });

    const remoteJwksCall = createRemoteJWKSetMock.mock.calls.at(
      -1,
    ) as unknown as
      | [URL, RemoteJWKSetOptions | undefined]
      | undefined;
    const remoteJwksOptions = remoteJwksCall?.[1];
    const jwksFetch = remoteJwksOptions?.[joseCustomFetch];

    expect(jwksFetch).toEqual(expect.any(Function));
    if (!jwksFetch) {
      throw new Error("JWKS fetch не настроен.");
    }

    undiciFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [],
        }),
        { status: 200 },
      ),
    );

    await jwksFetch(
      "https://oauth.telegram.org/.well-known/jwks.json",
      {
        headers: new Headers(),
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(1_000),
      },
    );

    expect(undiciFetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      dispatcher: proxyDispatcher,
    });
  });

  it("кэширует Telegram JWKS между входами", async () => {
    const rotatedConfig = {
      ...telegramConfig,
      clientSecret:
        "telegram-oidc-rotated-client-secret-for-tests",
    };

    mockSuccessfulTelegramResponse();
    await exchangeTelegramAuthorizationCode(
      rotatedConfig,
      currentUrl(),
      exchangeInput,
    );
    await exchangeTelegramAuthorizationCode(
      rotatedConfig,
      currentUrl(),
      exchangeInput,
    );

    expect(createRemoteJWKSetMock).toHaveBeenCalledOnce();
    expect(jwtVerifyMock).toHaveBeenCalledTimes(2);
    expect(jwtVerifyMock.mock.calls[1]?.[1]).toBe(
      jwtVerifyMock.mock.calls[0]?.[1],
    );
  });
});
