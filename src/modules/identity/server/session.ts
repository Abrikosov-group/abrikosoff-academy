import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { hasDatabaseConfiguration } from "@/lib/database";
import { hashIdentityToken } from "../application/identity-service";
import { IdentityError } from "../domain/errors";
import type {
  AuthenticatedUser,
  LoginSession,
} from "../domain/types";
import { getIdentityRuntime } from "./get-identity-service";

function getSessionCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-academy_session"
    : "academy_session";
}

export function setSessionCookie(
  response: NextResponse,
  session: LoginSession,
) {
  response.cookies.set(getSessionCookieName(), session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
    priority: "high",
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(getSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();

  if (!hasDatabaseConfiguration()) {
    return null;
  }

  const token = cookieStore.get(getSessionCookieName())?.value;

  if (!token) {
    return null;
  }

  const { repository } = getIdentityRuntime();
  return repository.findUserBySessionTokenSha256(
    hashIdentityToken(token),
  );
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new IdentityError(
      "AUTH_REQUIRED",
      "Войдите в аккаунт перед оплатой.",
      401,
    );
  }

  return user;
}

export async function revokeCurrentSession() {
  if (!hasDatabaseConfiguration()) {
    return;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;

  if (!token) {
    return;
  }

  const { repository } = getIdentityRuntime();
  await repository.revokeSession(hashIdentityToken(token));
}
