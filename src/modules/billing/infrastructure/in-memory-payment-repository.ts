import type {
  ApplyPaymentEventInput,
  ApplyPaymentEventResult,
  ApplyRefundEventInput,
  ApplyRefundEventResult,
  PaymentRepository,
  ReserveCheckoutInput,
  SaveCheckoutInput,
} from "../application/payment-repository";
import type {
  CheckoutReservation,
  OrderStatus,
  PaymentStatus,
  StoredCheckout,
} from "../domain/types";

type RepositoryState = {
  reservationsByIdempotencyKey: Map<string, CheckoutReservation>;
  checkoutsByIdempotencyKey: Map<string, StoredCheckout>;
  checkoutKeyByExternalPayment: Map<string, string>;
  processedEvents: Set<string>;
  successfulRefundMinorByPayment: Map<string, number>;
  orderStatuses: Map<string, OrderStatus>;
};

function externalPaymentKey(provider: string, externalPaymentId: string) {
  return `${provider}:${externalPaymentId}`;
}

function eventKey(provider: string, externalEventId: string) {
  return `${provider}:${externalEventId}`;
}

function orderStatusForPayment(status: PaymentStatus): OrderStatus {
  switch (status) {
    case "succeeded":
      return "paid";
    case "partially_refunded":
      return "partially_refunded";
    case "refunded":
      return "refunded";
    case "canceled":
    case "failed":
      return "canceled";
    default:
      return "pending";
  }
}

export class InMemoryPaymentRepository implements PaymentRepository {
  constructor(private readonly state: RepositoryState) {}

  async findCheckoutReservationByIdempotencyKey(
    idempotencyKey: string,
  ) {
    return (
      this.state.reservationsByIdempotencyKey.get(idempotencyKey) ??
      null
    );
  }

  async reserveCheckout(
    input: ReserveCheckoutInput,
  ): Promise<CheckoutReservation> {
    const existing = this.state.reservationsByIdempotencyKey.get(
      input.idempotencyKey,
    );

    if (existing) {
      return existing;
    }

    this.state.reservationsByIdempotencyKey.set(
      input.idempotencyKey,
      input,
    );
    return input;
  }

  async findCheckoutByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredCheckout | null> {
    return this.state.checkoutsByIdempotencyKey.get(idempotencyKey) ?? null;
  }

  async saveCheckout(input: SaveCheckoutInput): Promise<StoredCheckout> {
    const existing = this.state.checkoutsByIdempotencyKey.get(
      input.idempotencyKey,
    );

    if (existing) {
      return existing;
    }

    this.state.checkoutsByIdempotencyKey.set(
      input.idempotencyKey,
      input,
    );
    this.state.checkoutKeyByExternalPayment.set(
      externalPaymentKey(input.provider, input.externalPaymentId),
      input.idempotencyKey,
    );
    this.state.orderStatuses.set(
      input.orderId,
      orderStatusForPayment(input.status),
    );

    return input;
  }

  async findCheckoutByExternalPaymentId(
    provider: StoredCheckout["provider"],
    _merchantAccountId: string,
    externalPaymentId: string,
  ): Promise<StoredCheckout | null> {
    void _merchantAccountId;
    const checkoutKey = this.state.checkoutKeyByExternalPayment.get(
      externalPaymentKey(provider, externalPaymentId),
    );

    if (!checkoutKey) {
      return null;
    }

    return this.findCheckoutByIdempotencyKey(checkoutKey);
  }

  async findCheckoutByOrderIdForCustomer(
    orderId: string,
    customerId: string,
  ): Promise<StoredCheckout | null> {
    for (const checkout of this.state.checkoutsByIdempotencyKey.values()) {
      if (
        checkout.orderId === orderId &&
        checkout.customerId === customerId
      ) {
        return checkout;
      }
    }

    return null;
  }

  async applyPaymentEvent(
    input: ApplyPaymentEventInput,
  ): Promise<ApplyPaymentEventResult> {
    const processedEventKey = eventKey(
      input.provider,
      input.externalEventId,
    );
    const checkout = await this.findCheckoutByExternalPaymentId(
      input.provider,
      input.merchantAccountId,
      input.externalPaymentId,
    );

    if (this.state.processedEvents.has(processedEventKey)) {
      return { outcome: "duplicate", checkout };
    }

    if (!checkout) {
      return { outcome: "unmatched", checkout: null };
    }

    this.state.processedEvents.add(processedEventKey);
    const nextStatus =
      checkout.status === "partially_refunded" ||
      checkout.status === "refunded"
        ? checkout.status
        : input.status;
    const updated: StoredCheckout = {
      ...checkout,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };

    this.state.checkoutsByIdempotencyKey.set(
      checkout.idempotencyKey,
      updated,
    );
    this.state.orderStatuses.set(
      checkout.orderId,
      orderStatusForPayment(nextStatus),
    );

    return { outcome: "applied", checkout: updated };
  }

  async applyRefundEvent(
    input: ApplyRefundEventInput,
  ): Promise<ApplyRefundEventResult> {
    const processedEventKey = eventKey(
      input.provider,
      input.externalEventId,
    );
    const checkout = await this.findCheckoutByExternalPaymentId(
      input.provider,
      input.merchantAccountId,
      input.externalPaymentId,
    );

    if (this.state.processedEvents.has(processedEventKey)) {
      return { outcome: "duplicate", checkout };
    }

    if (!checkout) {
      return { outcome: "unmatched", checkout: null };
    }

    this.state.processedEvents.add(processedEventKey);
    let nextStatus = checkout.status;

    if (input.status === "succeeded") {
      const refundedAmountMinor =
        (this.state.successfulRefundMinorByPayment.get(
          checkout.paymentId,
        ) ?? 0) + input.money.amountMinor;
      this.state.successfulRefundMinorByPayment.set(
        checkout.paymentId,
        refundedAmountMinor,
      );
      nextStatus =
        refundedAmountMinor >= checkout.money.amountMinor
          ? "refunded"
          : "partially_refunded";
    }

    const updated: StoredCheckout = {
      ...checkout,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };

    this.state.checkoutsByIdempotencyKey.set(
      checkout.idempotencyKey,
      updated,
    );
    this.state.orderStatuses.set(
      checkout.orderId,
      orderStatusForPayment(nextStatus),
    );

    return { outcome: "applied", checkout: updated };
  }
}

type GlobalWithBillingRepository = typeof globalThis & {
  __academyBillingRepositoryState?: RepositoryState;
};

export function getInMemoryPaymentRepository() {
  const globalScope = globalThis as GlobalWithBillingRepository;

  globalScope.__academyBillingRepositoryState ??= {
    reservationsByIdempotencyKey: new Map(),
    checkoutsByIdempotencyKey: new Map(),
    checkoutKeyByExternalPayment: new Map(),
    processedEvents: new Set(),
    successfulRefundMinorByPayment: new Map(),
    orderStatuses: new Map(),
  };
  globalScope.__academyBillingRepositoryState.reservationsByIdempotencyKey ??=
    new Map();
  globalScope.__academyBillingRepositoryState.successfulRefundMinorByPayment ??=
    new Map();

  return new InMemoryPaymentRepository(
    globalScope.__academyBillingRepositoryState,
  );
}
