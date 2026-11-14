import "server-only";

import { IdentityError } from "../domain/errors";

export const privacyDocumentVersion = "2026-08-31";

export type IdentityConfig = {
  demoAuthEnabled: boolean;
  emailAuthMode: "demo" | "disabled";
  sessionTtlDays: number;
  trustedProxy: "none" | "cloudflare";
  telegram?: {
    clientId: string;
    clientSecret: string;
    proxyUrl?: string;
    redirectUri: string;
  };
};

export function resolveIdentityPublicBaseUrl(requestUrl: string) {
  const configured = process.env.APP_BASE_URL?.trim();
  const candidate =
    configured ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : requestUrl);

  if (!candidate) {
    throw new IdentityError(
      "AUTH_NOT_CONFIGURED",
      "Публичный адрес Академии не настроен.",
      503,
    );
  }

  try {
    const url = new URL(candidate);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      (process.env.NODE_ENV === "production" &&
        url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (configured && url.pathname !== "/") ||
      url.search ||
      url.hash
    ) {
      throw new TypeError("Некорректный публичный адрес Академии.");
    }

    return url.origin;
  } catch (error) {
    throw new IdentityError(
      "AUTH_NOT_CONFIGURED",
      "Публичный адрес Академии настроен некорректно.",
      503,
      { cause: error },
    );
  }
}

function readTelegramProxyUrl() {
  const configuredProxyUrl =
    process.env.TELEGRAM_HTTPS_PROXY_URL?.trim();

  if (!configuredProxyUrl) {
    return undefined;
  }

  const proxyUrl = new URL(configuredProxyUrl);

  if (
    !["http:", "https:"].includes(proxyUrl.protocol) ||
    proxyUrl.username ||
    proxyUrl.password ||
    proxyUrl.pathname !== "/" ||
    proxyUrl.search ||
    proxyUrl.hash
  ) {
    throw new TypeError("Некорректный URL Telegram HTTPS-прокси.");
  }

  return proxyUrl.toString();
}

function readTelegramConfig(production: boolean) {
  const clientId = process.env.TELEGRAM_OIDC_CLIENT_ID?.trim();
  const clientSecret =
    process.env.TELEGRAM_OIDC_CLIENT_SECRET?.trim();
  const redirectUri = process.env.TELEGRAM_OIDC_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return undefined;
  }

  if (!/^\d{1,20}$/.test(clientId) || clientSecret.length < 32) {
    return undefined;
  }

  try {
    const callbackUrl = new URL(redirectUri);
    const appBaseUrl = process.env.APP_BASE_URL?.trim();

    if (
      callbackUrl.username ||
      callbackUrl.password ||
      callbackUrl.pathname !== "/api/auth/telegram/callback" ||
      callbackUrl.search ||
      callbackUrl.hash ||
      (production && callbackUrl.protocol !== "https:")
    ) {
      return undefined;
    }

    if (appBaseUrl && callbackUrl.origin !== new URL(appBaseUrl).origin) {
      return undefined;
    }

    const proxyUrl = readTelegramProxyUrl();

    return {
      clientId,
      clientSecret,
      ...(proxyUrl ? { proxyUrl } : {}),
      redirectUri: callbackUrl.toString(),
    };
  } catch {
    return undefined;
  }
}

export function getIdentityConfig(): IdentityConfig {
  const production = process.env.NODE_ENV === "production";
  const configuredSessionTtl = Number(
    process.env.IDENTITY_SESSION_TTL_DAYS ?? "30",
  );
  const sessionTtlDays =
    Number.isInteger(configuredSessionTtl) &&
    configuredSessionTtl >= 1 &&
    configuredSessionTtl <= 365
      ? configuredSessionTtl
      : 30;

  return {
    demoAuthEnabled:
      !production && process.env.AUTH_DEMO_MODE !== "disabled",
    emailAuthMode:
      !production && process.env.EMAIL_AUTH_MODE !== "disabled"
        ? "demo"
        : "disabled",
    sessionTtlDays,
    trustedProxy:
      process.env.SESSION_TRUSTED_PROXY === "cloudflare"
        ? "cloudflare"
        : "none",
    telegram: readTelegramConfig(production),
  };
}
