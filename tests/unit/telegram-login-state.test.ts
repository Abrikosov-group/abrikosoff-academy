import { describe, expect, it } from "vitest";
import {
  createTelegramLoginState,
  verifyTelegramLoginState,
} from "@/modules/identity/server/telegram-login-state";

const botToken = "123456:test-bot-token";
const consentVersion = "2026-07-28";
const issuedAt = new Date("2026-07-28T10:00:00.000Z");

describe("Telegram login state", () => {
  it("связывает маршрут и согласие с браузерным cookie", () => {
    const state = createTelegramLoginState(
      "/checkout?plan=annual",
      consentVersion,
      botToken,
      issuedAt,
    );

    expect(
      verifyTelegramLoginState(
        state.state,
        state.cookieValue,
        consentVersion,
        botToken,
        new Date("2026-07-28T10:05:00.000Z"),
      ),
    ).toEqual({
      redirectPath: "/checkout?plan=annual",
      consentVersion,
    });
  });

  it("отклоняет state из другого браузерного сценария", () => {
    const state = createTelegramLoginState(
      "/dashboard",
      consentVersion,
      botToken,
      issuedAt,
    );
    const otherState = createTelegramLoginState(
      "/dashboard",
      consentVersion,
      botToken,
      issuedAt,
    );

    expect(() =>
      verifyTelegramLoginState(
        otherState.state,
        state.cookieValue,
        consentVersion,
        botToken,
        issuedAt,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
        httpStatus: 401,
      }),
    );
  });

  it("отклоняет изменённое cookie", () => {
    const state = createTelegramLoginState(
      "/checkout?plan=annual",
      consentVersion,
      botToken,
      issuedAt,
    );
    const changedCookie = `${state.cookieValue.slice(0, -1)}0`;

    expect(() =>
      verifyTelegramLoginState(
        state.state,
        changedCookie,
        consentVersion,
        botToken,
        issuedAt,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
        httpStatus: 401,
      }),
    );
  });

  it("отклоняет просроченное начало входа", () => {
    const state = createTelegramLoginState(
      "/checkout?plan=annual",
      consentVersion,
      botToken,
      issuedAt,
    );

    expect(() =>
      verifyTelegramLoginState(
        state.state,
        state.cookieValue,
        consentVersion,
        botToken,
        new Date("2026-07-28T10:11:00.000Z"),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "LOGIN_EXPIRED",
        httpStatus: 400,
      }),
    );
  });

  it("не создаёт state с внешним маршрутом возврата", () => {
    expect(() =>
      createTelegramLoginState(
        "https://example.com",
        consentVersion,
        botToken,
        issuedAt,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
        httpStatus: 401,
      }),
    );
  });
});
