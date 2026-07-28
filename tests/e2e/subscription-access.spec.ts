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

  const oversizedDemoLogin = await page.request.post("/api/auth/demo", {
    data: JSON.stringify({
      redirectPath: "/dashboard",
      privacyAccepted: true,
      padding: "x".repeat(5 * 1024),
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  expect(oversizedDemoLogin.status()).toBe(413);

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

  const oversizedUnauthorizedCheckout = await page.request.post(
    "/api/payments/checkout",
    {
      data: "x".repeat(9 * 1024),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "e2e-unauthorized-large-checkout",
      },
    },
  );

  expect(oversizedUnauthorizedCheckout.status()).toBe(401);

  await page.goto(lessonPath);
  await expect(page).toHaveURL(
    new RegExp(
      `/login\\?next=${encodeURIComponent(lessonPath)}$`,
    ),
  );
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Войти через Telegram" })
    .click();
  await expect(page).toHaveURL(/\/pricing$/, {
    timeout: 15_000,
  });

  const oversizedAuthorizedCheckout = await page.request.post(
    "/api/payments/checkout",
    {
      data: "x".repeat(9 * 1024),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "e2e-authorized-large-checkout",
      },
    },
  );

  expect(oversizedAuthorizedCheckout.status()).toBe(413);

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

  const repeatedCheckout = await page.request.post(
    "/api/payments/checkout",
    {
      data: {
        plan: "monthly",
        offerAccepted: true,
      },
      headers: {
        "Idempotency-Key": "e2e-active-access-checkout",
      },
    },
  );

  expect(repeatedCheckout.status()).toBe(409);
  await page.goto("/checkout?plan=monthly");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Войти через Telegram" })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, {
    timeout: 15_000,
  });

  const cabinetSections = [
    {
      href: "/dashboard",
      link: "Обзор",
      heading: /Добрый день/,
    },
    {
      href: "/dashboard/courses",
      link: "Мои курсы",
      heading: "Мои курсы",
    },
    {
      href: "/dashboard/subscription",
      link: "Подписка",
      heading: "Подписка",
    },
    {
      href: "/dashboard/payments",
      link: "История платежей",
      heading: "История платежей",
    },
    {
      href: "/dashboard/profile",
      link: "Профиль и вход",
      heading: "Профиль и вход",
    },
  ] as const;

  for (const section of cabinetSections) {
    const link = page.getByRole("link", {
      name: section.link,
      exact: true,
    });

    await expect(link).toHaveAttribute("href", section.href);
    await link.click();
    await expect(page).toHaveURL(
      new RegExp(`${section.href.replaceAll("/", "\\/")}$`),
    );
    await expect(
      page.getByRole("heading", {
        name: section.heading,
        exact: typeof section.heading === "string",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: section.link,
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
  }

  await page.goto("/dashboard/payments");
  await expect(page.getByText("Оплачен", { exact: true })).toBeVisible();
  await expect(page.getByText("14 000 ₽", { exact: true })).toBeVisible();

  await page.goto("/dashboard/profile");
  const accountMenuTrigger = page.getByRole("button", {
    name: "Открыть меню профиля",
  });

  await accountMenuTrigger.click();
  const accountMenu = page.getByRole("dialog", {
    name: "Меню профиля",
  });

  await expect(accountMenu).toBeVisible();
  const profileLink = accountMenu.getByRole("link", {
    name: "Профиль и вход",
    exact: true,
  });
  await expect(profileLink).toHaveAttribute("aria-current", "page");
  await expect(profileLink).toBeFocused();
  await expect(
    accountMenu.getByRole("button", {
      name: "Выйти из аккаунта",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(accountMenu).toBeHidden();
  await expect(accountMenuTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const mobileMenuButton = page.getByRole("button", {
    name: /Раздел кабинета/,
  });

  await expect(mobileMenuButton).toBeVisible();
  await expect(mobileMenuButton).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await mobileMenuButton.click();
  await expect(mobileMenuButton).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page
    .getByRole("link", {
      name: "История платежей",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/payments$/);
  await expect(mobileMenuButton).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(
    page.getByRole("heading", {
      name: "История платежей",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  const database = new Client({
    connectionString: testDatabaseUrl,
    application_name: "academy-e2e-expiry-check",
  });

  await database.connect();

  try {
    await database.query("BEGIN");
    await database.query(`
      UPDATE billing_access_grants
      SET
        period_start = now() - interval '2 seconds',
        period_end = now() - interval '1 second'
      WHERE status = 'granted'
    `);
    await database.query(`
      UPDATE billing_subscriptions
      SET current_period_end = now() - interval '1 second'
      WHERE status = 'active'
    `);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    await database.end();
  }

  await page.goto(lessonPath);
  await expect(page).toHaveURL(/\/pricing$/);
});
