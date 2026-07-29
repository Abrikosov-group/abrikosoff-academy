export type AdministrationErrorCode =
  | "ADMINISTRATION_DISABLED"
  | "ADMIN_AUTH_REQUIRED"
  | "ADMIN_LOGIN_REQUIRED"
  | "ADMIN_ROLE_REQUIRED"
  | "ADMIN_PERMISSION_DENIED"
  | "ADMIN_REAUTH_REQUIRED"
  | "ADMIN_VERIFICATION_REJECTED";

export class AdministrationError extends Error {
  constructor(
    public readonly code: AdministrationErrorCode,
    public readonly publicMessage: string,
    public readonly httpStatus: number,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "AdministrationError";
  }
}
