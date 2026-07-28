import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  revokeCurrentSession,
} from "@/modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  await revokeCurrentSession();
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  clearSessionCookie(response);
  return response;
}
