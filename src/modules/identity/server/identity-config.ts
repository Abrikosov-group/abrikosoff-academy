import "server-only";

export const privacyDocumentVersion = "2026-07-28";

export type IdentityConfig = {
  demoAuthEnabled: boolean;
  emailAuthMode: "demo" | "disabled";
  sessionTtlDays: number;
  telegram?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
};

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

    return {
      clientId,
      clientSecret,
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
    telegram: readTelegramConfig(production),
  };
}
