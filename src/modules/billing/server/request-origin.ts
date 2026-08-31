import { BillingError } from "../domain/errors";

export function requireBillingRequestOrigin(request: Request) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const trustedBaseUrl =
    configuredBaseUrl ||
    (process.env.NODE_ENV === "production" ? undefined : request.url);

  if (!trustedBaseUrl) {
    throw new BillingError(
      "INVALID_REQUEST_ORIGIN",
      "Источник запроса не прошёл проверку.",
      403,
    );
  }

  let expectedOrigin: string;

  try {
    expectedOrigin = new URL(trustedBaseUrl).origin;
  } catch (error) {
    throw new BillingError(
      "INVALID_REQUEST_ORIGIN",
      "Источник запроса не прошёл проверку.",
      403,
      { cause: error },
    );
  }
  const receivedOrigin = request.headers.get("origin");

  if (receivedOrigin !== expectedOrigin) {
    throw new BillingError(
      "INVALID_REQUEST_ORIGIN",
      "Источник запроса не прошёл проверку.",
      403,
    );
  }
}
