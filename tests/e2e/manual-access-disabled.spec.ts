import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const baseUrl = "http://127.0.0.1:3201";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

test("выключенная выдача закрывает новую команду, но сохраняет просмотр и отзыв", async ({
  context,
  page,
}) => {
  const fixture = JSON.parse(
    await readFile(
      ".tmp/manual-access-disabled-fixture.json",
      "utf8",
    ),
  ) as {
    customerId: string;
    grantId: string;
    rawToken: string;
  };
  await context.addCookies([
    {
      name: "academy_session",
      value: fixture.rawToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`/admin/students/${fixture.customerId}`);
  await expect(
    page.getByText("Новая выдача ручного доступа временно выключена."),
  ).toBeVisible();
  await expect(page.getByText("Заранее созданный E2E ручной доступ")).toBeVisible();

  const directGrant = await page.evaluate(async (customerId) => {
    const response = await fetch(
      `/api/admin/students/${customerId}/access/manual`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        },
        body: JSON.stringify({
          periodStart: new Date(Date.now() + 86_400_000).toISOString(),
          periodEnd: new Date(Date.now() + 10 * 86_400_000).toISOString(),
          reason: "Прямая проверка выключенной новой выдачи",
        }),
      },
    );
    return { status: response.status, body: await response.json() };
  }, fixture.customerId);
  expect(directGrant).toMatchObject({
    status: 409,
    body: { error: { code: "MANUAL_ACCESS_GRANTING_DISABLED" } },
  });

  const revoke = await page.evaluate(async ({ customerId, grantId }) => {
    const response = await fetch(
      `/api/admin/students/${customerId}/access/manual/${grantId}/revoke`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        },
        body: JSON.stringify({
          reason: "Проверка отзыва при выключенной новой выдаче",
        }),
      },
    );
    return { status: response.status, body: await response.json() };
  }, fixture);
  expect(revoke).toMatchObject({
    status: 200,
    body: {
      grantId: fixture.grantId,
      status: "revoked",
      effectiveAccess: { canReadCourses: false },
    },
  });
  await page.reload();
  await expect(page.getByText("Отозван", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Проверка отзыва при выключенной новой выдаче"),
  ).toBeVisible();

  const database = new Client({ connectionString: testDatabaseUrl });
  await database.connect();
  try {
    const state = await database.query<{
      grant_status: string;
      payment_count: number;
    }>(
      `
        SELECT
          (SELECT status FROM access_manual_grants WHERE id = $1) AS grant_status,
          (SELECT count(*)::integer FROM billing_orders WHERE customer_id = $2) AS payment_count
      `,
      [fixture.grantId, fixture.customerId],
    );
    expect(state.rows[0]).toEqual({
      grant_status: "revoked",
      payment_count: 0,
    });
  } finally {
    await database.end();
  }
});
