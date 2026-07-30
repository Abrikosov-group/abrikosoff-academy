export type AdministrationErrorCode =
  | "ADMINISTRATION_DISABLED"
  | "ADMIN_AUTH_REQUIRED"
  | "ADMIN_LOGIN_REQUIRED"
  | "ADMIN_ROLE_REQUIRED"
  | "ADMIN_PERMISSION_DENIED"
  | "ADMIN_REAUTH_REQUIRED"
  | "ADMIN_VERIFICATION_REJECTED"
  | "ADMIN_COMMAND_INVALID_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
  | "COMMAND_IN_PROGRESS"
  | "COMMAND_ATTEMPT_SUPERSEDED"
  | "COMMAND_RECOVERY_REQUIRED"
  | "USER_NOT_FOUND"
  | "REVOKE_USER_SESSIONS_FAILED";

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
