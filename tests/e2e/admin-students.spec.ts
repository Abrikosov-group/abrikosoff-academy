import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const baseUrl = "http://127.0.0.1:3200";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

function tokenSha256(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function insertIdentity(
  database: Client,
  input: {
    displayName: string;
    telegramSub: string;
    telegramUserId?: string;
    telegramUsername?: string;
    telegramProfileName?: string;
    telegramFirstName?: string;
    telegramLastName?: string;
    telegramPhotoUrl?: string;
    telegramRequestedScopes?: readonly string[];
    telegramTokenIssuedAt?: string;
    telegramTokenExpiresAt?: string;
    receiptEmail?: string;
    createdAt?: string;
  },
) {
  const userId = randomUUID();
  const methodId = randomUUID();
  const createdAt =
    input.createdAt ?? "2026-07-29T10:00:00.000Z";

  await database.query(
    `
      INSERT INTO identity_users (
        id,
        display_name,
        receipt_email,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'active', $4, $4)
    `,
    [
      userId,
      input.displayName,
      input.receiptEmail ?? null,
      createdAt,
    ],
  );
  await database.query(
    `
      INSERT INTO identity_methods (
        id,
        user_id,
        method_type,
        identifier,
        verified_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'telegram',
        $3,
        $4,
        $5::jsonb,
        $4,
        $4
      )
    `,
    [
      methodId,
      userId,
      input.telegramSub,
      createdAt,
      JSON.stringify({
        profileMetadataVersion: 1,
        telegramUserId: input.telegramUserId,
        username: input.telegramUsername,
        profileName: input.telegramProfileName,
        firstName: input.telegramFirstName,
        lastName: input.telegramLastName,
        photoUrl: input.telegramPhotoUrl,
        requestedScopes: input.telegramRequestedScopes,
        tokenIssuedAt: input.telegramTokenIssuedAt,
        tokenExpiresAt: input.telegramTokenExpiresAt,
      }),
    ],
  );

  return { userId, methodId };
}

async function insertSession(
  database: Client,
  input: {
    userId: string;
    methodId: string;
    rawToken: string;
    adminVerified?: boolean;
  },
) {
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
        user_agent_family,
        client_ip,
        country_code,
        region,
        region_code,
        city,
        client_timezone,
        browser_version,
        operating_system,
        operating_system_version,
        device_type,
        device_vendor,
        device_model,
        client_architecture,
        client_bitness,
        preferred_language,
        raw_user_agent,
        cloudflare_ray_id,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        now() + interval '1 day',
        now(),
        'telegram_oidc',
        $4,
        CASE WHEN $5::boolean THEN now() ELSE NULL END,
        CASE
          WHEN $5::boolean THEN 'telegram_oidc'
          ELSE NULL
        END,
        'Google Chrome',
        '203.0.113.42',
        'RU',
        'Москва',
        'MOW',
        'Москва',
        'Europe/Moscow',
        '138.0.0.0',
        'macOS',
        '15.5',
        'desktop',
        'Apple',
        'Mac',
        'arm',
        '64',
        'ru-RU',
        'E2E Chrome on macOS',
        '9abcdef012345678-DME',
        now()
      )
    `,
    [
      randomUUID(),
      input.userId,
      tokenSha256(input.rawToken),
      input.methodId,
      input.adminVerified ?? false,
    ],
  );
}

async function insertPaidAccess(
  database: Client,
  userId: string,
) {
  const orderId = randomUUID();

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
        offer_version,
        receipt_email
      )
      VALUES (
        $1,
        $2,
        'annual',
        'ip-fedotova',
        'RU',
        1400000,
        'RUB',
        'paid',
        $3,
        'demo',
        'admin-e2e',
        now(),
        'e2e',
        'target-receipt@example.test'
      )
    `,
    [orderId, userId, randomUUID()],
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
        paid_at
      )
      VALUES (
        $1,
        $2,
        'demo',
        'admin-e2e',
        $3,
        $4,
        'succeeded',
        1400000,
        'RUB',
        now()
      )
    `,
    [randomUUID(), orderId, randomUUID(), randomUUID()],
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
    [orderId, userId],
  );
}

test("владелец ищет ученика, отзывает сессии и листает курсором", async ({
  context,
  page,
}) => {
  const database = new Client({
    connectionString: testDatabaseUrl,
    application_name: "academy-admin-students-e2e",
  });
  const ordinaryRawToken = `${randomUUID()}${randomUUID()}`;
  const adminRawToken = `${randomUUID()}${randomUUID()}`;

  await database.connect();

  try {
    const ordinary = await insertIdentity(database, {
      displayName: "Обычный E2E пользователь",
      telegramSub: `ordinary-${randomUUID()}`,
    });
    await insertSession(database, {
      ...ordinary,
      rawToken: ordinaryRawToken,
    });
    const owner = await insertIdentity(database, {
      displayName: "Владелец списка E2E",
      telegramSub: `owner-${randomUUID()}`,
    });
    await insertSession(database, {
      ...owner,
      rawToken: adminRawToken,
      adminVerified: true,
    });
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
          'Подготовка владельца списка учеников E2E'
        )
      `,
      [randomUUID(), owner.userId],
    );
    const target = await insertIdentity(database, {
      displayName: "Целевой Ученик E2E",
      telegramSub: "e2e-target-telegram-sub",
      telegramUserId: "7739870613",
      telegramUsername: "e2e_target_student",
      telegramProfileName: "Целевой Ученик E2E",
      telegramFirstName: "Целевой",
      telegramLastName: "Ученик E2E",
      telegramPhotoUrl:
        "https://cdn4.telesco.pe/file/e2e-avatar.jpg",
      telegramRequestedScopes: ["openid", "profile"],
      telegramTokenIssuedAt: "2026-07-29T09:59:00.000Z",
      telegramTokenExpiresAt: "2026-07-29T10:09:00.000Z",
      receiptEmail: "target-receipt@example.test",
    });
    await insertSession(database, {
      ...target,
      rawToken: `${randomUUID()}${randomUUID()}`,
    });
    for (let index = 0; index < 5; index += 1) {
      await insertSession(database, {
        ...target,
        rawToken: `${randomUUID()}${randomUUID()}`,
      });
    }
    await insertPaidAccess(database, target.userId);

    for (let index = 0; index < 26; index += 1) {
      await insertIdentity(database, {
        displayName: `E2E Курсор ${String(index).padStart(2, "0")}`,
        telegramSub: `e2e-cursor-${randomUUID()}`,
        createdAt: new Date(
          Date.UTC(2026, 6, 20, 0, index),
        ).toISOString(),
      });
    }

    await context.addCookies([
      {
        name: "academy_session",
        value: ordinaryRawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const forbiddenResponse = await page.goto("/admin/students");

    expect(forbiddenResponse?.status()).toBe(403);
    await expect(
      page.getByRole("heading", {
        name: "Нет доступа к панели",
      }),
    ).toBeVisible();
    const revokeSessionsEndpoint =
      `/api/admin/students/${target.userId}/sessions/revoke`;

    for (const probedUserId of [
      target.userId,
      randomUUID(),
    ]) {
      const deniedCommand = await page.request.post(
        `/api/admin/students/${probedUserId}/sessions/revoke`,
        {
          data: {
            reason: "support_security_measure",
          },
          headers: {
            "Idempotency-Key": randomUUID(),
            Origin: baseUrl,
          },
        },
      );

      expect(deniedCommand.status()).toBe(403);
      await expect(deniedCommand.json()).resolves.toMatchObject({
        error: {
          code: "ADMIN_ROLE_REQUIRED",
        },
        requestId: expect.any(String),
      });
    }

    await context.addCookies([
      {
        name: "academy_session",
        value: adminRawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin");
    const studentsNavigation = page.getByRole("link", {
      name: "Ученики",
      exact: true,
    });

    await expect(studentsNavigation).toBeVisible();
    await studentsNavigation.click();
    await expect(page).toHaveURL(/\/admin\/students$/);
    await expect(studentsNavigation).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page
      .getByLabel("Найти ученика")
      .fill("Ученик E2E");
    await page
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(
      page.getByRole("link", {
        name: /Целевой Ученик E2E/,
      }),
    ).toBeVisible();

    await page
      .getByLabel("Найти ученика")
      .fill("7739870613");
    await page
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(
      page.getByRole("link", {
        name: /Целевой Ученик E2E/,
      }),
    ).toBeVisible();

    await page
      .getByLabel("Найти ученика")
      .fill("@e2e_target_student");
    await page
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    const targetLink = page.getByRole("link", {
      name: /Целевой Ученик E2E/,
    });

    await expect(targetLink).toBeVisible();
    await expect(
      page.getByText("Доступ активен", { exact: true }),
    ).toBeVisible();
    await targetLink.click();
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/admin/students/${target.userId}`);
    await expect(
      page.getByRole("link", {
        name: "← Все ученики",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      /\/admin\/students\?q=%40e2e_target_student/u,
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Целевой Ученик E2E",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Активен", {
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("target-receipt@example.test", {
        exact: true,
      }),
    ).toBeVisible();
    for (const sectionName of [
      "Обзор",
      "Доступ и оплаты",
      "Вход и безопасность",
      "Сессии",
    ]) {
      await expect(
        page
          .getByRole("navigation", {
            name: "Разделы карточки ученика",
          })
          .getByRole("link", {
            name: sectionName,
            exact: true,
          }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("heading", {
        name: "Доступ и оплаты",
        exact: true,
      }),
    ).toBeVisible();
    const telegramSection = page.locator(
      'section[aria-labelledby="student-identity-heading"]',
    );

    await expect(
      telegramSection.getByRole("heading", {
        name: "Вход и безопасность",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      telegramSection.getByRole("heading", {
        name: "Проверенные данные Telegram",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      telegramSection.getByText("7739870613", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      telegramSection.getByText("openid", { exact: true }),
    ).toBeVisible();
    await expect(
      telegramSection.getByText("profile", { exact: true }),
    ).toBeVisible();

    const telegramDetails = telegramSection.locator(
      ".admin-telegram-more",
    );

    await expect(telegramDetails).not.toHaveAttribute("open", "");
    await telegramDetails
      .getByText("Технические данные OpenID Connect", {
        exact: true,
      })
      .click();
    await expect(telegramDetails).toHaveAttribute("open", "");
    await expect(
      telegramDetails
        .locator("dd")
        .filter({ hasText: /^@e2e_target_student$/u }),
    ).toBeVisible();
    await expect(
      telegramDetails.getByText("e2e-target-telegram-sub", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      telegramDetails.getByText("Целевой", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      telegramDetails.getByText("Ученик E2E", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      telegramDetails.getByText(
        "Подпись, issuer, audience, nonce и срок действия проверены",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Токены, nonce, коды авторизации и секреты не сохраняются.",
        { exact: false },
      ),
    ).toBeVisible();
    const sessionCard = page.locator(".admin-session-card").first();

    await context.grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: baseUrl },
    );
    const sessionSummary = sessionCard.locator(
      ".admin-session-summary-compact",
    );

    await expect(
      sessionSummary.getByText("IPv4", { exact: true }),
    ).toBeVisible();
    await expect(
      sessionSummary.getByText("203.0.113.42", { exact: true }),
    ).toBeVisible();
    await expect(
      sessionSummary.getByText("Сессия создана", { exact: true }),
    ).toBeVisible();
    await expect(
      sessionSummary.getByText("Активность", { exact: true }),
    ).toHaveCount(0);
    const copyIpButton = sessionSummary.locator(
      ".admin-copy-button",
    );

    await expect(copyIpButton).toHaveAttribute(
      "aria-label",
      "Скопировать IP-адрес 203.0.113.42",
    );
    await copyIpButton.click();
    await expect(copyIpButton).toHaveAttribute(
      "data-copy-state",
      "copied",
    );
    await expect
      .poll(() =>
        page.evaluate(() => navigator.clipboard.readText()),
      )
      .toBe("203.0.113.42");
    await expect(
      sessionCard.getByText(
        "Google Chrome · 138.0.0.0 · macOS · 15.5 · Apple Mac",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(
      sessionSummary.getByText("Россия · Москва · MOW", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      sessionCard.getByText("Telegram", { exact: true }),
    ).toBeVisible();

    const technicalDetails = sessionCard.locator(
      ".admin-session-more",
    );

    await expect(technicalDetails).not.toHaveAttribute(
      "open",
      "",
    );
    await technicalDetails
      .getByText("Технические данные", { exact: false })
      .click();
    await expect(technicalDetails).toHaveAttribute("open", "");
    await expect(
      sessionCard.getByText("arm · 64 бит", { exact: true }),
    ).toBeVisible();
    await expect(
      sessionCard.getByText("E2E Chrome on macOS", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .locator(".admin-session-list")
        .first()
        .locator(":scope > .admin-session-card"),
    ).toHaveCount(5);
    const additionalSessions = page.locator(
      ".admin-session-overflow",
    );

    await expect(additionalSessions).not.toHaveAttribute("open", "");
    await expect(
      additionalSessions.getByText("Показать ещё 1 сессия", {
        exact: true,
      }),
    ).toBeVisible();
    await additionalSessions
      .getByText("Показать ещё 1 сессия", {
        exact: true,
      })
      .click();
    await expect(additionalSessions).toHaveAttribute("open", "");
    await expect(
      additionalSessions.locator(".admin-session-card"),
    ).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Целевой Ученик E2E",
        exact: true,
      }),
    ).toBeVisible();
    const studentDetailHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        window.innerWidth + 1,
    );

    expect(studentDetailHorizontalOverflow).toBe(false);
    const mobileSessionBox = await page
      .locator(".admin-session-card")
      .first()
      .boundingBox();
    const mobileCopyButtonBox = await page
      .locator(".admin-session-summary-compact .admin-copy-button")
      .first()
      .boundingBox();

    expect(mobileSessionBox).not.toBeNull();
    expect(mobileSessionBox?.height).toBeLessThanOrEqual(280);
    expect(mobileCopyButtonBox).not.toBeNull();
    expect(mobileCopyButtonBox?.width).toBeGreaterThanOrEqual(44);
    expect(mobileCopyButtonBox?.height).toBeGreaterThanOrEqual(44);

    const activeBeforeCommand = await database.query<{
      count: number;
    }>(
      `
        SELECT count(*)::integer AS count
        FROM identity_sessions
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > now()
      `,
      [target.userId],
    );

    expect(activeBeforeCommand.rows[0]?.count).toBe(6);

    const getCommandResponse = await page.request.get(
      revokeSessionsEndpoint,
    );

    expect(getCommandResponse.status()).toBe(405);

    const foreignOriginResponse = await page.request.post(
      revokeSessionsEndpoint,
      {
        data: {
          reason: "support_security_measure",
        },
        headers: {
          "Idempotency-Key": randomUUID(),
          Origin: "https://evil.example",
        },
      },
    );

    expect(foreignOriginResponse.status()).toBe(403);
    await expect(
      foreignOriginResponse.json(),
    ).resolves.toMatchObject({
      error: {
        code: "ADMIN_PERMISSION_DENIED",
      },
      requestId: expect.any(String),
    });

    const unknownFieldResponse = await page.request.post(
      revokeSessionsEndpoint,
      {
        data: {
          reason: "support_security_measure",
          unexpected: true,
        },
        headers: {
          "Idempotency-Key": randomUUID(),
          Origin: baseUrl,
        },
      },
    );

    expect(unknownFieldResponse.status()).toBe(400);
    await expect(
      unknownFieldResponse.json(),
    ).resolves.toMatchObject({
      error: {
        code: "ADMIN_COMMAND_INVALID_REQUEST",
      },
      requestId: expect.any(String),
    });

    const arbitraryReasonResponse = await page.request.post(
      revokeSessionsEndpoint,
      {
        data: {
          reason:
            "Ученик student@example.com прислал секретный токен",
        },
        headers: {
          "Idempotency-Key": randomUUID(),
          Origin: baseUrl,
        },
      },
    );

    expect(arbitraryReasonResponse.status()).toBe(400);
    await expect(
      arbitraryReasonResponse.json(),
    ).resolves.toMatchObject({
      error: {
        code: "ADMIN_COMMAND_INVALID_REQUEST",
      },
      requestId: expect.any(String),
    });

    const stillActiveBeforeUi = await database.query<{
      count: number;
    }>(
      `
        SELECT count(*)::integer AS count
        FROM identity_sessions
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > now()
      `,
      [target.userId],
    );

    expect(stillActiveBeforeUi.rows[0]?.count).toBe(6);

    const revokeButton = page.getByRole("button", {
      name: "Отозвать все активные сессии",
      exact: true,
    });

    await expect(revokeButton).toBeVisible();
    await revokeButton.click();
    const commandDialog = page.getByRole("dialog", {
      name: "Отозвать все сессии?",
    });
    const reasonField = commandDialog.getByLabel(
      "Причина отзыва",
    );

    await expect(commandDialog).toBeVisible();
    await expect(
      commandDialog.getByText(
        "6 сессий. На всех устройствах потребуется войти заново.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(reasonField).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(commandDialog).not.toBeVisible();

    await revokeButton.click();
    await expect(reasonField).toHaveValue("");
    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(reasonField).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      commandDialog.getByText("Выберите причину отзыва.", {
        exact: true,
      }),
    ).toBeVisible();
    await reasonField.selectOption(
      "suspected_unauthorized_access",
    );
    await expect(reasonField).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    let abortedIdempotencyKey: string | undefined;

    await page.route(
      `**${revokeSessionsEndpoint}`,
      async (route) => {
        abortedIdempotencyKey =
          route.request().headers()["idempotency-key"];
        await route.abort("failed");
      },
      { times: 1 },
    );
    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(commandDialog).toBeVisible();
    await expect(
      commandDialog.getByRole("alert"),
    ).toBeVisible();
    await expect(reasonField).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    let supersededIdempotencyKey: string | undefined;

    await page.route(
      `**${revokeSessionsEndpoint}`,
      async (route) => {
        supersededIdempotencyKey =
          route.request().headers()["idempotency-key"];
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "COMMAND_ATTEMPT_SUPERSEDED",
              message:
                "Операция уже продолжена другой попыткой.",
            },
            requestId: randomUUID(),
          }),
        });
      },
      { times: 1 },
    );
    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(commandDialog.getByRole("alert")).toContainText(
      "Операция уже продолжена",
    );
    expect(supersededIdempotencyKey).toBe(
      abortedIdempotencyKey,
    );
    let recoveryIdempotencyKey: string | undefined;

    await page.route(
      `**${revokeSessionsEndpoint}`,
      async (route) => {
        recoveryIdempotencyKey =
          route.request().headers()["idempotency-key"];
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "COMMAND_RECOVERY_REQUIRED",
              message:
                "Не удалось подтвердить итог операции. Повторите этот же запрос позже.",
            },
            requestId: randomUUID(),
          }),
        });
      },
      { times: 1 },
    );
    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(commandDialog.getByRole("alert")).toContainText(
      "Не удалось подтвердить итог операции",
    );
    expect(recoveryIdempotencyKey).toBe(
      supersededIdempotencyKey,
    );
    let ambiguousIdempotencyKey: string | undefined;

    await page.route(
      `**${revokeSessionsEndpoint}`,
      async (route) => {
        ambiguousIdempotencyKey =
          route.request().headers()["idempotency-key"];
        await route.fulfill({
          status: 504,
          contentType: "text/plain",
          body: "Gateway Timeout",
        });
      },
      { times: 1 },
    );
    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(commandDialog.getByRole("alert")).toContainText(
      "Не удалось отозвать сессии",
    );
    expect(ambiguousIdempotencyKey).toBe(
      recoveryIdempotencyKey,
    );
    let failedIdempotencyKey: string | undefined;

    await page.route(
      `**${revokeSessionsEndpoint}`,
      async (route) => {
        failedIdempotencyKey =
          route.request().headers()["idempotency-key"];
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "REVOKE_USER_SESSIONS_FAILED",
              message:
                "Не удалось отозвать сессии. Повторите попытку позже.",
            },
            requestId: randomUUID(),
          }),
        });
      },
      { times: 1 },
    );
    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(commandDialog.getByRole("alert")).toContainText(
      "Не удалось отозвать сессии",
    );
    expect(failedIdempotencyKey).toBe(
      ambiguousIdempotencyKey,
    );

    const commandResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(revokeSessionsEndpoint) &&
        response.request().method() === "POST",
    );

    await commandDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    const commandResponse = await commandResponsePromise;
    const commandPayload = (await commandResponse.json()) as {
      activeSessionCount: number;
      currentSessionRevoked: boolean;
      requestId: string;
      revokedSessionCount: number;
    };
    const commandIdempotencyKey =
      commandResponse.request().headers()[
        "idempotency-key"
      ];

    expect(commandResponse.status()).toBe(200);
    expect(commandPayload).toMatchObject({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      requestId: expect.any(String),
      revokedSessionCount: 6,
    });
    expect(commandIdempotencyKey).toEqual(
      expect.any(String),
    );
    expect(commandIdempotencyKey).not.toBe(
      failedIdempotencyKey,
    );
    await expect(commandDialog).not.toBeVisible();
    await expect(
      page.getByText("6 сессий отозвано.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(revokeButton).toHaveCount(0);
    await expect(
      page
        .locator(".admin-session-card")
        .locator(
          ".admin-session-compact-heading .badge",
        )
        .filter({ hasText: /^Отозвана$/u }),
    ).toHaveCount(6);

    const repeatedResponse = await page.request.post(
      revokeSessionsEndpoint,
      {
        data: {
          reason: "suspected_unauthorized_access",
        },
        headers: {
          "Idempotency-Key": commandIdempotencyKey!,
          Origin: baseUrl,
        },
      },
    );

    expect(repeatedResponse.status()).toBe(200);
    await expect(repeatedResponse.json()).resolves.toMatchObject({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      requestId: expect.any(String),
      revokedSessionCount: 6,
    });

    const conflictResponse = await page.request.post(
      revokeSessionsEndpoint,
      {
        data: {
          reason: "student_requested_sign_out",
        },
        headers: {
          "Idempotency-Key": commandIdempotencyKey!,
          Origin: baseUrl,
        },
      },
    );

    expect(conflictResponse.status()).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      error: {
        code: "IDEMPOTENCY_CONFLICT",
      },
      requestId: expect.any(String),
    });

    const persistedCommand = await database.query<{
      execution_count: number;
      audit_count: number;
      revoked_count: number;
      active_count: number;
    }>(
      `
        SELECT
          (
            SELECT count(*)::integer
            FROM admin_command_executions execution
            WHERE execution.principal_key = $1
              AND execution.action =
                'identity.sessions.revoke_all'
              AND execution.idempotency_key = $2
              AND execution.status = 'succeeded'
          ) AS execution_count,
          (
            SELECT count(*)::integer
            FROM admin_audit_events audit
            JOIN admin_command_executions execution
              ON execution.id = audit.command_execution_id
            WHERE execution.principal_key = $1
              AND execution.action =
                'identity.sessions.revoke_all'
              AND execution.idempotency_key = $2
              AND audit.outcome = 'succeeded'
          ) AS audit_count,
          (
            SELECT count(*)::integer
            FROM identity_sessions
            WHERE user_id = $3
              AND revoked_at IS NOT NULL
          ) AS revoked_count,
          (
            SELECT count(*)::integer
            FROM identity_sessions
            WHERE user_id = $3
              AND revoked_at IS NULL
              AND expires_at > now()
          ) AS active_count
      `,
      [
        `user:${owner.userId}`,
        commandIdempotencyKey,
        target.userId,
      ],
    );

    expect(persistedCommand.rows[0]).toEqual({
      execution_count: 1,
      audit_count: 1,
      revoked_count: 6,
      active_count: 0,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/students?q=E2E+Курсор&limit=25");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page
      .getByRole("link", {
        name: "Следующая страница",
        exact: true,
      })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(
      page.getByRole("link", {
        name: "Следующая страница",
        exact: true,
      }),
    ).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(
      page.getByRole("link", {
        name: "Ученики",
        exact: true,
      }),
    ).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        window.innerWidth + 1,
    );

    expect(horizontalOverflow).toBe(false);

    await page.goto(
      `/admin/students/${owner.userId}`,
    );
    const selfRevokeButton = page.getByRole("button", {
      name: "Отозвать все активные сессии",
      exact: true,
    });

    await expect(selfRevokeButton).toBeVisible();
    await selfRevokeButton.click();
    const selfRevokeDialog = page.getByRole("dialog", {
      name: "Отозвать все сессии?",
    });

    await expect(
      selfRevokeDialog.getByText(
        "Текущая административная сессия тоже завершится.",
        { exact: false },
      ),
    ).toBeVisible();
    await selfRevokeDialog
      .getByLabel("Причина отзыва")
      .selectOption("support_security_measure");
    const selfRevokeEndpoint =
      `/api/admin/students/${owner.userId}/sessions/revoke`;
    let lostSelfResponse:
      | {
          activeSessionCount: number;
          currentSessionRevoked: boolean;
          revokedSessionCount: number;
        }
      | undefined;
    let lostSelfIdempotencyKey: string | undefined;

    await page.route(
      `**${selfRevokeEndpoint}`,
      async (route) => {
        lostSelfIdempotencyKey =
          route.request().headers()["idempotency-key"];
        const committedResponse = await route.fetch();

        expect(committedResponse.status()).toBe(200);
        lostSelfResponse =
          (await committedResponse.json()) as typeof lostSelfResponse;
        await route.abort("failed");
      },
      { times: 1 },
    );
    await selfRevokeDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();
    await expect(
      selfRevokeDialog.getByRole("alert"),
    ).toBeVisible();
    expect(lostSelfResponse).toMatchObject({
      activeSessionCount: 0,
      currentSessionRevoked: true,
      revokedSessionCount: expect.any(Number),
    });

    let repeatedSelfResponseStatus: number | undefined;
    let repeatedSelfResponsePayload:
      | {
          error: {
            code: string;
          };
          requestId: string;
        }
      | undefined;
    let repeatedSelfIdempotencyKey: string | undefined;

    await page.route(
      `**${selfRevokeEndpoint}`,
      async (route) => {
        repeatedSelfIdempotencyKey =
          route.request().headers()["idempotency-key"];
        const response = await route.fetch();

        repeatedSelfResponseStatus = response.status();
        repeatedSelfResponsePayload =
          (await response.json()) as typeof repeatedSelfResponsePayload;
        await route.fulfill({ response });
      },
      { times: 1 },
    );

    await selfRevokeDialog
      .getByRole("button", {
        name: "Отозвать сессии",
        exact: true,
      })
      .click();

    await expect(page).toHaveURL(/\/login\?next=/u);
    expect(repeatedSelfResponseStatus).toBe(401);
    expect(repeatedSelfResponsePayload).toMatchObject({
      error: {
        code: "ADMIN_AUTH_REQUIRED",
      },
      requestId: expect.any(String),
    });
    expect(repeatedSelfIdempotencyKey).toBe(
      lostSelfIdempotencyKey,
    );

    const remainingSessionCookie = (
      await context.cookies(baseUrl)
    ).find((cookie) => cookie.name === "academy_session");
    const ownerSession = await database.query<{
      revoked_at: Date | null;
    }>(
      `
        SELECT revoked_at
        FROM identity_sessions
        WHERE token_sha256 = $1
      `,
      [tokenSha256(adminRawToken)],
    );

    expect(remainingSessionCookie).toBeUndefined();
    expect(ownerSession.rows[0]?.revoked_at).toBeInstanceOf(
      Date,
    );
  } finally {
    await database.end();
  }
});
