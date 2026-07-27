import type {
  PaymentProviderId,
  PaymentStatus,
  StoredCheckout,
} from "../domain/types";

export type SaveCheckoutInput = StoredCheckout;

export type ApplyPaymentEventInput = {
  provider: PaymentProviderId;
  merchantAccountId: string;
  externalEventId: string;
  eventType: string;
  externalPaymentId: string;
  status: PaymentStatus;
  paymentMethodToken?: string;
  occurredAt: string;
  payloadSha256: string;
  payload: unknown;
};

export type ApplyPaymentEventResult =
  | { outcome: "applied"; checkout: StoredCheckout }
  | { outcome: "duplicate"; checkout: StoredCheckout | null }
  | { outcome: "unmatched"; checkout: null };

export interface PaymentRepository {
  findCheckoutByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredCheckout | null>;

  saveCheckout(input: SaveCheckoutInput): Promise<StoredCheckout>;

  findCheckoutByExternalPaymentId(
    provider: PaymentProviderId,
    externalPaymentId: string,
  ): Promise<StoredCheckout | null>;

  applyPaymentEvent(
    input: ApplyPaymentEventInput,
  ): Promise<ApplyPaymentEventResult>;
}
