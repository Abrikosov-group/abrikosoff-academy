import "server-only";

export const privacyDocumentVersion = "2026-07-27";

export type IdentityConfig = {
  demoAuthEnabled: boolean;
  emailAuthMode: "demo" | "disabled";
  sessionTtlDays: number;
  telegram?: {
    botUsername: string;
    botToken: string;
  };
};

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
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim();
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

  return {
    demoAuthEnabled:
      !production && process.env.AUTH_DEMO_MODE !== "disabled",
    emailAuthMode:
      !production && process.env.EMAIL_AUTH_MODE !== "disabled"
        ? "demo"
        : "disabled",
    sessionTtlDays,
    telegram:
      botUsername && botToken
        ? {
            botUsername,
            botToken,
          }
        : undefined,
  };
}
