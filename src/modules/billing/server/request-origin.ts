import { BillingError } from "../domain/errors";

export function requireBillingRequestOrigin(request: Request) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const expectedOrigin = new URL(configuredBaseUrl || request.url).origin;
  const receivedOrigin = request.headers.get("origin");

  if (receivedOrigin !== expectedOrigin) {
    throw new BillingError(
      "INVALID_REQUEST_ORIGIN",
      "Источник запроса не прошёл проверку.",
      403,
    );
  }
}
