import "server-only";

import { Buffer } from "node:buffer";
import {
  createRemoteJWKSet,
  customFetch as joseCustomFetch,
  jwtVerify,
} from "jose";
import * as oidc from "openid-client";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { IdentityConfig } from "./identity-config";
import {
  telegramIdentityFromClaims,
  type VerifiedTelegramIdentity,
} from "./telegram-auth";
import { IdentityError } from "../domain/errors";

type TelegramConfig = NonNullable<IdentityConfig["telegram"]>;

type CachedConfiguration = TelegramConfig & {
  configuration: oidc.Configuration;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  telegramFetch: typeof undiciFetch;
};

const temporaryTransportErrorCodes = new Set([
  "EAI_AGAIN",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_JWKS_TIMEOUT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const telegramServerMetadata: oidc.ServerMetadata = {
  issuer: "https://oauth.telegram.org",
  authorization_endpoint: "https://oauth.telegram.org/auth",
  token_endpoint: "https://oauth.telegram.org/token",
  jwks_uri: "https://oauth.telegram.org/.well-known/jwks.json",
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: [
    "RS256",
    "ES256",
    "EdDSA",
    "ES256K",
  ],
  token_endpoint_auth_methods_supported: [
    "client_secret_basic",
    "client_secret_post",
  ],
  code_challenge_methods_supported: ["S256", "plain"],
};

let cachedConfiguration: CachedConfiguration | undefined;

function configurationFor(config: TelegramConfig) {
  if (
    cachedConfiguration?.clientId === config.clientId &&
    cachedConfiguration.clientSecret === config.clientSecret &&
    cachedConfiguration.proxyUrl === config.proxyUrl &&
    cachedConfiguration.redirectUri === config.redirectUri
  ) {
    return cachedConfiguration.configuration;
  }

  const configuration = new oidc.Configuration(
    telegramServerMetadata,
    config.clientId,
    {
      client_secret: config.clientSecret,
      id_token_signed_response_alg: "RS256",
      redirect_uris: [config.redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
    oidc.ClientSecretBasic(config.clientSecret),
  );

  configuration.timeout = 10;
  const dispatcher = config.proxyUrl
    ? new ProxyAgent(config.proxyUrl)
    : undefined;
  const telegramFetch = ((
    input: Parameters<typeof undiciFetch>[0],
    init?: Parameters<typeof undiciFetch>[1],
  ) =>
    undiciFetch(input, {
      ...init,
      ...(dispatcher ? { dispatcher } : {}),
    })) as typeof undiciFetch;

  if (dispatcher) {
    configuration[oidc.customFetch] =
      telegramFetch as unknown as NonNullable<
        (typeof configuration)[typeof oidc.customFetch]
      >;
  }

  cachedConfiguration = {
    ...config,
    configuration,
    jwks: createRemoteJWKSet(
      new URL(telegramServerMetadata.jwks_uri!),
      {
        [joseCustomFetch]: async (url, options) => {
          const response = await telegramFetch(
            url,
            options as Parameters<typeof undiciFetch>[1],
          );

          if (response.status >= 500) {
            throw Object.assign(
              new Error("Telegram JWKS is temporarily unavailable."),
              { status: response.status },
            );
          }

          return response as unknown as Response;
        },
        timeoutDuration: 10_000,
      },
    ),
    telegramFetch,
  };
  return configuration;
}

function runtimeFor(config: TelegramConfig) {
  configurationFor(config);
  return cachedConfiguration!;
}

function isTemporaryTransportError(
  error: unknown,
  visited = new Set<unknown>(),
): boolean {
  if (
    !error ||
    (typeof error !== "object" && typeof error !== "function") ||
    visited.has(error)
  ) {
    return false;
  }

  visited.add(error);
  const candidate = error as {
    cause?: unknown;
    code?: unknown;
    errors?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  if (
    typeof candidate.code === "string" &&
    temporaryTransportErrorCodes.has(candidate.code)
  ) {
    return true;
  }

  if (
    candidate.name === "AbortError" ||
    candidate.name === "TimeoutError"
  ) {
    return true;
  }

  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : candidate.statusCode;

  if (
    typeof status === "number" &&
    (status === 429 || (status >= 500 && status <= 599))
  ) {
    return true;
  }

  if (
    Array.isArray(candidate.errors) &&
    candidate.errors.some((item) =>
      isTemporaryTransportError(item, visited),
    )
  ) {
    return true;
  }

  return isTemporaryTransportError(candidate.cause, visited);
}

function invalidTelegramLogin(cause?: unknown) {
  return new IdentityError(
    "INVALID_LOGIN",
    "Telegram не подтвердил вход.",
    401,
    cause === undefined ? undefined : { cause },
  );
}

function telegramAudienceMatches(
  audience: unknown,
  clientId: string,
) {
  // Telegram Client ID is decimal. Accept a numeric `aud` only when its
  // exact safe-integer representation matches the configured Client ID.
  const matches = (value: unknown) =>
    value === clientId ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      String(value) === clientId);

  return Array.isArray(audience)
    ? audience.length === 1 && matches(audience[0])
    : matches(audience);
}

async function exchangeCodeForIdToken(
  runtime: CachedConfiguration,
  code: string,
  codeVerifier: string,
) {
  // Telegram exposes all requested identity claims in the ID token. The
  // manual exchange keeps compatibility with its token response while the
  // caller still verifies signature, issuer, audience, expiry and nonce.
  const response = await runtime.telegramFetch(
    telegramServerMetadata.token_endpoint!,
    {
      body: new URLSearchParams({
        client_id: runtime.clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: runtime.redirectUri,
      }),
      headers: {
        authorization: `Basic ${Buffer.from(
          `${runtime.clientId}:${runtime.clientSecret}`,
        ).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (response.status === 429 || response.status >= 500) {
    throw Object.assign(
      new Error("Telegram token endpoint is temporarily unavailable."),
      { status: response.status },
    );
  }

  if (!response.ok) {
    throw invalidTelegramLogin();
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error) {
    throw invalidTelegramLogin(error);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("id_token" in payload) ||
    typeof payload.id_token !== "string" ||
    payload.id_token.length === 0 ||
    payload.id_token.length > 16_384
  ) {
    throw invalidTelegramLogin();
  }

  return payload.id_token;
}

export function buildTelegramAuthorizationUrl(
  config: TelegramConfig,
  input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  },
) {
  return oidc.buildAuthorizationUrl(runtimeFor(config).configuration, {
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
}

export async function exchangeTelegramAuthorizationCode(
  config: TelegramConfig,
  currentUrl: URL,
  input: {
    nonce: string;
    codeVerifier: string;
  },
): Promise<VerifiedTelegramIdentity> {
  try {
    const code = currentUrl.searchParams.get("code");

    if (!code || currentUrl.searchParams.getAll("code").length !== 1) {
      throw invalidTelegramLogin();
    }

    const runtime = runtimeFor(config);
    const idToken = await exchangeCodeForIdToken(
      runtime,
      code,
      input.codeVerifier,
    );
    const { payload } = await jwtVerify(idToken, runtime.jwks, {
      algorithms: ["RS256"],
      clockTolerance: 5,
      issuer: telegramServerMetadata.issuer,
      maxTokenAge: "10m",
      requiredClaims: ["sub", "iat", "exp", "nonce"],
    });

    if (
      payload.nonce !== input.nonce ||
      !telegramAudienceMatches(payload.aud, config.clientId)
    ) {
      throw invalidTelegramLogin();
    }

    return telegramIdentityFromClaims(
      payload as unknown as oidc.IDToken,
    );
  } catch (error) {
    if (error instanceof IdentityError) {
      throw error;
    }

    if (isTemporaryTransportError(error)) {
      throw new IdentityError(
        "AUTH_UNAVAILABLE",
        "Telegram временно недоступен.",
        503,
        { cause: error },
      );
    }

    throw invalidTelegramLogin(error);
  }
}
