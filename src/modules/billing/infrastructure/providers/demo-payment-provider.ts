import { createHash } from "node:crypto";
import { BillingError } from "../../domain/errors";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
  ProviderPayment,
  ProviderRefund,
  ProviderWebhookReference,
  RefundProviderPaymentInput,
  VerifiedProviderWebhook,
} from "../../domain/payment-provider";

function deterministicId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

type GlobalWithDemoPayments = typeof globalThis & {
  __academyDemoPayments?: Map<string, ProviderPayment>;
  __academyDemoRefunds?: Map<string, ProviderRefund>;
};

function getDemoPaymentRegistry() {
  const globalScope = globalThis as GlobalWithDemoPayments;
  globalScope.__academyDemoPayments ??= new Map();
  return globalScope.__academyDemoPayments;
}

function getDemoRefundRegistry() {
  const globalScope = globalThis as GlobalWithDemoPayments;
  globalScope.__academyDemoRefunds ??= new Map();
  return globalScope.__academyDemoRefunds;
}

function parseDemoWebhookBody(rawBody: string) {
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

  return {
    externalPaymentId: payload.externalPaymentId,
    auditPayload: {
      externalPaymentId: payload.externalPaymentId,
    },
  };
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
      paidAt: new Date().toISOString(),
      paymentMethodToken:
        input.billingMode === "recurring"
          ? deterministicId("demo_method", input.customerId)
          : undefined,
      paymentMethodSaved: input.billingMode === "recurring",
    };

    getDemoPaymentRegistry().set(payment.externalPaymentId, payment);
    return payment;
  }

  async refund(input: RefundProviderPaymentInput) {
    const refund: ProviderRefund = {
      externalRefundId: deterministicId(
        "demo_refund",
        input.idempotencyKey,
      ),
      externalPaymentId: input.externalPaymentId,
      status: "succeeded" as const,
      money: input.amount,
      occurredAt: new Date().toISOString(),
    };

    getDemoRefundRegistry().set(refund.externalRefundId, refund);
    return refund;
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

  async getRefund(
    externalRefundId: string,
    _merchantAccountId: string,
  ): Promise<ProviderRefund> {
    void _merchantAccountId;
    const refund = getDemoRefundRegistry().get(externalRefundId);

    if (!refund) {
      throw new BillingError(
        "PAYMENT_NOT_FOUND",
        "Тестовый возврат не найден.",
        404,
      );
    }

    return refund;
  }

  parseWebhookReference(
    rawBody: string,
    headers: Headers,
  ): ProviderWebhookReference {
    if (headers.get("x-demo-webhook-secret") !== this.webhookSecret) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "Тестовое платёжное уведомление отклонено.",
        401,
      );
    }

    const payload = parseDemoWebhookBody(rawBody);

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
    headers: Headers,
  ): Promise<VerifiedProviderWebhook> {
    const reference = this.parseWebhookReference(rawBody, headers);
    const payload = parseDemoWebhookBody(rawBody);
    const payment = await this.getPayment(
      reference.externalPaymentId,
      reference.merchantAccountId,
    );

    return {
      ...reference,
      kind: "payment",
      externalEventId: deterministicId("demo_event", rawBody),
      payment,
      occurredAt: new Date().toISOString(),
      auditPayload: payload.auditPayload,
    };
  }
}
