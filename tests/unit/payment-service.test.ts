import { describe, expect, it } from "vitest";
import type {
  ApplyPaymentEventInput,
  ApplyPaymentEventResult,
  ApplyRefundEventInput,
  ApplyRefundEventResult,
  PaymentRepository,
  ReserveCheckoutInput,
  SaveCheckoutInput,
} from "@/modules/billing/application/payment-repository";
import { PaymentService } from "@/modules/billing/application/payment-service";
import { PaymentProviderRouter } from "@/modules/billing/application/provider-router";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
  ProviderPayment,
  ProviderWebhookReference,
  RefundProviderPaymentInput,
  VerifiedProviderWebhook,
} from "@/modules/billing/domain/payment-provider";
import type {
  CheckoutReservation,
  StoredCheckout,
} from "@/modules/billing/domain/types";

class FlakyPaymentRepository implements PaymentRepository {
  reservation: CheckoutReservation | null = null;
  checkout: StoredCheckout | null = null;
  failNextSave = true;
  processedEvents = new Set<string>();

  async findCheckoutReservationByIdempotencyKey(
    idempotencyKey: string,
  ) {
    return this.reservation?.idempotencyKey === idempotencyKey
      ? this.reservation
      : null;
  }

  async reserveCheckout(input: ReserveCheckoutInput) {
    this.reservation ??= input;
    return this.reservation;
  }

  async findCheckoutByIdempotencyKey(idempotencyKey: string) {
    return this.checkout?.idempotencyKey === idempotencyKey
      ? this.checkout
      : null;
  }

  async saveCheckout(input: SaveCheckoutInput) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("Имитация сбоя базы после ответа провайдера");
    }

    this.checkout = input;
    return input;
  }

  async findCheckoutByExternalPaymentId(
    provider: StoredCheckout["provider"],
    merchantAccountId: string,
    externalPaymentId: string,
  ) {
    return this.checkout?.provider === provider &&
      this.checkout.merchantAccountId === merchantAccountId &&
      this.checkout.externalPaymentId === externalPaymentId
      ? this.checkout
      : null;
  }

  async findCheckoutByOrderIdForCustomer(
    orderId: string,
    customerId: string,
  ) {
    return this.checkout?.orderId === orderId &&
      this.checkout.customerId === customerId
      ? this.checkout
      : null;
  }

  async applyPaymentEvent(
    input: ApplyPaymentEventInput,
  ): Promise<ApplyPaymentEventResult> {
    const checkout = await this.findCheckoutByExternalPaymentId(
      input.provider,
      input.merchantAccountId,
      input.externalPaymentId,
    );

    if (!checkout) {
      return { outcome: "unmatched", checkout: null };
    }

    if (this.processedEvents.has(input.externalEventId)) {
      return { outcome: "duplicate", checkout };
    }

    this.processedEvents.add(input.externalEventId);
    this.checkout = {
      ...checkout,
      status: input.status,
      updatedAt: input.occurredAt,
    };
    return { outcome: "applied", checkout: this.checkout };
  }

  async applyRefundEvent(
    _input: ApplyRefundEventInput,
  ): Promise<ApplyRefundEventResult> {
    void _input;
    return this.checkout
      ? { outcome: "applied", checkout: this.checkout }
      : { outcome: "unmatched", checkout: null };
  }
}

class IdempotentPaymentProvider implements PaymentProvider {
  readonly id = "demo" as const;
  readonly checkoutInputs: CreateProviderCheckoutInput[] = [];
  currentStatus: ProviderPayment["status"] = "pending";
  verifyCalls = 0;
  private latestPayment: ProviderPayment | null = null;

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderPayment> {
    this.checkoutInputs.push(input);
    this.latestPayment = {
      externalPaymentId: `external_${input.idempotencyKey}`,
      status: this.currentStatus,
      money: input.plan.price,
      confirmationUrl: input.returnUrl,
    };
    return this.latestPayment;
  }

  async refund(input: RefundProviderPaymentInput) {
    return {
      externalRefundId: `refund_${input.idempotencyKey}`,
      externalPaymentId: input.externalPaymentId,
      status: "succeeded" as const,
      money: input.amount,
    };
  }

  async getPayment(): Promise<ProviderPayment> {
    if (!this.latestPayment) {
      throw new Error("Тестовый платёж не создан");
    }

    return {
      ...this.latestPayment,
      status: this.currentStatus,
      paidAt:
        this.currentStatus === "succeeded"
          ? "2026-07-28T10:05:00.000Z"
          : undefined,
    };
  }

  async getRefund(
    externalRefundId: string,
  ) {
    return {
      externalRefundId,
      externalPaymentId:
        this.latestPayment?.externalPaymentId ?? "external_unknown",
      status: "succeeded" as const,
      money: this.latestPayment?.money ?? {
        amountMinor: 1_500_00,
        currency: "RUB" as const,
      },
    };
  }

