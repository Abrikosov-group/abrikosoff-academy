import { NextResponse } from "next/server";
import { isSubscriptionPlanId } from "@/modules/billing/domain/catalog";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { setSessionCookie } from "@/modules/identity/server/session";
import { verifyTelegramLogin } from "@/modules/identity/server/telegram-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = getIdentityConfig();

  if (
    !config.telegram ||
    url.searchParams.get("consent") !== privacyDocumentVersion
  ) {
    return NextResponse.redirect(
      new URL("/login?error=telegram", request.url),
    );
  }

  try {
    const identity = verifyTelegramLogin(
      url.searchParams,
      config.telegram.botToken,
    );
    const plan = isSubscriptionPlanId(url.searchParams.get("plan"))
      ? url.searchParams.get("plan")
      : "annual";
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
      new URL(`/checkout?plan=${plan}`, request.url),
    );

    setSessionCookie(response, session);
    return response;
  } catch (error) {
    if (error instanceof IdentityError) {
      return NextResponse.redirect(
        new URL("/login?error=telegram", request.url),
      );
    }

    throw error;
  }
}
