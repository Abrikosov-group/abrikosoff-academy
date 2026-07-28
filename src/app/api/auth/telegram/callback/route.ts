import { NextRequest, NextResponse } from "next/server";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { setSessionCookie } from "@/modules/identity/server/session";
import {
  clearTelegramLoginStateCookie,
  getTelegramLoginStateCookie,
  verifyTelegramLoginState,
} from "@/modules/identity/server/telegram-login-state";
import { exchangeTelegramAuthorizationCode } from "@/modules/identity/server/telegram-oidc";
import { logUnexpectedServerError } from "@/lib/safe-server-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const config = getIdentityConfig();
  const publicOrigin = config.telegram?.redirectUri || request.url;

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
      config.telegram.clientSecret,
    );

    if (url.searchParams.has("error")) {
      throw new IdentityError(
        "INVALID_LOGIN",
        "Вход через Telegram был отменён.",
        400,
      );
    }

    const identity = await exchangeTelegramAuthorizationCode(
      config.telegram,
      url,
      {
        state: url.searchParams.get("state")!,
        nonce: loginState.nonce,
        codeVerifier: loginState.codeVerifier,
      },
    );
    const { service } = getIdentityRuntime();
    const session = await service.authenticateIdentity({
      methodType: "telegram",
      identifier: identity.subject,
      displayName: identity.displayName,
      metadata: identity.metadata,
      consent: {
        acceptedAt: new Date().toISOString(),
        documentVersion: privacyDocumentVersion,
        source: "telegram-openid-connect",
      },
    });
    const response = NextResponse.redirect(
      new URL(loginState.redirectPath, publicOrigin),
    );

    setSessionCookie(response, session);
    clearTelegramLoginStateCookie(response);
    return response;
  } catch (error) {
    const errorCode =
      error instanceof IdentityError &&
      error.code === "AUTH_UNAVAILABLE"
        ? "telegram_unavailable"
        : "telegram";
    const response = NextResponse.redirect(
      new URL(`/login?error=${errorCode}`, publicOrigin),
    );

    clearTelegramLoginStateCookie(response);

    if (error instanceof IdentityError) {
      if (error.code === "AUTH_UNAVAILABLE") {
        logUnexpectedServerError(
          "identity.telegram_transport_unavailable",
          error,
        );
      }

      return response;
    }

    logUnexpectedServerError("identity.telegram_callback_failed", error);
    return response;
  }
}
