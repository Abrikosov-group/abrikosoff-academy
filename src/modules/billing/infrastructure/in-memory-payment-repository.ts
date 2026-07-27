import type {
  ApplyPaymentEventInput,
  ApplyPaymentEventResult,
  PaymentRepository,
  SaveCheckoutInput,
} from "../application/payment-repository";
import type {
  OrderStatus,
  PaymentStatus,
  StoredCheckout,
} from "../domain/types";

type RepositoryState = {
  checkoutsByIdempotencyKey: Map<string, StoredCheckout>;
  checkoutKeyByExternalPayment: Map<string, string>;
  processedEvents: Set<string>;
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
    externalPaymentId: string,
  ): Promise<StoredCheckout | null> {
    const checkoutKey = this.state.checkoutKeyByExternalPayment.get(
      externalPaymentKey(provider, externalPaymentId),
    );

    if (!checkoutKey) {
      return null;
    }

    return this.findCheckoutByIdempotencyKey(checkoutKey);
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
      input.externalPaymentId,
    );

    if (this.state.processedEvents.has(processedEventKey)) {
      return { outcome: "duplicate", checkout };
    }

    this.state.processedEvents.add(processedEventKey);

    if (!checkout) {
      return { outcome: "unmatched", checkout: null };
    }

    const updated: StoredCheckout = {
      ...checkout,
      status: input.status,
      paymentMethodToken:
        input.paymentMethodToken ?? checkout.paymentMethodToken,
      updatedAt: new Date().toISOString(),
    };

    this.state.checkoutsByIdempotencyKey.set(
      checkout.idempotencyKey,
      updated,
    );
    this.state.orderStatuses.set(
      checkout.orderId,
      orderStatusForPayment(input.status),
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
    checkoutsByIdempotencyKey: new Map(),
    checkoutKeyByExternalPayment: new Map(),
    processedEvents: new Set(),
    orderStatuses: new Map(),
  };

  return new InMemoryPaymentRepository(
    globalScope.__academyBillingRepositoryState,
  );
}
