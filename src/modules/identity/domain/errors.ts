export type IdentityErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_UNAVAILABLE"
  | "INVALID_LOGIN"
  | "INVALID_REQUEST"
  | "LOGIN_EXPIRED";

export class IdentityError extends Error {
  constructor(
    public readonly code: IdentityErrorCode,
    public readonly publicMessage: string,
    public readonly httpStatus: number,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "IdentityError";
  }
}
