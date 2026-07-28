import { isSafeInternalRedirectPath } from "@/modules/identity/domain/login-redirect";

export function normalizeAdminRedirectPath(value: unknown) {
  if (
    isSafeInternalRedirectPath(value) &&
    (value === "/admin" || value.startsWith("/admin/")) &&
    !value.startsWith("/admin/verify")
  ) {
    return value;
  }

  return "/admin";
}
