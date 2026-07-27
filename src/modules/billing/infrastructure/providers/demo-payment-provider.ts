import { createHash } from "node:crypto";
import { BillingError } from "../../domain/errors";
import type {
  ChargeSavedMethodInput,
  CreateProviderCheckoutInput,
  PaymentProvider,
  ProviderPayment,
  RefundProviderPaymentInput,
  VerifiedProviderWebhook,
} from "../../domain/payment-provider";

function deterministicId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

type GlobalWithDemoPayments = typeof globalThis & {
  __academyDemoPayments?: Map<string, ProviderPayment>;
};

function getDemoPaymentRegistry() {
  const globalScope = globalThis as GlobalWithDemoPayments;
  globalScope.__academyDemoPayments ??= new Map();
  return globalScope.__academyDemoPayments;
}

export class DemoPaymentProvider implements PaymentProvider {
  readonly id = "demo" as const;

  constructor(private readonly webhookSecret: string) {}

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderPayment> {
    const confirmationUrl = new URL(input.returnUrl);
    confirmationUrl.searchParams.set("provider", this.id);
    const payment: ProviderPayment = {
      externalPaymentId: deterministicId(
        "demo_payment",
        input.idempotencyKey,
      ),
      status: "succeeded",
      money: input.plan.price,
      confirmationUrl: confirmationUrl.toString(),
      paymentMethodToken: deterministicId(
        "demo_method",
        input.customerId,
      ),
      paymentMethodReusable: input.savePaymentMethod,
      paidAt: new Date().toISOString(),
    };

    getDemoPaymentRegistry().set(payment.externalPaymentId, payment);
    return payment;
  }

  async chargeSavedMethod(
    input: ChargeSavedMethodInput,
  ): Promise<ProviderPayment> {
    const payment: ProviderPayment = {
      externalPaymentId: deterministicId(
        "demo_payment",
        input.idempotencyKey,
      ),
      status: "succeeded",
      money: input.plan.price,
      paymentMethodToken: input.paymentMethodToken,
      paymentMethodReusable: true,
      paidAt: new Date().toISOString(),
    };

    getDemoPaymentRegistry().set(payment.externalPaymentId, payment);
    return payment;
  }

  async refund(input: RefundProviderPaymentInput) {
    return {
      externalRefundId: deterministicId(
        "demo_refund",
        input.idempotencyKey,
      ),
      status: "succeeded" as const,
      money: input.amount,
    };
  }

  async getPayment(
    externalPaymentId: string,
    _merchantAccountId: string,
  ): Promise<ProviderPayment> {
    void _merchantAccountId;
    const payment = getDemoPaymentRegistry().get(externalPaymentId);

    if (!payment) {
      throw new BillingError(
        "PAYMENT_NOT_FOUND",
        "Тестовый платёж не найден.",
        404,
      );
    }

    return payment;
  }

  async parseAndVerifyWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<VerifiedProviderWebhook> {
    if (headers.get("x-demo-webhook-secret") !== this.webhookSecret) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "Тестовое платёжное уведомление отклонено.",
        401,
      );
    }

    let payload: unknown;

    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "Некорректное тестовое платёжное уведомление.",
        400,
        { cause: error },
      );
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("externalPaymentId" in payload) ||
      typeof payload.externalPaymentId !== "string"
    ) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "В тестовом уведомлении отсутствует идентификатор платежа.",
        400,
      );
    }

    const payment = await this.getPayment(payload.externalPaymentId, "");

    return {
      externalEventId: deterministicId("demo_event", rawBody),
      eventType: "payment.succeeded",
      externalPaymentId: payload.externalPaymentId,
      merchantAccountId: "demo-primary",
      payment,
      occurredAt: new Date().toISOString(),
      rawPayload: payload,
    };
  }
}
