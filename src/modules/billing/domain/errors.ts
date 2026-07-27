export type BillingErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "INVALID_PLAN"
  | "PAYMENTS_DISABLED"
  | "NO_PAYMENT_ROUTE"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_REQUEST_FAILED"
  | "PAYMENT_NOT_FOUND"
  | "UNSUPPORTED_PROVIDER"
  | "WEBHOOK_REJECTED";

export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    public readonly publicMessage: string,
    public readonly httpStatus: number,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "BillingError";
  }
}
