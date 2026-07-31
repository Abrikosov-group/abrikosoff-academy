import { NextResponse } from "next/server";
import {
  adminVerificationPathFor,
  resolveAdminRedirectPath,
} from "@/modules/administration/domain/admin-redirect";
import { IdentityError } from "@/modules/identity/domain/errors";
import { normalizeLoginRedirectPath } from "@/modules/identity/domain/login-redirect";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { identityErrorResponse } from "@/modules/identity/server/http";
import {
  createTelegramLoginState,
  setTelegramLoginStateCookie,
} from "@/modules/identity/server/telegram-login-state";
import { buildTelegramAuthorizationUrl } from "@/modules/identity/server/telegram-oidc";
import { getCurrentUser } from "@/modules/identity/server/session";
import {
  readJsonBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const maxLoginBodyBytes = 4 * 1024;

export async function POST(request: Request) {
  try {
    const config = getIdentityConfig();

    if (!config.telegram) {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Вход через Telegram ещё не настроен.",
        503,
      );
    }

    let body: {
      redirectPath?: unknown;
      privacyAccepted?: unknown;
    };

    try {
      body = await readJsonBodyWithLimit<typeof body>(
        request,
        maxLoginBodyBytes,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw new IdentityError(
          "INVALID_REQUEST",
          "Размер данных для входа через Telegram превышает допустимый.",
          413,
        );
      }

      throw new IdentityError(
        "INVALID_REQUEST",
        "Некорректные данные для входа через Telegram.",
        400,
        { cause: error },
      );
    }

    if (body.privacyAccepted !== true) {
      throw new IdentityError(
        "INVALID_REQUEST",
        "Подтвердите согласие на обработку персональных данных.",
        400,
      );
    }
    const requestedRedirectPath = normalizeLoginRedirectPath(
      body.redirectPath,
    );
    const adminRedirectPath = resolveAdminRedirectPath(
      requestedRedirectPath,
    );
    const administrativeAuthentication =
      adminRedirectPath !== null;
    const redirectPath =
      adminRedirectPath ?? requestedRedirectPath;

    if (adminRedirectPath && (await getCurrentUser())) {
      return NextResponse.json(
        {
          nextUrl: adminVerificationPathFor(
            adminRedirectPath,
          ),
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const state = createTelegramLoginState(
      redirectPath,
      privacyDocumentVersion,
      config.telegram.clientSecret,
      new Date(),
      administrativeAuthentication
        ? { purpose: "admin_login" }
        : { purpose: "login" },
    );
    const authUrl = buildTelegramAuthorizationUrl(config.telegram, state);
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
    return identityErrorResponse(error);
  }
}
