import "server-only";

import { resolveIdentityPublicBaseUrl } from "@/modules/identity/server/identity-config";
import { AdministrationError } from "../domain/errors";

export function requireAdministrationRequestOrigin(
  request: Request,
) {
  let expectedOrigin: string;

  try {
    expectedOrigin = resolveIdentityPublicBaseUrl(request.url);
  } catch (error) {
    throw new AdministrationError(
      "ADMIN_PERMISSION_DENIED",
      "Источник запроса не подтверждён.",
      403,
      { cause: error },
    );
  }

  const receivedOrigin = request.headers.get("origin");

  if (receivedOrigin !== expectedOrigin) {
    throw new AdministrationError(
      "ADMIN_PERMISSION_DENIED",
      "Источник запроса не подтверждён.",
      403,
    );
  }
}
