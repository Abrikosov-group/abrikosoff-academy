import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { isSubscriptionPlanId } from "@/modules/billing/domain/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    const body = (await request.json()) as {
      email?: unknown;
      plan?: unknown;
      privacyAccepted?: unknown;
    };

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

    const email = normalizeEmail(body.email);
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
      redirectPath: `/checkout?plan=${body.plan}`,
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
