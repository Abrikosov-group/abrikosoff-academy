import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const baseUrl = "http://127.0.0.1:3200";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

type DashboardExpectations = {
  activeStudents: number;
  newStudentsLast7Days: number;
  newStudentsLast30Days: number;
  activePaidAccessStudents: number;
  stalePendingPayments: number;
  failedWebhookEvents: number;
  last7DaysFrom: string;
  last30DaysFrom: string;
  through: string;
};

type DashboardFixtureResult = {
  deletedStudentName: string;
};

async function insertDashboardFixtures(
  database: Client,
  userId: string,
): Promise<DashboardFixtureResult> {
  const paidOrderId = randomUUID();
  const pendingOrderId = randomUUID();
  const deletedStudentName = `E2E Удалённый ${randomUUID()}`;

  await database.query(
    `
      INSERT INTO identity_users (
        id,
        display_name,
        status
      )
      VALUES ($1, $2, 'deleted')
    `,
    [randomUUID(), deletedStudentName],
  );

  await database.query(
    `
      INSERT INTO billing_orders (
        id,
        customer_id,
        plan_id,
        legal_entity_id,
        country_code,
        amount_minor,
        currency,
        status,
        idempotency_key,
        selected_provider,
        merchant_account_id,
        offer_accepted_at,
        offer_version
      )
      VALUES
        (
          $1,
          $3,
          'annual',
          'ip-fedotova',
          'RU',
          1400000,
          'RUB',
          'paid',
          $4,
          'demo',
          'admin-dashboard-e2e',
          now(),
          'dashboard-e2e'
        ),
        (
          $2,
          $3,
          'monthly',
          'ip-fedotova',
          'RU',
          150000,
          'RUB',
          'pending',
          $5,
          'demo',
          'admin-dashboard-e2e',
          now(),
          'dashboard-e2e'
        )
    `,
    [
      paidOrderId,
      pendingOrderId,
      userId,
      randomUUID(),
      randomUUID(),
    ],
  );
  await database.query(
    `
      INSERT INTO billing_access_grants (
        order_id,
        customer_id,
        plan_id,
        status,
        period_start,
        period_end,
        granted_at
      )
      VALUES (
        $1,
        $2,
        'annual',
        'granted',
        now() - interval '1 day',
        now() + interval '1 year',
        now()
      )
    `,
    [paidOrderId, userId],
  );
  await database.query(
    `
      INSERT INTO billing_payments (
        id,
        order_id,
        provider,
        merchant_account_id,
        external_payment_id,
        provider_operation_key,
        status,
        amount_minor,
        currency,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'demo',
        'admin-dashboard-e2e',
        $3,
        $4,
        'pending',
        150000,
        'RUB',
        now() - interval '20 minutes',
        now() - interval '20 minutes'
      )
    `,
    [
      randomUUID(),
      pendingOrderId,
      randomUUID(),
      randomUUID(),
    ],
  );
  await database.query(
    `
      INSERT INTO billing_webhook_events (
        id,
        provider,
        merchant_account_id,
        external_event_id,
        event_type,
        payload_sha256,
        payload,
        processing_status,
        error_code
      )
      VALUES (
        $1,
        'demo',
        'admin-dashboard-e2e',
        $2,
        'payment.updated',
        $3,
        '{}'::jsonb,
        'failed',
        'E2E_EXPECTED_FAILURE'
      )
    `,
    [randomUUID(), randomUUID(), "a".repeat(64)],
  );

  return {
    deletedStudentName,
  };
}

