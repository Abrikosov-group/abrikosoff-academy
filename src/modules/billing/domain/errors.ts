export type BillingErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "INVALID_PLAN"
  | "ACCESS_ALREADY_ACTIVE"
  | "PAYMENTS_DISABLED"
  | "NO_PAYMENT_ROUTE"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_REQUEST_FAILED"
  | "INVALID_REQUEST_ORIGIN"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "PAYMENT_METHOD_NOT_SAVED"
  | "RENEWAL_RECONCILIATION_REQUIRED"
  | "PAYMENT_NOT_FOUND"
  | "UNSUPPORTED_PROVIDER"
  | "WEBHOOK_NOT_READY"
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
