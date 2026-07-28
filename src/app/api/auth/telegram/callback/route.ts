import { NextRequest, NextResponse } from "next/server";
import { AdministrationError } from "@/modules/administration/domain/errors";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import {
  getCurrentSessionTokenSha256,
  setSessionCookie,
} from "@/modules/identity/server/session";
import {
  clearTelegramLoginStateCookie,
  getTelegramLoginStateCookie,
  verifyTelegramLoginState,
} from "@/modules/identity/server/telegram-login-state";
import { exchangeTelegramAuthorizationCode } from "@/modules/identity/server/telegram-oidc";
import { logUnexpectedServerError } from "@/lib/safe-server-log";
import { normalizeUserAgentFamily } from "@/lib/user-agent-family";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const config = getIdentityConfig();
  const publicOrigin = config.telegram?.redirectUri || request.url;
  let callbackPurpose: "login" | "admin" = "login";

  try {
    if (!config.telegram) {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Вход через Telegram ещё не настроен.",
        503,
      );
    }

    const returnedStates = url.searchParams.getAll("state");
    const loginState = verifyTelegramLoginState(
      returnedStates.length === 1 ? returnedStates[0] : null,
      getTelegramLoginStateCookie(request),
      privacyDocumentVersion,
      config.telegram.clientSecret,
    );
    callbackPurpose = loginState.purpose;

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
        nonce: loginState.nonce,
        codeVerifier: loginState.codeVerifier,
      },
    );
    const userAgentFamily = normalizeUserAgentFamily(
      request.headers.get("user-agent"),
    );
    const session =
      loginState.purpose === "admin"
        ? await getAdministrationRuntime()
            .service.confirmTelegramVerification({
              currentTokenSha256:
                await getCurrentSessionTokenSha256(),
              expectedSessionId:
                loginState.requestedBySessionId,
              expectedUserId: loginState.requestedByUserId,
              telegramIdentifier: identity.subject,
              userAgentFamily,
            })
        : await getIdentityRuntime().service.authenticateIdentity({
            authenticationMethod: "telegram_oidc",
            methodType: "telegram",
            identifier: identity.subject,
            displayName: identity.displayName,
            metadata: identity.metadata,
            consent: {
              acceptedAt: new Date().toISOString(),
              documentVersion: privacyDocumentVersion,
              source: "telegram-openid-connect",
            },
            userAgentFamily,
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
    const errorPath =
      callbackPurpose === "admin"
        ? `/admin/verify?error=${errorCode}`
        : `/login?error=${errorCode}`;
    const response = NextResponse.redirect(
      new URL(errorPath, publicOrigin),
    );

    clearTelegramLoginStateCookie(response);

    if (
      error instanceof IdentityError ||
      error instanceof AdministrationError
    ) {
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
