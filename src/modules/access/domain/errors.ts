export type AccessConfigurationErrorCode =
  | "MANUAL_ACCESS_GRANTING_REQUIRES_V2"
  | "LEGACY_ACCESS_MODE_FORBIDDEN";

export class AccessConfigurationError extends TypeError {
  constructor(
    public readonly code: AccessConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccessConfigurationError";
  }
}
