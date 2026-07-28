import "server-only";

import type { IDToken } from "openid-client";
import { IdentityError } from "../domain/errors";

export type VerifiedTelegramIdentity = {
  id: string;
  displayName: string;
  metadata: {
    username?: string;
    photoUrl?: string;
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

export function telegramIdentityFromClaims(
  claims: IDToken,
): VerifiedTelegramIdentity {
  const id = claims.sub;
  const username = optionalText(claims.preferred_username, 64);
  const name = optionalText(claims.name, 160);
  const firstName = optionalText(claims.given_name, 80);
  const lastName = optionalText(claims.family_name, 80);
  const picture = optionalText(claims.picture, 2_048);

  if (!/^\d{1,20}$/.test(id)) {
    throw new IdentityError(
      "INVALID_LOGIN",
      "Telegram вернул некорректный идентификатор пользователя.",
      400,
    );
  }

  const displayName =
    name ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    (username ? `@${username}` : "Ученик Академии");

  return {
    id,
    displayName,
    metadata: {
      username: username || undefined,
      photoUrl: picture?.startsWith("https://") ? picture : undefined,
    },
  };
}
