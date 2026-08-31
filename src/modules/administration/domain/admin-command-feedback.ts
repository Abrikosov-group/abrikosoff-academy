export function administrationCommandErrorMessage(value: unknown) {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const error =
    body?.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? (body.error as Record<string, unknown>)
      : undefined;
  const message =
    typeof error?.message === "string" && error.message.length > 0
      ? error.message
      : "Операция не выполнена.";
  const requestId =
    typeof body?.requestId === "string" && body.requestId.length > 0
      ? body.requestId
      : undefined;

  return requestId
    ? `${message} Идентификатор запроса: ${requestId}.`
    : message;
}
