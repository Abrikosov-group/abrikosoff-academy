export class ReleaseGateError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.code = code;
    this.name = "ReleaseGateError";
  }
}

export function assertGate(condition, code, message) {
  if (!condition) {
    throw new ReleaseGateError(code, message);
  }
}

export function formatGateError(error) {
  if (error instanceof ReleaseGateError) {
    return `[${error.code}] ${error.message}`;
  }

  if (error instanceof Error) {
    return `[UNEXPECTED_ERROR] ${error.message}`;
  }

  return "[UNEXPECTED_ERROR] Неизвестная ошибка";
}
