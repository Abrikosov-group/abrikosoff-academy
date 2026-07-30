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
    id: 987654321,
    ...overrides,
  };
}

describe("telegramIdentityFromClaims", () => {
  it("преобразует проверенные OpenID Connect claims в метод входа", () => {
    expect(telegramIdentityFromClaims(telegramClaims())).toEqual({
      subject: "123456789",
      displayName: "Анна Иванова",
      metadata: {
        profileMetadataVersion: 1,
        username: "anna",
        photoUrl: "https://t.me/i/userpic/example.jpg",
        telegramUserId: "987654321",
        profileName: "Анна Иванова",
        firstName: "Анна",
        lastName: "Иванова",
        requestedScopes: ["openid", "profile"],
        tokenIssuedAt: new Date(
          1_775_000_000 * 1_000,
        ).toISOString(),
        tokenExpiresAt: new Date(
          1_775_000_600 * 1_000,
        ).toISOString(),
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
      subject: "123456789",
      displayName: "Анна Иванова",
      metadata: {
        profileMetadataVersion: 1,
        username: undefined,
        photoUrl: undefined,
        telegramUserId: "987654321",
        profileName: undefined,
        firstName: "Анна",
        lastName: "Иванова",
        requestedScopes: ["openid", "profile"],
        tokenIssuedAt: new Date(
          1_775_000_000 * 1_000,
        ).toISOString(),
        tokenExpiresAt: new Date(
          1_775_000_600 * 1_000,
        ).toISOString(),
      },
    });
  });

  it("сохраняет строковый Telegram id только как metadata", () => {
    expect(
      telegramIdentityFromClaims(
        telegramClaims({
          sub: "telegram-subject-v1_123",
          id: "987654321",
        }),
      ),
    ).toMatchObject({
      subject: "telegram-subject-v1_123",
      metadata: {
        telegramUserId: "987654321",
      },
    });
  });

  it("отклоняет некорректный OpenID Connect subject", () => {
    expect(() =>
      telegramIdentityFromClaims(
        telegramClaims({
          sub: "",
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
