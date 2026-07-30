import "server-only";

import type { IDToken } from "openid-client";
import { IdentityError } from "../domain/errors";
import { telegramProfileMetadataVersion } from "../domain/telegram-profile";

export const telegramRequestedScopes = [
  "openid",
  "profile",
] as const;

export type VerifiedTelegramIdentity = {
  subject: string;
  displayName: string;
  metadata: {
    profileMetadataVersion: number;
    username?: string;
    photoUrl?: string;
    telegramUserId?: string;
    profileName?: string;
    firstName?: string;
    lastName?: string;
    requestedScopes: readonly string[];
    tokenIssuedAt?: string;
    tokenExpiresAt?: string;
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

function optionalNumericDate(value: IDToken[string]) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return undefined;
  }

  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
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
      profileMetadataVersion: telegramProfileMetadataVersion,
      username: username || undefined,
      photoUrl: picture?.startsWith("https://") ? picture : undefined,
      telegramUserId,
      profileName: name,
      firstName,
      lastName,
      requestedScopes: [...telegramRequestedScopes],
      tokenIssuedAt: optionalNumericDate(claims.iat),
      tokenExpiresAt: optionalNumericDate(claims.exp),
    },
  };
}
