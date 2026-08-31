import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const baseUrl = "http://127.0.0.1:3200";
const lessonPath = "/courses/healthy-habits/lessons/1";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";

async function insertUserWithSession(
  database: Client,
  displayName: string,
  admin: boolean,
) {
  const userId = randomUUID();
  const methodId = randomUUID();
  const rawToken = `${randomUUID()}${randomUUID()}`;
  await database.query(
    "INSERT INTO identity_users (id, display_name, status) VALUES ($1, $2, 'active')",
    [userId, displayName],
  );
  await database.query(
    `
      INSERT INTO identity_methods (
        id, user_id, method_type, identifier, verified_at, metadata
      ) VALUES ($1, $2, 'telegram', $3, now(), '{}'::jsonb)
    `,
    [methodId, userId, `manual-e2e-${userId}`],
  );
  await database.query(
    `
      INSERT INTO identity_sessions (
        id, user_id, token_sha256, expires_at, authenticated_at,
        authentication_method, authentication_method_id,
        admin_verified_at, admin_verification_method
      ) VALUES (
        $1, $2, $3, now() + interval '1 day', now(),
        'telegram_oidc', $4,
        CASE WHEN $5 THEN now() ELSE NULL END,
        CASE WHEN $5 THEN 'telegram_oidc' ELSE NULL END
      )
    `,
    [
      randomUUID(),
      userId,
      createHash("sha256").update(rawToken).digest("hex"),
      methodId,
      admin,
    ],
  );
  if (admin) {
    await database.query(
      `
        INSERT INTO admin_role_assignments (
          id, user_id, role, status, granted_by_kind, grant_reason
        ) VALUES (
          $1, $2, 'owner', 'active', 'system',
          'Подготовка E2E ручной выдачи доступа'
        )
      `,
      [randomUUID(), userId],
    );
  }
  return { userId, rawToken };
}

test("владелец выдаёт и отзывает ручной доступ через штатный интерфейс", async ({
  context,
  page,
}) => {
  const database = new Client({ connectionString: testDatabaseUrl });
  await database.connect();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const owner = await insertUserWithSession(
      database,
      "Владелец ручной выдачи E2E",
      true,
    );
    const studentDisplayName = "Ученик ручной выдачи E2E";
    const student = await insertUserWithSession(
      database,
      studentDisplayName,
      false,
    );
    await context.addCookies([
      {
        name: "academy_session",
        value: owner.rawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`/admin/students/${student.userId}`);
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 10 * 86_400_000);
    const localValue = (date: Date) => {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0, 16);
    };
    await expect(page.getByLabel("Начало периода")).not.toHaveValue("");
    async function grant(reason: string) {
      await page.getByLabel("Начало периода").fill(localValue(start));
      await page.getByLabel("Окончание периода").fill(localValue(end));
      await page
        .getByRole("textbox", { name: /Причина \d+\/500 символов/u })
        .fill(reason);
      await page
        .getByRole("button", { name: "Проверить и продолжить" })
        .click();
    }
    await grant("Первый доступ по решению владельца для E2E проверки");
    await expect(page.getByText("Пересечений с ручными периодами: 0")).toBeVisible();
    await page.getByRole("button", { name: "Подтвердить выдачу" }).click();
    await expect(page.getByText("Ручной доступ успешно выдан.")).toBeVisible();
    await expect(page.getByText("Ручные основания")).toBeVisible();
    await grant("Второй пересекающийся доступ сохраняет доступ после отзыва");
    await expect(page.getByText("Пересечений с ручными периодами: 1")).toBeVisible();
    await page.getByRole("button", { name: "Подтвердить выдачу" }).click();
    await expect(page.getByText("Ручной доступ успешно выдан.")).toBeVisible();

    await page.goto(`/admin/access?q=${encodeURIComponent(studentDisplayName)}`);
    await expect(
      page.getByRole("heading", { name: "Выберите ученика для выдачи" }),
    ).toBeVisible();
    await page
      .locator(".admin-access-student-choice-list")
      .getByRole("link", { name: new RegExp(studentDisplayName, "u") })
      .click();
    await expect(
      page.getByRole("heading", { name: "Выдать ручной доступ" }),
    ).toBeVisible();

    await context.clearCookies();
    await context.addCookies([
      {
        name: "academy_session",
        value: student.rawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/dashboard/courses");
    await expect(
      page.getByRole("link", { name: "Открыть первый урок" }),
    ).toHaveAttribute("href", lessonPath);
    await page.goto(lessonPath);
    await expect(page).toHaveURL(new RegExp(`${lessonPath}$`));

    await context.clearCookies();
    await context.addCookies([
      {
        name: "academy_session",
        value: owner.rawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`/admin/students/${student.userId}`);
    const revokeCommand = page.locator(".admin-inline-command").first();
    await revokeCommand
      .getByRole("button", { name: "Отозвать ручной доступ" })
      .click();
    await revokeCommand
      .getByRole("textbox", {
        name: /Причина отзыва 0\/500 символов/u,
      })
      .fill("Ручной период отозван после успешной E2E проверки");
    await revokeCommand
      .getByRole("button", { name: "Подтвердить отзыв" })
      .click();
    await expect(page.getByText("Ручной доступ отозван. История сохранена.")).toBeVisible();

    await context.clearCookies();
    await context.addCookies([
      {
        name: "academy_session",
        value: student.rawToken,
        url: baseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(lessonPath);
    await expect(page).toHaveURL(new RegExp(`${lessonPath}$`));

    const persisted = await database.query<{
      granted: number;
      revoked: number;
      payments: number;
    }>(
      `
        SELECT
          (SELECT count(*)::integer FROM access_manual_grants WHERE customer_id = $1 AND status = 'granted') AS granted,
          (SELECT count(*)::integer FROM access_manual_grants WHERE customer_id = $1 AND status = 'revoked') AS revoked,
          (SELECT count(*)::integer FROM billing_orders WHERE customer_id = $1) AS payments
      `,
      [student.userId],
    );
    expect(persisted.rows[0]).toEqual({ granted: 1, revoked: 1, payments: 0 });
  } finally {
    await database.end();
  }
});
