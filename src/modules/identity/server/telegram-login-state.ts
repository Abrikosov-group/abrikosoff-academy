import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextResponse } from "next/server";
import { isSafeInternalRedirectPath } from "../domain/login-redirect";
import { IdentityError } from "../domain/errors";

const telegramLoginStateTtlMs = 10 * 60_000;

type TelegramLoginStatePayload = {
  version: 3;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectPath: string;
  consentVersion: string;
  issuedAt: number;
};

type TelegramLoginState = {
  state: string;
  nonce: string;
  codeChallenge: string;
  cookieValue: string;
  expiresAt: Date;
};

function stateCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-academy_telegram_state"
    : "academy_telegram_state";
}

function signatureFor(value: string, clientSecret: string) {
  return createHmac("sha256", clientSecret).update(value).digest("hex");
}

function equalText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function invalidState() {
  return new IdentityError(
    "INVALID_LOGIN",
    "Не удалось подтвердить начало входа через Telegram.",
    401,
  );
}

export function createTelegramLoginState(
  redirectPath: string,
  consentVersion: string,
  clientSecret: string,
  now: Date = new Date(),
): TelegramLoginState {
  if (!isSafeInternalRedirectPath(redirectPath)) {
    throw invalidState();
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const payload: TelegramLoginStatePayload = {
    version: 3,
    state,
    nonce,
    codeVerifier,
    redirectPath,
    consentVersion,
    issuedAt: now.getTime(),
  };
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
  ).toString("base64url");

  return {
    state,
    nonce,
    codeChallenge: createHash("sha256")
      .update(codeVerifier)
      .digest("base64url"),
    cookieValue: `${encodedPayload}.${signatureFor(
      encodedPayload,
      clientSecret,
    )}`,
    expiresAt: new Date(now.getTime() + telegramLoginStateTtlMs),
  };
}

export function verifyTelegramLoginState(
  state: string | null,
  cookieValue: string | undefined,
  expectedConsentVersion: string,
  clientSecret: string,
  now: Date = new Date(),
) {
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !cookieValue
  ) {
    throw invalidState();
  }

  const [encodedPayload, receivedSignature, extraPart] =
    cookieValue.split(".");

  if (
    !encodedPayload ||
    !receivedSignature ||
    extraPart !== undefined ||
    !/^[0-9a-f]{64}$/i.test(receivedSignature)
  ) {
    throw invalidState();
  }

  const expectedSignature = signatureFor(encodedPayload, clientSecret);

  if (!equalText(receivedSignature, expectedSignature)) {
    throw invalidState();
  }

  let payload: unknown;

  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    throw invalidState();
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("version" in payload) ||
    payload.version !== 3 ||
    !("state" in payload) ||
    typeof payload.state !== "string" ||
    !equalText(payload.state, state) ||
    !("nonce" in payload) ||
    typeof payload.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce) ||
    !("codeVerifier" in payload) ||
    typeof payload.codeVerifier !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(payload.codeVerifier) ||
    !("redirectPath" in payload) ||
    !isSafeInternalRedirectPath(payload.redirectPath) ||
    !("consentVersion" in payload) ||
    payload.consentVersion !== expectedConsentVersion ||
    !("issuedAt" in payload) ||
    typeof payload.issuedAt !== "number"
  ) {
    throw invalidState();
  }

  const age = now.getTime() - payload.issuedAt;

  if (age < -60_000 || age > telegramLoginStateTtlMs) {
    throw new IdentityError(
      "LOGIN_EXPIRED",
      "Начало входа через Telegram устарело. Попробуйте ещё раз.",
      400,
    );
  }

  return {
    redirectPath: payload.redirectPath,
    consentVersion: payload.consentVersion,
    nonce: payload.nonce,
    codeVerifier: payload.codeVerifier,
  };
}

export function getTelegramLoginStateCookie(
  request: { cookies: { get(name: string): { value: string } | undefined } },
) {
  return request.cookies.get(stateCookieName())?.value;
}

export function setTelegramLoginStateCookie(
  response: NextResponse,
  state: TelegramLoginState,
) {
  response.cookies.set(stateCookieName(), state.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: state.expiresAt,
    priority: "high",
  });
}

export function clearTelegramLoginStateCookie(response: NextResponse) {
  response.cookies.set(stateCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
}
