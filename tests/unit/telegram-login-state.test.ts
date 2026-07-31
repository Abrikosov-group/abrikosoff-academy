import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createTelegramLoginState,
  verifyTelegramLoginState,
} from "@/modules/identity/server/telegram-login-state";

const clientSecret = "telegram-oidc-client-secret-for-tests";
const consentVersion = "2026-07-28";
const issuedAt = new Date("2026-07-28T10:00:00.000Z");

describe("Telegram login state", () => {
  it("связывает маршрут и согласие с браузерным cookie", () => {
    const state = createTelegramLoginState(
      "/checkout?plan=annual",
      consentVersion,
      clientSecret,
      issuedAt,
    );
    const verified = verifyTelegramLoginState(
      state.state,
      state.cookieValue,
      consentVersion,
      clientSecret,
      new Date("2026-07-28T10:05:00.000Z"),
    );

    expect(verified).toEqual({
      redirectPath: "/checkout?plan=annual",
      consentVersion,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      purpose: "login",
    });
    expect(state.codeChallenge).toBe(
      createHash("sha256")
        .update(verified.codeVerifier)
        .digest("base64url"),
    );
    expect(state.nonce).toBe(verified.nonce);
  });

  it("отклоняет state из другого браузерного сценария", () => {
    const state = createTelegramLoginState(
      "/dashboard",
      consentVersion,
      clientSecret,
      issuedAt,
    );
    const otherState = createTelegramLoginState(
      "/dashboard",
      consentVersion,
      clientSecret,
      issuedAt,
    );

    expect(() =>
      verifyTelegramLoginState(
        otherState.state,
        state.cookieValue,
        consentVersion,
        clientSecret,
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
      clientSecret,
      issuedAt,
    );
    const lastCharacter = state.cookieValue.at(-1);
    const changedCookie = `${state.cookieValue.slice(0, -1)}${
      lastCharacter === "0" ? "1" : "0"
    }`;

    expect(() =>
      verifyTelegramLoginState(
        state.state,
        changedCookie,
        consentVersion,
        clientSecret,
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
      clientSecret,
      issuedAt,
    );

    expect(() =>
      verifyTelegramLoginState(
        state.state,
        state.cookieValue,
        consentVersion,
        clientSecret,
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
        clientSecret,
        issuedAt,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
        httpStatus: 401,
      }),
    );
  });

  it("связывает административное подтверждение с точной сессией", () => {
    const state = createTelegramLoginState(
      "/admin",
      consentVersion,
      clientSecret,
      issuedAt,
      {
        purpose: "admin",
        requestedBySessionId:
          "11111111-1111-4111-8111-111111111111",
        requestedByUserId:
          "22222222-2222-4222-8222-222222222222",
      },
    );
    expect(
      verifyTelegramLoginState(
        state.state,
        state.cookieValue,
        consentVersion,
        clientSecret,
        issuedAt,
      ),
    ).toMatchObject({
      purpose: "admin",
      redirectPath: "/admin",
      requestedBySessionId:
        "11111111-1111-4111-8111-111111111111",
      requestedByUserId:
        "22222222-2222-4222-8222-222222222222",
    });
  });

  it("связывает первоначальный административный вход без прежней сессии", () => {
    const state = createTelegramLoginState(
      "/admin/students",
      consentVersion,
      clientSecret,
      issuedAt,
      {
        purpose: "admin_login",
      },
    );
    const [encodedPayload] = state.cookieValue.split(".");
    const wirePayload = JSON.parse(
      Buffer.from(encodedPayload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    expect(
      verifyTelegramLoginState(
        state.state,
        state.cookieValue,
        consentVersion,
        clientSecret,
        issuedAt,
      ),
    ).toMatchObject({
      purpose: "admin_login",
      redirectPath: "/admin/students",
    });
    expect(wirePayload).toMatchObject({
      purpose: "login",
      administrativeAuthentication: true,
    });
  });

  it("отклоняет административное намерение без UUID сессии", () => {
    expect(() =>
      createTelegramLoginState(
        "/admin",
        consentVersion,
        clientSecret,
        issuedAt,
        {
          purpose: "admin",
          requestedBySessionId: "not-a-session",
          requestedByUserId:
            "22222222-2222-4222-8222-222222222222",
        },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
      }),
    );
  });
});
