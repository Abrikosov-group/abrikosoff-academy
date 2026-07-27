import { describe, expect, it } from "vitest";
import type {
  ApplyPaymentEventResult,
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

  async findCheckoutByExternalPaymentId() {
    return this.checkout;
  }

  async applyPaymentEvent(): Promise<ApplyPaymentEventResult> {
    return { outcome: "unmatched", checkout: null };
  }
}

class IdempotentPaymentProvider implements PaymentProvider {
  readonly id = "demo" as const;
  readonly checkoutInputs: CreateProviderCheckoutInput[] = [];

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderPayment> {
    this.checkoutInputs.push(input);
    return {
      externalPaymentId: `external_${input.idempotencyKey}`,
      status: "pending",
      money: input.plan.price,
      confirmationUrl: input.returnUrl,
    };
  }

  async refund(input: RefundProviderPaymentInput) {
    return {
      externalRefundId: `refund_${input.idempotencyKey}`,
      status: "succeeded" as const,
      money: input.amount,
    };
  }

  async getPayment(): Promise<ProviderPayment> {
    throw new Error("Метод не используется в этом тесте");
  }

  async parseAndVerifyWebhook(): Promise<VerifiedProviderWebhook> {
    throw new Error("Метод не используется в этом тесте");
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
});
