import { NextRequest, NextResponse } from "next/server";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { setSessionCookie } from "@/modules/identity/server/session";
import { verifyTelegramLogin } from "@/modules/identity/server/telegram-auth";
import {
  clearTelegramLoginStateCookie,
  getTelegramLoginStateCookie,
  verifyTelegramLoginState,
} from "@/modules/identity/server/telegram-login-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const config = getIdentityConfig();

  try {
    if (!config.telegram) {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Вход через Telegram ещё не настроен.",
        503,
      );
    }

    const loginState = verifyTelegramLoginState(
      url.searchParams.get("state"),
      getTelegramLoginStateCookie(request),
      privacyDocumentVersion,
      config.telegram.botToken,
    );
    const identity = verifyTelegramLogin(
      url.searchParams,
      config.telegram.botToken,
    );
    const { service } = getIdentityRuntime();
    const session = await service.authenticateIdentity({
      methodType: "telegram",
      identifier: identity.id,
      displayName: identity.displayName,
      metadata: identity.metadata,
      consent: {
        acceptedAt: new Date().toISOString(),
        documentVersion: privacyDocumentVersion,
        source: "telegram-login-widget",
      },
    });
    const response = NextResponse.redirect(
      new URL(`/checkout?plan=${loginState.plan}`, request.url),
    );

    setSessionCookie(response, session);
    clearTelegramLoginStateCookie(response);
    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      new URL("/login?error=telegram", request.url),
    );

    clearTelegramLoginStateCookie(response);

    if (error instanceof IdentityError) {
      return response;
    }

    return response;
  }
}