  parseWebhookReference(rawBody: string): ProviderWebhookReference {
    const payload = JSON.parse(rawBody) as {
      externalPaymentId: string;
    };

    return {
      kind: "payment",
      eventType: "payment.succeeded",
      externalOperationId: payload.externalPaymentId,
      externalPaymentId: payload.externalPaymentId,
      merchantAccountId: "demo-primary",
    };
  }

  async parseAndVerifyWebhook(
    rawBody: string,
  ): Promise<VerifiedProviderWebhook> {
    this.verifyCalls += 1;
    const reference = this.parseWebhookReference(rawBody);
    const payment = await this.getPayment();

    return {
      ...reference,
      kind: "payment",
      externalEventId: `event_${reference.externalPaymentId}`,
      payment,
      occurredAt: "2026-07-28T10:05:00.000Z",
      auditPayload: {
        externalPaymentId: reference.externalPaymentId,
      },
    };
  }
}

describe("PaymentService", () => {
  it("повторно использует зарезервированный заказ после сбоя сохранения", async () => {
    const repository = new FlakyPaymentRepository();
    const provider = new IdempotentPaymentProvider();
    const service = new PaymentService({
      repository,
      router: new PaymentProviderRouter({
        providers: [provider],
        routes: [
          {
            provider: "demo",
            merchantAccountId: "demo-primary",
            legalEntityId: "ip-fedotova",
            currency: "RUB",
            countryCodes: ["RU"],
            priority: 100,
          },
        ],
      }),
    });
    const command = {
      customerId: "5d1efc7f-b455-4a48-922f-1347ef9df20e",
      planId: "annual" as const,
      countryCode: "RU",
      legalEntityId: "ip-fedotova",
      receiptContact: { email: "student@example.test" },
      offerAcceptance: {
        acceptedAt: "2026-07-28T10:00:00.000Z",
        offerVersion: "2026-07-28",
      },
      idempotencyKey: "checkout-retry-001",
      publicBaseUrl: "https://academy.example.test",
    };

    await expect(service.createCheckout(command)).rejects.toThrow(
      "Имитация сбоя базы",
    );

    const repeated = await service.createCheckout(command);
    const completed = await service.createCheckout(command);

    expect(repository.reservation).not.toBeNull();
    expect(repeated.orderId).toBe(repository.reservation?.orderId);
    expect(completed).toEqual(repeated);
    expect(provider.checkoutInputs).toHaveLength(2);
    expect(provider.checkoutInputs[0].orderId).toBe(
      provider.checkoutInputs[1].orderId,
    );
    expect(provider.checkoutInputs[0].returnUrl).toBe(
      provider.checkoutInputs[1].returnUrl,
    );
  });

  it("не вызывает API провайдера для неизвестного webhook", async () => {
    const repository = new FlakyPaymentRepository();
    const provider = new IdempotentPaymentProvider();
    const service = new PaymentService({
      repository,
      router: new PaymentProviderRouter({
        providers: [provider],
        routes: [],
      }),
    });

    await expect(
      service.handleWebhook(
        "demo",
        JSON.stringify({ externalPaymentId: "external_unknown" }),
        new Headers(),
      ),
    ).rejects.toMatchObject({
      code: "WEBHOOK_NOT_READY",
      httpStatus: 503,
    });
    expect(provider.verifyCalls).toBe(0);
  });

  it("сверяет ожидающий платёж после возврата пользователя", async () => {
    const repository = new FlakyPaymentRepository();
    repository.failNextSave = false;
    const provider = new IdempotentPaymentProvider();
    const service = new PaymentService({
      repository,
      router: new PaymentProviderRouter({
        providers: [provider],
        routes: [
          {
            provider: "demo",
            merchantAccountId: "demo-primary",
            legalEntityId: "ip-fedotova",
            currency: "RUB",
            countryCodes: ["RU"],
            priority: 100,
          },
        ],
      }),
    });
    const command = {
      customerId: "5d1efc7f-b455-4a48-922f-1347ef9df20e",
      planId: "monthly" as const,
      countryCode: "RU",
      legalEntityId: "ip-fedotova",
      receiptContact: { email: "student@example.test" },
      offerAcceptance: {
        acceptedAt: "2026-07-28T10:00:00.000Z",
        offerVersion: "2026-07-28",
      },
      idempotencyKey: "checkout-reconcile-001",
      publicBaseUrl: "https://academy.example.test",
    };
    const checkout = await service.createCheckout(command);

    expect(checkout.status).toBe("pending");
    provider.currentStatus = "succeeded";

    const reconciled = await service.reconcileCheckout(
      checkout.orderId,
      command.customerId,
    );

    expect(reconciled.status).toBe("succeeded");
    expect(repository.checkout?.status).toBe("succeeded");
  });
});