async function readDashboardExpectations(
  database: Client,
  generatedAt: string,
): Promise<DashboardExpectations> {
  const result = await database.query<DashboardExpectations>(
    `
      WITH local_clock AS (
        SELECT
          $1::timestamptz AS generated_at,
          ($1::timestamptz AT TIME ZONE 'Europe/Moscow')::date
            AS local_today
      ),
      boundaries AS (
        SELECT
          generated_at,
          local_today,
          local_today - 6 AS last_7_days_from,
          local_today - 29 AS last_30_days_from,
          (local_today - 6) AT TIME ZONE 'Europe/Moscow'
            AS last_7_days_started_at,
          (local_today - 29) AT TIME ZONE 'Europe/Moscow'
            AS last_30_days_started_at
        FROM local_clock
      )
      SELECT
        (
          SELECT count(*)::integer
          FROM identity_users users
          CROSS JOIN boundaries
          WHERE users.status = 'active'
            AND users.created_at <= boundaries.generated_at
        ) AS "activeStudents",
        (
          SELECT count(*)::integer
          FROM identity_users users
          CROSS JOIN boundaries
          WHERE users.status <> 'deleted'
            AND users.created_at >=
              boundaries.last_7_days_started_at
            AND users.created_at <= boundaries.generated_at
        ) AS "newStudentsLast7Days",
        (
          SELECT count(*)::integer
          FROM identity_users users
          CROSS JOIN boundaries
          WHERE users.status <> 'deleted'
            AND users.created_at >=
              boundaries.last_30_days_started_at
            AND users.created_at <= boundaries.generated_at
        ) AS "newStudentsLast30Days",
        (
          SELECT count(DISTINCT grants.customer_id)::integer
          FROM billing_access_grants grants
          CROSS JOIN boundaries
          WHERE grants.status = 'granted'
            AND grants.created_at <= boundaries.generated_at
            AND grants.period_start <= boundaries.generated_at
            AND grants.period_end > boundaries.generated_at
        ) AS "activePaidAccessStudents",
        (
          SELECT count(*)::integer
          FROM billing_payments payments
          CROSS JOIN boundaries
          WHERE payments.status IN (
            'created',
            'pending',
            'requires_action'
          )
            AND payments.updated_at <=
              boundaries.generated_at - interval '15 minutes'
        ) AS "stalePendingPayments",
        (
          SELECT count(*)::integer
          FROM billing_webhook_events webhook_events
          CROSS JOIN boundaries
          WHERE webhook_events.processing_status = 'failed'
            AND webhook_events.received_at <=
              boundaries.generated_at
        ) AS "failedWebhookEvents",
        boundaries.last_7_days_from::text AS "last7DaysFrom",
        boundaries.last_30_days_from::text AS "last30DaysFrom",
        boundaries.local_today::text AS "through"
      FROM boundaries
    `,
    [generatedAt],
  );

  const expectations = result.rows[0];

  if (!expectations) {
    throw new Error("Не удалось подготовить ожидания дашборда E2E.");
  }

  return expectations;
}

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
  const avatarUrl =
    "https://cdn4.telesco.pe/file/e2e-owner-avatar.svg";
  const missingAvatarUrl =
    "https://cdn4.telesco.pe/file/e2e-owner-avatar-missing.svg";
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
          $4::jsonb
        )
      `,
      [
        methodId,
        userId,
        `e2e-owner-${userId}`,
        JSON.stringify({ photoUrl: avatarUrl }),
      ],
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
          NULL,
          NULL,
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
    const dashboardFixture = await insertDashboardFixtures(
      database,
      userId,
    );
    await database.query("COMMIT");

    const anonymousAdminStart = await page.request.post(
      "/api/auth/telegram/start",
      {
        data: {
          privacyAccepted: true,
          redirectPath: "/admin",
        },
      },
    );
    const anonymousAdminStartPayload =
      await anonymousAdminStart.json();

    expect(anonymousAdminStart.status()).toBe(200);
    expect(anonymousAdminStartPayload).toEqual({
      authUrl: expect.any(String),
    });
    const administrativeState = new URL(
      anonymousAdminStartPayload.authUrl,
    ).searchParams.get("state");

    expect(administrativeState).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    await context.addCookies([
      {
        name: "academy_session",
        value: rawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    const racedAdminCallback = await page.request.get(
      `/api/auth/telegram/callback?state=${encodeURIComponent(
        administrativeState!,
      )}`,
      {
        maxRedirects: 0,
      },
    );

    expect(racedAdminCallback.status()).toBe(307);
    expect(racedAdminCallback.headers().location).toBe(
      `${baseUrl}/admin/verify?next=%2Fadmin`,
    );
    const clearedAdministrativeState =
      racedAdminCallback.headers()["set-cookie"] ?? "";

    expect(clearedAdministrativeState).toContain(
      "academy_telegram_state=;",
    );
    expect(clearedAdministrativeState).toContain("Max-Age=0");

    const existingSessionAdminStart = await page.request.post(
      "/api/auth/telegram/start",
      {
        data: {
          privacyAccepted: true,
          redirectPath: "/admin",
        },
      },
    );

    expect(existingSessionAdminStart.status()).toBe(200);
    await expect(
      existingSessionAdminStart.json(),
    ).resolves.toEqual({
      nextUrl: "/admin/verify?next=%2Fadmin",
    });
    expect(
      existingSessionAdminStart.headers()["set-cookie"] ?? "",
    ).not.toContain("academy_telegram_state=");

    const ordinarySession = await database.query<{
      adminVerifiedAt: Date | null;
      revokedAt: Date | null;
    }>(
      `
        SELECT
          admin_verified_at AS "adminVerifiedAt",
          revoked_at AS "revokedAt"
        FROM identity_sessions
        WHERE id = $1
      `,
      [sessionId],
    );

    expect(ordinarySession.rows[0]).toEqual({
      adminVerifiedAt: null,
      revokedAt: null,
    });

    await database.query(
      `
        UPDATE identity_sessions
        SET
          admin_verified_at = now(),
          admin_verification_method = 'telegram_oidc'
        WHERE id = $1
      `,
      [sessionId],
    );

    await page.route(avatarUrl, async (route) => {
      await route.fulfill({
        body: `
          <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
            <rect width="80" height="80" fill="#14233C"/>
            <circle cx="40" cy="32" r="16" fill="#F6F0E7"/>
          </svg>
        `,
        contentType: "image/svg+xml",
        status: 200,
      });
    });

    const adminResponse = await page.goto("/admin");

    expect(adminResponse?.status()).toBe(200);
    const generatedAt = await page
      .locator(".admin-dashboard-generated-at time")
      .getAttribute("datetime");

    if (!generatedAt) {
      throw new Error(
        "Дашборд не отобразил точное время снимка для E2E.",
      );
    }

    const dashboardExpectations = await readDashboardExpectations(
      database,
      generatedAt,
    );

    await expect(
      page.getByRole("heading", {
        name: "Обзор Академии",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Фактические показатели из PostgreSQL без демонстрационных значений и изменяющих команд.",
        { exact: true },
      ),
    ).toBeVisible();
    const activeStudentsCard = page.getByRole("article", {
      name: "Активные ученики",
      exact: true,
    });

    await expect(
      activeStudentsCard.locator(
        ".admin-dashboard-metric-value",
      ),
    ).toHaveText(
      dashboardExpectations.activeStudents.toLocaleString("ru-RU"),
    );
    await expect(
      activeStudentsCard.getByRole("link", {
        name: "Открыть список активных учеников",
        exact: true,
      }),
    ).toHaveAttribute("href", "/admin/students?status=active");

    const newStudentsCard = page.getByRole("article", {
      name: "Новые ученики",
      exact: true,
    });
    const periodValues = newStudentsCard.locator(
      ".admin-dashboard-period-values > div",
    );

    await expect(periodValues.nth(0).locator("strong")).toHaveText(
      dashboardExpectations.newStudentsLast7Days.toLocaleString(
        "ru-RU",
      ),
    );
    await expect(periodValues.nth(1).locator("strong")).toHaveText(
      dashboardExpectations.newStudentsLast30Days.toLocaleString(
        "ru-RU",
      ),
    );
    const newStudents7DaysHref =
      `/admin/students?status=not_deleted&from=` +
      `${dashboardExpectations.last7DaysFrom}&to=` +
      dashboardExpectations.through;
    const newStudents30DaysHref =
      `/admin/students?status=not_deleted&from=` +
      `${dashboardExpectations.last30DaysFrom}&to=` +
      dashboardExpectations.through;

    await expect(
      newStudentsCard.getByRole("link", {
        name: "Открыть новых учеников за 7 дней",
        exact: true,
      }),
    ).toHaveAttribute("href", newStudents7DaysHref);
    await expect(
      newStudentsCard.getByRole("link", {
        name: "Открыть новых учеников за 30 дней",
        exact: true,
      }),
    ).toHaveAttribute("href", newStudents30DaysHref);

    const drilldownPage = await context.newPage();

    try {
      const drilldownResponse = await drilldownPage.goto(
        newStudents7DaysHref,
      );

      expect(drilldownResponse?.status()).toBe(200);
      await expect(
        drilldownPage.locator("#student-status"),
      ).toHaveValue("not_deleted");
      await expect(
        drilldownPage.locator(".admin-data-table tbody tr"),
      ).toHaveCount(
        dashboardExpectations.newStudentsLast7Days,
      );
      await expect(
        drilldownPage.getByText(
          dashboardFixture.deletedStudentName,
          { exact: true },
        ),
      ).toHaveCount(0);
    } finally {
      await drilldownPage.close();
    }

    const activeAccessCard = page.getByRole("article", {
      name: "Действующий оплаченный доступ",
      exact: true,
    });

    await expect(
      activeAccessCard.locator(
        ".admin-dashboard-metric-value",
      ),
    ).toHaveText(
      dashboardExpectations.activePaidAccessStudents.toLocaleString(
        "ru-RU",
      ),
    );
    await expect(
      activeAccessCard.getByRole("link", {
        name: "Открыть учеников с действующим оплаченным доступом",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      "/admin/students?access=active&source=paid",
    );

    const pendingPaymentsCard = page.getByRole("article", {
      name: "Ожидают не менее 15 минут",
      exact: true,
    });

    await expect(
      pendingPaymentsCard.locator(
        ".admin-dashboard-signal-value",
      ),
    ).toHaveText(
      dashboardExpectations.stalePendingPayments.toLocaleString(
        "ru-RU",
      ),
    );

    const failedWebhooksCard = page.getByRole("article", {
      name: "Ошибки обработки webhook-событий",
      exact: true,
    });

    await expect(
      failedWebhooksCard.locator(
        ".admin-dashboard-signal-value",
      ),
    ).toHaveText(
      dashboardExpectations.failedWebhookEvents.toLocaleString(
        "ru-RU",
      ),
    );
    await expect(
      page.getByText("Часовой пояс: Europe/Moscow.", {
        exact: false,
      }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            window.innerWidth,
        ),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });

    const adminHomeLink = page.getByRole("link", {
      name: "На главную административной панели",
      exact: true,
    });

    await expect(adminHomeLink).toHaveAttribute("href", "/admin");
    await adminHomeLink.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", {
        name: "Обзор Академии",
        exact: true,
      }),
    ).toBeVisible();

    const adminAccountMenu = page.getByRole("button", {
      name: "Открыть меню аккаунта: E2E Владелец",
      exact: true,
    });
    const adminAvatar = adminAccountMenu.locator(
      "img.user-avatar-image",
    );

    await expect(adminAvatar).toBeVisible();
    await expect(adminAvatar).toHaveAttribute("src", avatarUrl);
    await expect(adminAccountMenu).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await adminAccountMenu.click();
    await expect(adminAccountMenu).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const adminAccountNavigation = page.getByRole("navigation", {
      name: "Переходы аккаунта",
      exact: true,
    });
    await expect(
      adminAccountNavigation.getByRole("link", {
        name: "Админка",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      adminAccountNavigation.getByRole("link", {
        name: "Профиль и вход",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Выйти",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("navigation", {
        name: "Переходы аккаунта",
        exact: true,
      })
      .getByRole("link", {
        name: "Личный кабинет",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const cabinetAccountMenu = page.getByRole("button", {
      name: "Открыть меню аккаунта: E2E Владелец",
      exact: true,
    });

    await expect(
      cabinetAccountMenu.locator("img.user-avatar-image"),
    ).toBeVisible();
    await cabinetAccountMenu.click();
    await page
      .getByRole("navigation", {
        name: "Переходы аккаунта",
        exact: true,
      })
      .getByRole("link", {
        name: "Админка",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.route(missingAvatarUrl, async (route) => {
      await route.abort("failed");
    });
    await database.query(
      `
        UPDATE identity_methods
        SET
          metadata = jsonb_build_object('photoUrl', $2::text),
          verified_at = now()
        WHERE id = $1
      `,
      [methodId, missingAvatarUrl],
    );
    await page.reload();
    await expect(
      page
        .getByRole("button", {
          name: "Открыть меню аккаунта: E2E Владелец",
          exact: true,
        })
        .locator(".user-avatar-fallback"),
    ).toHaveText("EВ");

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
