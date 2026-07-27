import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { IdentityError } from "../domain/errors";

const telegramFields = [
  "auth_date",
  "first_name",
  "id",
  "last_name",
  "photo_url",
  "username",
] as const;

export type VerifiedTelegramIdentity = {
  id: string;
  displayName: string;
  metadata: {
    username?: string;
    photoUrl?: string;
  };
};

export function verifyTelegramLogin(
  searchParams: URLSearchParams,
  botToken: string,
): VerifiedTelegramIdentity {
  const receivedHash = searchParams.get("hash");
  const id = searchParams.get("id");
  const authDate = searchParams.get("auth_date");

  if (
    !receivedHash ||
    !/^[0-9a-f]{64}$/i.test(receivedHash) ||
    !id ||
    !/^-?\d{1,20}$/.test(id) ||
    !authDate ||
    !/^\d{10}$/.test(authDate)
  ) {
    throw new IdentityError(
      "INVALID_LOGIN",
      "Telegram вернул неполные данные для входа.",
      400,
    );
  }

  const authenticationTime = Number(authDate) * 1_000;
  const age = Date.now() - authenticationTime;

  if (age < -60_000 || age > 10 * 60_000) {
    throw new IdentityError(
      "LOGIN_EXPIRED",
      "Подтверждение Telegram устарело. Начните вход ещё раз.",
      400,
    );
  }

  const dataCheckString = telegramFields
    .flatMap((key) => {
      const value = searchParams.get(key);
      return value === null ? [] : [`${key}=${value}`];
    })
    .sort()
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const receivedHashBuffer = Buffer.from(receivedHash, "hex");

  if (
    receivedHashBuffer.length !== expectedHash.length ||
    !timingSafeEqual(receivedHashBuffer, expectedHash)
  ) {
    throw new IdentityError(
      "INVALID_LOGIN",
      "Не удалось подтвердить вход через Telegram.",
      401,
    );
  }

  const firstName = searchParams.get("first_name")?.trim();
  const lastName = searchParams.get("last_name")?.trim();
  const username = searchParams.get("username")?.trim();
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    (username ? `@${username}` : "Ученик Академии");

  return {
    id,
    displayName,
    metadata: {
      username: username || undefined,
      photoUrl: searchParams.get("photo_url") || undefined,
    },
  };
}
