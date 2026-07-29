import "server-only";

import { randomUUID } from "node:crypto";

function classifyError(error: unknown) {
  if (error instanceof Error) {
    return "error";
  }

  if (error === null) {
    return "null";
  }

  return typeof error;
}

type SafeErrorDetails = {
  name?: string;
  code?: string;
  oauthError?: string;
  status?: number;
  cause?: SafeErrorDetails;
};

const safeIdentifierPattern = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const safeRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const safeUserAgentFamilies = new Set([
  "Microsoft Edge",
  "Opera",
  "Google Chrome",
  "Mozilla Firefox",
  "Safari",
  "Telegram",
  "Другой браузер",
]);

function safeIdentifier(value: unknown) {
  return typeof value === "string" &&
    safeIdentifierPattern.test(value)
    ? value
    : undefined;
}

function safeStatus(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function safeRequestId(value: unknown) {
  return typeof value === "string" &&
    safeRequestIdPattern.test(value)
    ? value.toLowerCase()
    : undefined;
}

function safeUserAgentFamily(value: unknown) {
  return typeof value === "string" &&
    safeUserAgentFamilies.has(value)
    ? value
    : undefined;
}

function getSafeErrorDetails(
  error: unknown,
  depth = 0,
  visited = new Set<unknown>(),
): SafeErrorDetails | undefined {
  if (
    !error ||
    (typeof error !== "object" && typeof error !== "function") ||
    visited.has(error)
  ) {
    return undefined;
  }

  visited.add(error);
  const candidate = error as {
    cause?: unknown;
    code?: unknown;
    error?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const details: SafeErrorDetails = {};
  const name = safeIdentifier(candidate.name);
  const code = safeIdentifier(candidate.code);
  const oauthError = safeIdentifier(candidate.error);
  const status = safeStatus(candidate.status ?? candidate.statusCode);

  if (name) {
    details.name = name;
  }
  if (code) {
    details.code = code;
  }
  if (oauthError) {
    details.oauthError = oauthError;
  }
  if (status) {
    details.status = status;
  }

  if (depth < 2) {
    const cause = getSafeErrorDetails(
      candidate.cause,
      depth + 1,
      visited,
    );

    if (cause) {
      details.cause = cause;
    }
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

export function logUnexpectedServerError(
  event: string,
  error: unknown,
) {
  const incidentId = randomUUID();
  const errorDetails = getSafeErrorDetails(error);

  console.error(
    JSON.stringify({
      level: "error",
      event,
      incidentId,
      errorType: classifyError(error),
      ...(errorDetails ? { errorDetails } : {}),
    }),
  );

  return incidentId;
}

export function logSecurityEvent(
  event: string,
  details: {
    code: string;
    requestId?: string;
    userAgentFamily?: string;
  },
) {
  const incidentId = randomUUID();
  const safeEvent =
    safeIdentifier(event) ?? "security.invalid_event";
  const code =
    safeIdentifier(details.code) ?? "INVALID_SECURITY_CODE";
  const requestId = safeRequestId(details.requestId);
  const userAgentFamily = safeUserAgentFamily(
    details.userAgentFamily,
  );

  console.warn(
    JSON.stringify({
      level: "warn",
      event: safeEvent,
      incidentId,
      code,
      ...(requestId ? { requestId } : {}),
      ...(userAgentFamily ? { userAgentFamily } : {}),
    }),
  );

  return incidentId;
}
