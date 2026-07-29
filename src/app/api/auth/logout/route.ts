import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  revokeCurrentSession,
} from "@/modules/identity/server/session";
import { resolveIdentityPublicBaseUrl } from "@/modules/identity/server/identity-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const publicBaseUrl = resolveIdentityPublicBaseUrl(request.url);

  await revokeCurrentSession();
  const response = NextResponse.redirect(
    new URL("/", publicBaseUrl),
    303,
  );
  clearSessionCookie(response);
  return response;
}
