import type { SubscriptionPlanId } from "@/modules/billing/domain/types";

export const defaultLoginRedirectPath = "/dashboard";

export function isSafeInternalRedirectPath(
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }

  try {
    const baseUrl = new URL("https://academy.invalid");
    const redirectUrl = new URL(value, baseUrl);

    return (
      redirectUrl.origin === baseUrl.origin &&
      redirectUrl.pathname !== "/login" &&
      !redirectUrl.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}

export function normalizeLoginRedirectPath(value: unknown) {
  return isSafeInternalRedirectPath(value)
    ? value
    : defaultLoginRedirectPath;
}

export function checkoutRedirectPath(plan: SubscriptionPlanId) {
  return `/checkout?plan=${plan}`;
}

export function loginPathFor(nextPath: string) {
  return `/login?next=${encodeURIComponent(
    normalizeLoginRedirectPath(nextPath),
  )}`;
}
