import type { IDToken } from "openid-client";
import { describe, expect, it } from "vitest";
import { telegramIdentityFromClaims } from "@/modules/identity/server/telegram-auth";

function telegramClaims(overrides: Partial<IDToken> = {}): IDToken {
  return {
    iss: "https://oauth.telegram.org",
    sub: "123456789",
    aud: "8802171680",
    iat: 1_775_000_000,
    exp: 1_775_000_600,
    name: "Анна Иванова",
    given_name: "Анна",
    family_name: "Иванова",
    preferred_username: "anna",
    picture: "https://t.me/i/userpic/example.jpg",
    ...overrides,
  };
}

describe("telegramIdentityFromClaims", () => {
  it("преобразует проверенные OpenID Connect claims в метод входа", () => {
    expect(telegramIdentityFromClaims(telegramClaims())).toEqual({
      id: "123456789",
      displayName: "Анна Иванова",
      metadata: {
        username: "anna",
        photoUrl: "https://t.me/i/userpic/example.jpg",
      },
    });
  });

  it("собирает имя из отдельных полей при отсутствии name", () => {
    expect(
      telegramIdentityFromClaims(
        telegramClaims({
          name: undefined,
          preferred_username: undefined,
          picture: "http://example.com/avatar.jpg",
        }),
      ),
    ).toEqual({
      id: "123456789",
      displayName: "Анна Иванова",
      metadata: {
        username: undefined,
        photoUrl: undefined,
      },
    });
  });

  it("отклоняет некорректный Telegram subject", () => {
    expect(() =>
      telegramIdentityFromClaims(
        telegramClaims({
          sub: "not-a-telegram-id",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LOGIN",
        httpStatus: 400,
      }),
    );
  });
});
