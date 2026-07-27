import { NextResponse } from "next/server";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { setSessionCookie } from "@/modules/identity/server/session";
import { isSubscriptionPlanId } from "@/modules/billing/domain/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      plan?: unknown;
      privacyAccepted?: unknown;
    };

    try {
      body = (await request.json()) as typeof body;
    } catch (error) {
      throw new IdentityError(
        "INVALID_REQUEST",
        "Некорректные данные запроса.",
        400,
        { cause: error },
      );
    }

    if (
      !isSubscriptionPlanId(body.plan) ||
      body.privacyAccepted !== true
    ) {
      throw new IdentityError(
        "INVALID_REQUEST",
        "Подтвердите согласие на обработку персональных данных.",
        400,
      );
    }

    const { service } = getIdentityRuntime();
    const session = await service.authenticateIdentity({
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
    });
    const response = NextResponse.json(
      {
        authenticated: true,
        nextUrl: `/checkout?plan=${body.plan}`,
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
