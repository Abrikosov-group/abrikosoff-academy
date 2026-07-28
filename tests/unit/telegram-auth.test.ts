import {
  createHash,
  createHmac,
} from "node:crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { verifyTelegramLogin } from "@/modules/identity/server/telegram-auth";

const botToken = "123456:telegram-test-token";
const now = new Date("2026-07-28T08:00:00.000Z");

function createTelegramPayload(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(now.getTime() / 1_000)),
    first_name: "Анна",
    id: "123456789",
    last_name: "Иванова",
    username: "anna",
    ...overrides,
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params;
}

describe("verifyTelegramLogin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("принимает подлинную и свежую подпись Telegram", () => {
    const identity = verifyTelegramLogin(
      createTelegramPayload(),
      botToken,
    );

    expect(identity).toEqual({
      id: "123456789",
      displayName: "Анна Иванова",
      metadata: {
        username: "anna",
        photoUrl: undefined,
      },
    });
  });

  it("отклоняет изменённые после подписи данные", () => {
    const params = createTelegramPayload();
    params.set("first_name", "Другая");

    expect(() => verifyTelegramLogin(params, botToken)).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
        httpStatus: 401,
      }),
    );
  });

  it("отклоняет подтверждение старше десяти минут", () => {
    const params = createTelegramPayload({
      auth_date: String(
        Math.floor((now.getTime() - 11 * 60_000) / 1_000),
      ),
    });

    expect(() => verifyTelegramLogin(params, botToken)).toThrowError(
      expect.objectContaining({
        code: "LOGIN_EXPIRED",
        httpStatus: 400,
      }),
    );
  });
});
