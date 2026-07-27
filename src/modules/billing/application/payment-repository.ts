import type {
  CheckoutReservation,
  PaymentProviderId,
  PaymentStatus,
  StoredCheckout,
} from "../domain/types";

export type ReserveCheckoutInput = CheckoutReservation;
export type SaveCheckoutInput = StoredCheckout;

export type ApplyPaymentEventInput = {
  provider: PaymentProviderId;
  merchantAccountId: string;
  externalEventId: string;
  eventType: string;
  externalPaymentId: string;
  status: PaymentStatus;
  occurredAt: string;
  payloadSha256: string;
  payload: unknown;
};

export type ApplyPaymentEventResult =
  | { outcome: "applied"; checkout: StoredCheckout }
  | { outcome: "duplicate"; checkout: StoredCheckout | null }
  | { outcome: "unmatched"; checkout: null };

export interface PaymentRepository {
  findCheckoutReservationByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<CheckoutReservation | null>;

  reserveCheckout(
    input: ReserveCheckoutInput,
  ): Promise<CheckoutReservation>;

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
