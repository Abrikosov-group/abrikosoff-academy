import "server-only";

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

  if (config.proxyUrl) {
    const dispatcher = new ProxyAgent(config.proxyUrl);

    const proxyFetch = (
      input: Parameters<typeof undiciFetch>[0],
      init?: Parameters<typeof undiciFetch>[1],
    ) =>
      undiciFetch(input, {
        ...init,
        dispatcher,
      });

    configuration[oidc.customFetch] =
      proxyFetch as unknown as NonNullable<
        (typeof configuration)[typeof oidc.customFetch]
      >;
  }

  cachedConfiguration = {
    ...config,
    configuration,
  };
  return configuration;
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

  if (typeof status === "number" && status >= 500 && status <= 599) {
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

export function buildTelegramAuthorizationUrl(
  config: TelegramConfig,
  input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  },
) {
  return oidc.buildAuthorizationUrl(configurationFor(config), {
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
    state: string;
    nonce: string;
    codeVerifier: string;
  },
): Promise<VerifiedTelegramIdentity> {
  const callbackUrl = new URL(config.redirectUri);
  callbackUrl.search = currentUrl.search;

  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;

  try {
    tokens = await oidc.authorizationCodeGrant(
      configurationFor(config),
      callbackUrl,
      {
        expectedState: input.state,
        expectedNonce: input.nonce,
        pkceCodeVerifier: input.codeVerifier,
        idTokenExpected: true,
      },
    );
  } catch (error) {
    if (isTemporaryTransportError(error)) {
      throw new IdentityError(
        "AUTH_UNAVAILABLE",
        "Telegram временно недоступен.",
        503,
        { cause: error },
      );
    }

    throw error;
  }

  const claims = tokens.claims();

  if (!claims) {
    throw new IdentityError(
      "INVALID_LOGIN",
      "Telegram не вернул подтверждение личности.",
      401,
    );
  }

  return telegramIdentityFromClaims(claims);
}
