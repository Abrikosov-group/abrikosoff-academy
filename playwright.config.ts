import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3200";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

export default defineConfig({
  testDir: "./tests/e2e",
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
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3200",
    env: {
      ...process.env,
      APP_BASE_URL: baseURL,
      ADMIN_DISPLAY_TIME_ZONE: "Europe/Moscow",
      ADMINISTRATION_ENABLED: "true",
      ADMINISTRATION_MODE: "operational",
      AUTH_DEMO_MODE: "enabled",
      DATABASE_URL: testDatabaseUrl,
      DEMO_WEBHOOK_SECRET: "e2e-demo-webhook-secret",
      EMAIL_AUTH_MODE: "demo",
      IDENTITY_SESSION_TTL_DAYS: "30",
      NEXT_DIST_DIR: ".next-e2e",
      PAYMENT_DEFAULT_PROVIDER: "demo",
      PAYMENTS_MODE: "demo",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
