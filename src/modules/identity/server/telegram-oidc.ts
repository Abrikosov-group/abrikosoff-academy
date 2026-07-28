import "server-only";

import * as oidc from "openid-client";
import type { IdentityConfig } from "./identity-config";
import {
  telegramIdentityFromClaims,
  type VerifiedTelegramIdentity,
} from "./telegram-auth";
import { IdentityError } from "../domain/errors";

type TelegramConfig = NonNullable<IdentityConfig["telegram"]>;

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

function createConfiguration(config: TelegramConfig) {
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
  return configuration;
}

export function buildTelegramAuthorizationUrl(
  config: TelegramConfig,
  input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  },
) {
  return oidc.buildAuthorizationUrl(createConfiguration(config), {
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

  const tokens = await oidc.authorizationCodeGrant(
    createConfiguration(config),
    callbackUrl,
    {
      expectedState: input.state,
      expectedNonce: input.nonce,
      pkceCodeVerifier: input.codeVerifier,
      idTokenExpected: true,
    },
  );
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
