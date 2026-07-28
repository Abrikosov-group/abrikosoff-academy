export const paymentProviderIds = ["demo", "yookassa"] as const;
export type PaymentProviderId = (typeof paymentProviderIds)[number];

export const subscriptionPlanIds = ["monthly", "annual"] as const;
export type SubscriptionPlanId = (typeof subscriptionPlanIds)[number];

export type CurrencyCode = "RUB";

export type Money = {
  amountMinor: number;
  currency: CurrencyCode;
};

export type PaymentStatus =
  | "created"
  | "pending"
  | "requires_action"
  | "succeeded"
  | "canceled"
  | "failed"
  | "partially_refunded"
  | "refunded";

export type OrderStatus =
  | "pending"
  | "paid"
  | "canceled"
  | "partially_refunded"
  | "refunded";

export type ReceiptContact = {
  email?: string;
  phone?: string;
};

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  title: string;
  durationMonths: number;
  price: Money;
  receiptItemName: string;
};

export type CheckoutCommand = {
  customerId: string;
  planId: SubscriptionPlanId;
  countryCode: string;
  legalEntityId: string;
  receiptContact: ReceiptContact;
  offerAcceptance: {
    acceptedAt: string;
    offerVersion: string;
  };
  idempotencyKey: string;
  publicBaseUrl: string;
};

export type CheckoutResult = {
  orderId: string;
  paymentId: string;
  provider: PaymentProviderId;
  status: PaymentStatus;
  confirmationUrl: string;
};

export type CheckoutReservation = {
  orderId: string;
  customerId: string;
  planId: SubscriptionPlanId;
  legalEntityId: string;
  countryCode: string;
  merchantAccountId: string;
  money: Money;
  idempotencyKey: string;
  provider: PaymentProviderId;
  offerAcceptedAt: string;
  offerVersion: string;
  receiptContact: ReceiptContact;
  createdAt: string;
  updatedAt: string;
};

export type StoredCheckout = CheckoutReservation &
  Omit<CheckoutResult, "orderId" | "provider"> & {
    externalPaymentId: string;
  };

export type ProviderRoute = {
  provider: PaymentProviderId;
  merchantAccountId: string;
  legalEntityId: string;
  currency: CurrencyCode;
  countryCodes?: readonly string[];
  priority: number;
};
