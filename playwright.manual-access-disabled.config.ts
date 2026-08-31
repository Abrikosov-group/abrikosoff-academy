import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3201";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "manual-access-disabled.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-manual-access-disabled-e2e.mjs",
    env: {
      ...process.env,
      APP_BASE_URL: baseURL,
      ADMIN_DISPLAY_TIME_ZONE: "Europe/Moscow",
      ADMINISTRATION_ENABLED: "true",
      ADMINISTRATION_MODE: "operational",
      AUTH_DEMO_MODE: "enabled",
      DATABASE_URL: testDatabaseUrl,
      EMAIL_AUTH_MODE: "demo",
      EFFECTIVE_ACCESS_MODE: "v2",
      IDENTITY_SESSION_TTL_DAYS: "30",
      MANUAL_ACCESS_GRANTING_ENABLED: "false",
      NEXT_DIST_DIR: ".next-e2e-disabled",
      PAYMENT_DEFAULT_PROVIDER: "demo",
      PAYMENTS_MODE: "demo",
      TELEGRAM_OIDC_CLIENT_ID: "8802171680",
      TELEGRAM_OIDC_CLIENT_SECRET:
        "telegram-oidc-client-secret-for-e2e-tests",
      TELEGRAM_OIDC_REDIRECT_URI:
        `${baseURL}/api/auth/telegram/callback`,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
