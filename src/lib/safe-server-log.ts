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

export function logUnexpectedServerError(
  event: string,
  error: unknown,
) {
  const incidentId = randomUUID();

  console.error(
    JSON.stringify({
      level: "error",
      event,
      incidentId,
      errorType: classifyError(error),
    }),
  );

  return incidentId;
}
