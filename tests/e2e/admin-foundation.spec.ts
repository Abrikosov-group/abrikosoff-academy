import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const baseUrl = "http://127.0.0.1:3200";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

test("защищённый /admin перечитывает роль на каждом запросе", async ({
  context,
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);

  const unauthorizedStart = await page.request.post(
    "/api/admin/auth/telegram/start",
    {
      data: {
        redirectPath: "/admin",
      },
      headers: {
        Origin: baseUrl,
      },
    },
  );

  expect(unauthorizedStart.status()).toBe(401);

  const database = new Client({
    connectionString: testDatabaseUrl,
    application_name: "academy-admin-e2e",
  });
  const userId = randomUUID();
  const methodId = randomUUID();
  const sessionId = randomUUID();
  const assignmentId = randomUUID();
  const rawToken = randomUUID() + randomUUID();
  const tokenSha256 = createHash("sha256")
    .update(rawToken)
    .digest("hex");

  await database.connect();

  try {
    await database.query("BEGIN");
    await database.query(
      `
        INSERT INTO identity_users (
          id,
          display_name,
          status
        )
        VALUES ($1, 'E2E Владелец', 'active')
      `,
      [userId],
    );
    await database.query(
      `
        INSERT INTO identity_methods (
          id,
          user_id,
          method_type,
          identifier,
          verified_at,
          metadata
        )
        VALUES (
          $1,
          $2,
          'telegram',
          $3,
          now(),
          '{}'::jsonb
        )
      `,
      [methodId, userId, `e2e-owner-${userId}`],
    );
    await database.query(
      `
        INSERT INTO identity_sessions (
          id,
          user_id,
          token_sha256,
          expires_at,
          authenticated_at,
          authentication_method,
          authentication_method_id,
          admin_verified_at,
          admin_verification_method,
          user_agent_family
        )
        VALUES (
          $1,
          $2,
          $3,
          now() + interval '1 day',
          now(),
          'telegram_oidc',
          $4,
          now(),
          'telegram_oidc',
          'Google Chrome'
        )
      `,
      [sessionId, userId, tokenSha256, methodId],
    );
    await database.query(
      `
        INSERT INTO admin_role_assignments (
          id,
          user_id,
          role,
          status,
          granted_by_user_id,
          granted_by_kind,
          grant_reason
        )
        VALUES (
          $1,
          $2,
          'owner',
          'active',
          NULL,
          'system',
          'Подготовка защищённого E2E-сценария'
        )
      `,
      [assignmentId, userId],
    );
    await database.query("COMMIT");

    await context.addCookies([
      {
        name: "academy_session",
        value: rawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    const adminResponse = await page.goto("/admin");

    expect(adminResponse?.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        name: "Администрирование",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Контур защищён", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/демонстрационные показатели/),
    ).toBeVisible();

    const crossOriginStart = await page.request.post(
      "/api/admin/auth/telegram/start",
      {
        data: {
          redirectPath: "/admin",
        },
        headers: {
          Origin: "https://example.test",
        },
      },
    );

    expect(crossOriginStart.status()).toBe(403);

    const malformedStart = await page.request.post(
      "/api/admin/auth/telegram/start",
      {
        data: null,
        headers: {
          Origin: baseUrl,
        },
      },
    );

    expect(malformedStart.status()).toBe(400);

    const alreadyVerifiedStart = await page.request.post(
      "/api/admin/auth/telegram/start",
      {
        data: {
          redirectPath: "/admin",
        },
        headers: {
          Origin: baseUrl,
        },
      },
    );

    expect(alreadyVerifiedStart.status()).toBe(200);
    await expect(alreadyVerifiedStart.json()).resolves.toEqual({
      nextUrl: "/admin",
    });

    await database.query(
      `
        UPDATE admin_role_assignments
        SET
          status = 'revoked',
          revoke_reason = 'Проверка немедленного закрытия доступа',
          revoked_at = now()
        WHERE id = $1
      `,
      [assignmentId],
    );

    const forbiddenResponse = await page.goto("/admin");

    expect(forbiddenResponse?.status()).toBe(403);
    await expect(
      page.getByRole("heading", {
        name: "Нет доступа к панели",
      }),
    ).toBeVisible();
  } catch (error) {
    await database.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await database.end();
  }
});
