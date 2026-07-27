import { expect, test } from "@playwright/test";
import { Client } from "pg";

const lessonPath = "/courses/healthy-habits/lessons/1";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

test("вход, оплата и доступ к уроку работают как единый сценарий", async ({
  page,
}) => {
  const invalidDemoLogin = await page.request.post("/api/auth/demo", {
    data: "{",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const invalidEmailLogin = await page.request.post(
    "/api/auth/email/request",
    {
      data: "{",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  expect(invalidDemoLogin.status()).toBe(400);
  expect(invalidEmailLogin.status()).toBe(400);

  const unauthorizedCheckout = await page.request.post(
    "/api/payments/checkout",
    {
      data: {
        plan: "annual",
        receiptEmail: "student@example.test",
        offerAccepted: true,
      },
      headers: {
        "Idempotency-Key": "e2e-unauthorized-checkout",
      },
    },
  );

  expect(unauthorizedCheckout.status()).toBe(401);

  await page.goto(lessonPath);
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/login?plan=annual");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Войти через Telegram" })
    .click();

  await expect(page).toHaveURL(/\/checkout\?plan=annual$/, {
    timeout: 15_000,
  });

  await page.goto(lessonPath);
  await expect(page).toHaveURL(/\/pricing$/);

  await page.goto("/checkout?plan=annual");
  await expect(
    page.getByText(
      "Автоматического продления и повторных списаний нет.",
    ),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Перейти к оплате" })
    .click();

  await expect(page).toHaveURL(/\/payment\/success\?orderId=/, {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Подписка активна" }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Начать первый урок" })
    .click();

  await expect(page).toHaveURL(new RegExp(`${lessonPath}$`));
  await expect(
    page.getByRole("heading", {
      name: "Утренний якорь: с чего начинается система",
    }),
  ).toBeVisible();

  const database = new Client({
    connectionString: testDatabaseUrl,
    application_name: "academy-e2e-expiry-check",
  });

  await database.connect();

  try {
    await database.query(`
      UPDATE billing_subscriptions
      SET current_period_end = now() - interval '1 second'
      WHERE status = 'active'
    `);
  } finally {
    await database.end();
  }

  await page.goto(lessonPath);
  await expect(page).toHaveURL(/\/pricing$/);
});
