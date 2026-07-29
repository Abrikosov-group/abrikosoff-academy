import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  readJsonBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";
import {
  logSecurityEvent,
  logUnexpectedServerError,
} from "@/lib/safe-server-log";
import { normalizeUserAgentFamily } from "@/lib/user-agent-family";
import { AdministrationError } from "@/modules/administration/domain/errors";
import { normalizeAdminRedirectPath } from "@/modules/administration/domain/admin-redirect";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { administrationErrorResponse } from "@/modules/administration/server/http";
import { requireAdministrationRequestOrigin } from "@/modules/administration/server/request-origin";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { getCurrentSessionTokenSha256 } from "@/modules/identity/server/session";
import {
  createTelegramLoginState,
  setTelegramLoginStateCookie,
} from "@/modules/identity/server/telegram-login-state";
import { buildTelegramAuthorizationUrl } from "@/modules/identity/server/telegram-oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBodyBytes = 4 * 1024;

export async function POST(request: Request) {
  const requestId = randomUUID();
  const userAgentFamily = normalizeUserAgentFamily(
    request.headers.get("user-agent"),
  );

  try {
    if (!getAdministrationConfig().enabled) {
      throw new AdministrationError(
        "ADMINISTRATION_DISABLED",
        "Административная панель пока не включена.",
        404,
      );
    }

    requireAdministrationRequestOrigin(request);

    let body: { redirectPath?: unknown };

    try {
      body = await readJsonBodyWithLimit<typeof body>(
        request,
        maximumBodyBytes,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw new AdministrationError(
          "ADMIN_VERIFICATION_REJECTED",
          "Размер данных подтверждения превышает допустимый.",
          413,
        );
      }

      throw new AdministrationError(
        "ADMIN_VERIFICATION_REJECTED",
        "Некорректные данные подтверждения.",
        400,
        { cause: error },
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new AdministrationError(
        "ADMIN_VERIFICATION_REJECTED",
        "Некорректные данные подтверждения.",
        400,
      );
    }

    const redirectPath = normalizeAdminRedirectPath(
      body.redirectPath,
    );
    const { service } = getAdministrationRuntime();
    const verification = await service.prepareTelegramVerification({
      tokenSha256: await getCurrentSessionTokenSha256(),
    });

    if (verification.alreadyVerified) {
      return Response.json(
        { nextUrl: redirectPath },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const identityConfig = getIdentityConfig();

    if (!identityConfig.telegram) {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Подтверждение через Telegram ещё не настроено.",
        503,
      );
    }

    const state = createTelegramLoginState(
      redirectPath,
      privacyDocumentVersion,
      identityConfig.telegram.clientSecret,
      new Date(),
      {
        purpose: "admin",
        requestedBySessionId: verification.sessionId,
        requestedByUserId: verification.userId,
      },
    );
    const authUrl = buildTelegramAuthorizationUrl(
      identityConfig.telegram,
      state,
    );
    const response = NextResponse.json(
      { authUrl: authUrl.toString() },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );

    setTelegramLoginStateCookie(response, state);
    return response;
  } catch (error) {
    if (error instanceof AdministrationError) {
      if (
        [
          "ADMIN_AUTH_REQUIRED",
          "ADMIN_LOGIN_REQUIRED",
          "ADMIN_REAUTH_REQUIRED",
          "ADMIN_ROLE_REQUIRED",
          "ADMIN_PERMISSION_DENIED",
        ].includes(error.code)
      ) {
        logSecurityEvent(
          "administration.telegram_start_rejected",
          {
            code: error.code,
            requestId,
            userAgentFamily,
          },
        );
      }

      return administrationErrorResponse(error);
    }

    if (error instanceof IdentityError) {
      return identityErrorResponse(error);
    }

    logUnexpectedServerError(
      "administration.telegram_start_failed",
      error,
    );
    return Response.json(
      {
        error: {
          code: "ADMIN_VERIFICATION_FAILED",
          message: "Не удалось начать подтверждение.",
        },
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
