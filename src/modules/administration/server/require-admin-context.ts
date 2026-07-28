import "server-only";

import { randomUUID } from "node:crypto";
import {
  forbidden,
  notFound,
  redirect,
} from "next/navigation";
import { loginPathFor } from "@/modules/identity/domain/login-redirect";
import { normalizeAdminRedirectPath } from "../domain/admin-redirect";
import { getCurrentSessionTokenSha256 } from "@/modules/identity/server/session";
import { AdministrationError } from "../domain/errors";
import type {
  AdminContext,
  AdminPermission,
  AdminVerificationStart,
} from "../domain/types";
import { getAdministrationConfig } from "./administration-config";
import { getAdministrationRuntime } from "./get-administration-runtime";

export function adminVerificationPathFor(nextPath: string) {
  return `/admin/verify?next=${encodeURIComponent(
    normalizeAdminRedirectPath(nextPath),
  )}`;
}

export async function requireAdminContext(
  permission: AdminPermission,
  nextPath = "/admin",
): Promise<AdminContext> {
  if (!getAdministrationConfig().enabled) {
    notFound();
  }

  try {
    const { service } = getAdministrationRuntime();

    return await service.getContext({
      tokenSha256: await getCurrentSessionTokenSha256(),
      permission,
      requestId: randomUUID(),
    });
  } catch (error) {
    if (!(error instanceof AdministrationError)) {
      throw error;
    }

    switch (error.code) {
      case "ADMINISTRATION_DISABLED":
        notFound();
      case "ADMIN_AUTH_REQUIRED":
      case "ADMIN_LOGIN_REQUIRED":
        redirect(loginPathFor(nextPath));
      case "ADMIN_REAUTH_REQUIRED":
        redirect(adminVerificationPathFor(nextPath));
      case "ADMIN_ROLE_REQUIRED":
      case "ADMIN_PERMISSION_DENIED":
        forbidden();
      default:
        throw error;
    }
  }
}

export async function requireAdminVerificationStart(
  nextPath = "/admin",
): Promise<AdminVerificationStart> {
  if (!getAdministrationConfig().enabled) {
    notFound();
  }

  try {
    const { service } = getAdministrationRuntime();

    return await service.prepareTelegramVerification({
      tokenSha256: await getCurrentSessionTokenSha256(),
    });
  } catch (error) {
    if (!(error instanceof AdministrationError)) {
      throw error;
    }

    switch (error.code) {
      case "ADMINISTRATION_DISABLED":
        notFound();
      case "ADMIN_AUTH_REQUIRED":
      case "ADMIN_LOGIN_REQUIRED":
        redirect(loginPathFor(nextPath));
      case "ADMIN_ROLE_REQUIRED":
      case "ADMIN_PERMISSION_DENIED":
        forbidden();
      default:
        throw error;
    }
  }
}
