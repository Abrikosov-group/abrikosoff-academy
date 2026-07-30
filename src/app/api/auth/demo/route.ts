import { NextResponse } from "next/server";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { collectSessionClientContext } from "@/modules/identity/server/session-client-context";
import { setSessionCookie } from "@/modules/identity/server/session";
import { normalizeLoginRedirectPath } from "@/modules/identity/domain/login-redirect";
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

    if (!config.demoAuthEnabled) {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Тестовый вход отключён.",
        404,
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
    const redirectPath = normalizeLoginRedirectPath(body.redirectPath);

    const { service } = getIdentityRuntime();
    const session = await service.authenticateIdentity({
      authenticationMethod: "demo",
      methodType: "telegram",
      identifier: "demo-telegram-anna",
      displayName: "Анна К.",
      receiptEmail: "anna.demo@example.com",
      metadata: {
        username: "anna_k",
        demo: true,
      },
      consent: {
        acceptedAt: new Date().toISOString(),
        documentVersion: privacyDocumentVersion,
        source: "local-demo-login",
      },
      clientContext: collectSessionClientContext(
        request.headers,
        config.trustedProxy,
      ),
    });
    const response = NextResponse.json(
      {
        authenticated: true,
        nextUrl: redirectPath,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );

    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return identityErrorResponse(error);
  }
}
