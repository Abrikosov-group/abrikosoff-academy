import { NextResponse } from "next/server";
import { IdentityError } from "@/modules/identity/domain/errors";
import { normalizeLoginRedirectPath } from "@/modules/identity/domain/login-redirect";
import { getIdentityRuntime } from "@/modules/identity/server/get-identity-service";
import { setSessionCookie } from "@/modules/identity/server/session";
import { logUnexpectedServerError } from "@/lib/safe-server-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token || token.length < 32 || token.length > 128) {
    return NextResponse.redirect(
      new URL("/login?error=email-link", request.url),
    );
  }

  try {
    const { service } = getIdentityRuntime();
    const result = await service.verifyEmailLogin(token);
    const response = NextResponse.redirect(
      new URL(
        normalizeLoginRedirectPath(result.redirectPath),
        request.url,
      ),
    );

    setSessionCookie(response, result.session);
    return response;
  } catch (error) {
    if (error instanceof IdentityError) {
      return NextResponse.redirect(
        new URL("/login?error=email-link", request.url),
      );
    }

    logUnexpectedServerError("identity.email_verify_failed", error);
    return NextResponse.redirect(
      new URL("/login?error=email-link", request.url),
    );
  }
}
