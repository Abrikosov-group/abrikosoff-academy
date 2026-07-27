import { expect, test } from "@playwright/test";

const lessonPath = "/courses/healthy-habits/lessons/1";

test("вход, оплата и доступ к уроку работают как единый сценарий", async ({
  page,
}) => {
  const unauthorizedCheckout = await page.request.post(
    "/api/payments/checkout",
    {
      data: {
        plan: "annual",
        receiptEmail: "student@example.test",
        recurringConsent: true,
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

  await expect(page).toHaveURL(/\/checkout\?plan=annual$/);

  await page.goto(lessonPath);
  await expect(page).toHaveURL(/\/pricing$/);

  await page.goto("/checkout?plan=annual");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Перейти к оплате" })
    .click();

  await expect(page).toHaveURL(/\/payment\/success\?orderId=/);
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
});
