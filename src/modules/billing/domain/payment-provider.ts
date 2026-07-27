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
  status: "pending" | "succeeded" | "canceled";
  money: Money;
};

export type VerifiedProviderWebhook = {
  externalEventId: string;
  eventType: string;
  externalPaymentId: string;
  merchantAccountId: string;
  payment: ProviderPayment;
  occurredAt: string;
  rawPayload: unknown;
};

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

  parseAndVerifyWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<VerifiedProviderWebhook>;
}
