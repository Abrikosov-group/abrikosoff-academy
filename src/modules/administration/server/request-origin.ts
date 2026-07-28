import "server-only";

import { AdministrationError } from "../domain/errors";

export function requireAdministrationRequestOrigin(
  request: Request,
) {
  const expectedOrigin = new URL(
    process.env.APP_BASE_URL?.trim() || request.url,
  ).origin;
  const receivedOrigin = request.headers.get("origin");

  if (receivedOrigin !== expectedOrigin) {
    throw new AdministrationError(
      "ADMIN_PERMISSION_DENIED",
      "Источник запроса не подтверждён.",
      403,
    );
  }
}
