import type {
  Money,
  PaymentProviderId,
  PaymentStatus,
  ReceiptContact,
  SubscriptionPlan,
} from "./types";

export type CreateProviderCheckoutInput = {
  orderId: string;
  customerId: string;
  legalEntityId: string;
  merchantAccountId: string;
  plan: SubscriptionPlan;
  receiptContact: ReceiptContact;
  idempotencyKey: string;
  returnUrl: string;
};

export type RefundProviderPaymentInput = {
  externalPaymentId: string;
  merchantAccountId: string;
  amount: Money;
  idempotencyKey: string;
  description?: string;
};

export type ProviderPayment = {
  externalPaymentId: string;
  status: PaymentStatus;
  money: Money;
  confirmationUrl?: string;
  paidAt?: string;
};

export type ProviderRefund = {
  externalRefundId: string;
  externalPaymentId: string;
  status: "pending" | "succeeded" | "canceled";
  money: Money;
  occurredAt?: string;
};

export type ProviderWebhookReference = {
  kind: "payment" | "refund";
  eventType: string;
  externalOperationId: string;
  externalPaymentId: string;
  merchantAccountId: string;
};

type VerifiedProviderWebhookBase = ProviderWebhookReference & {
  externalEventId: string;
  occurredAt: string;
  auditPayload: unknown;
};

export type VerifiedPaymentWebhook = VerifiedProviderWebhookBase & {
  kind: "payment";
  payment: ProviderPayment;
};

export type VerifiedRefundWebhook = VerifiedProviderWebhookBase & {
  kind: "refund";
  refund: ProviderRefund;
};

export type VerifiedProviderWebhook =
  | VerifiedPaymentWebhook
  | VerifiedRefundWebhook;

export interface PaymentProvider {
  readonly id: PaymentProviderId;

  createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderPayment>;

  refund(
    input: RefundProviderPaymentInput,
  ): Promise<ProviderRefund>;

  getPayment(
    externalPaymentId: string,
    merchantAccountId: string,
  ): Promise<ProviderPayment>;

  getRefund(
    externalRefundId: string,
    merchantAccountId: string,
  ): Promise<ProviderRefund>;

  parseWebhookReference(
    rawBody: string,
    headers: Headers,
  ): ProviderWebhookReference;

  parseAndVerifyWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<VerifiedProviderWebhook>;
}
