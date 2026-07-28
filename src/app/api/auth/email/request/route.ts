import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { normalizeLoginRedirectPath } from "@/modules/identity/domain/login-redirect";
import {
  readJsonBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const maxLoginBodyBytes = 4 * 1024;

function normalizeEmail(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new IdentityError(
      "INVALID_REQUEST",
      "Укажите корректную электронную почту.",
      400,
    );
  }

  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
  try {
    const config = getIdentityConfig();

    if (config.emailAuthMode !== "demo") {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Вход по почте пока не подключён.",
        503,
      );
    }

    let body: {
      email?: unknown;
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
          "Размер данных для входа превышает допустимый.",
          413,
        );
      }

      throw new IdentityError(
        "INVALID_REQUEST",
        "Некорректные данные запроса.",
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

    const email = normalizeEmail(body.email);
    const redirectPath = normalizeLoginRedirectPath(body.redirectPath);
    const displayName =
      email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .trim()
        .replace(/^\p{L}/u, (letter) => letter.toUpperCase()) ||
      "Ученик Академии";
    const { service } = getIdentityRuntime();
    const challenge = await service.requestEmailLogin({
      email,
      displayName,
      redirectPath,
      consent: {
        acceptedAt: new Date().toISOString(),
        documentVersion: privacyDocumentVersion,
        source: "local-email-login",
      },
    });
    const verificationUrl = new URL(
      "/api/auth/email/verify",
      request.url,
    );
    verificationUrl.searchParams.set("token", challenge.token);

    return Response.json(
      {
        sent: true,
        verificationUrl: verificationUrl.toString(),
        expiresAt: challenge.expiresAt.toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return identityErrorResponse(error);
  }
}
