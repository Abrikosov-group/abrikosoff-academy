import { isSafeInternalRedirectPath } from "@/modules/identity/domain/login-redirect";

const adminRedirectBaseUrl = new URL("https://academy.invalid");

function decodeAdminPathname(pathname: string) {
  let decodedPathname = pathname;

  for (
    let pass = 0;
    pass < 8 && decodedPathname.includes("%");
    pass += 1
  ) {
    decodedPathname = decodeURIComponent(decodedPathname);
  }

  if (decodedPathname.includes("%")) {
    throw new URIError("Admin redirect path is over-encoded.");
  }

  return decodedPathname;
}

export function normalizeAdminRedirectPath(value: unknown) {
  return resolveAdminRedirectPath(value) ?? "/admin";
}

export function isAdminRedirectPath(value: unknown) {
  return resolveAdminRedirectPath(value) !== null;
}

export function resolveAdminRedirectPath(value: unknown) {
  if (!isSafeInternalRedirectPath(value)) {
    return null;
  }

  try {
    const redirectUrl = new URL(value, adminRedirectBaseUrl);
    const decodedPathname = decodeAdminPathname(redirectUrl.pathname);

    if (/[\\?#\u0000-\u001f\u007f]/u.test(decodedPathname)) {
      return null;
    }

    const canonicalUrl = new URL(decodedPathname, adminRedirectBaseUrl);
    const canonicalPathname = canonicalUrl.pathname;

    if (
      canonicalUrl.origin === adminRedirectBaseUrl.origin &&
      (canonicalPathname === "/admin" ||
        canonicalPathname.startsWith("/admin/")) &&
      !canonicalPathname.startsWith("/admin/verify")
    ) {
      return `${canonicalPathname}${redirectUrl.search}${redirectUrl.hash}`;
    }
  } catch {
    return null;
  }

  return null;
}
