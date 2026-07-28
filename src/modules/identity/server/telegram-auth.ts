import "server-only";

import type { IDToken } from "openid-client";
import { IdentityError } from "../domain/errors";

export type VerifiedTelegramIdentity = {
  subject: string;
  displayName: string;
  metadata: {
    username?: string;
    photoUrl?: string;
    telegramUserId?: string;
  };
};

function optionalText(
  value: IDToken[string],
  maximumLength: number,
) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength
    ? normalized
    : undefined;
}

function optionalTelegramUserId(value: IDToken[string]) {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
    return value;
  }

  return undefined;
}

export function telegramIdentityFromClaims(
  claims: IDToken,
): VerifiedTelegramIdentity {
  const subject = claims.sub;
  const telegramUserId = optionalTelegramUserId(claims.id);
  const username = optionalText(claims.preferred_username, 64);
  const name = optionalText(claims.name, 160);
  const firstName = optionalText(claims.given_name, 80);
  const lastName = optionalText(claims.family_name, 80);
  const picture = optionalText(claims.picture, 2_048);

  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(subject)
  ) {
    throw new IdentityError(
      "INVALID_LOGIN",
      "Telegram вернул некорректный OpenID Connect subject.",
      400,
    );
  }

  const displayName =
    name ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    (username ? `@${username}` : "Ученик Академии");

  return {
    subject,
    displayName,
    metadata: {
      username: username || undefined,
      photoUrl: picture?.startsWith("https://") ? picture : undefined,
      telegramUserId,
    },
  };
}
