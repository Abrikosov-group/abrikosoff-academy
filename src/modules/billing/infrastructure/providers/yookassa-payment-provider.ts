import "server-only";

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
import type {
  CurrencyCode,
  Money,
  PaymentStatus,
} from "../../domain/types";

type JsonRecord = Record<string, unknown>;

type YooKassaPaymentProviderOptions = {
  shopId: string;
  secretKey: string;
  merchantAccountId: string;
};

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null
    ? (value as JsonRecord)
    : null;
}

function requiredString(record: JsonRecord, key: string) {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "Платёжный провайдер вернул неполный ответ.",
      502,
    );
  }

  return value;
}

function formatMoney(money: Money) {
  return {
    value: (money.amountMinor / 100).toFixed(2),
    currency: money.currency,
  };
}

function buildReceipt(
  plan: CreateProviderCheckoutInput["plan"],
  receiptContact: CreateProviderCheckoutInput["receiptContact"],
) {
  const contact = {
    ...(receiptContact.email ? { email: receiptContact.email } : {}),
    ...(receiptContact.phone ? { phone: receiptContact.phone } : {}),
  };

  if (!contact.email && !contact.phone) {
    throw new BillingError(
      "INVALID_REQUEST",
      "Для отправки кассового чека укажите электронную почту.",
      400,
    );
  }

  return {
    customer: contact,
    items: [
      {
        description: plan.receiptItemName,
        quantity: "1.00",
        amount: formatMoney(plan.price),
        vat_code: 1,
        payment_subject: "service",
        payment_mode: "full_payment",
      },
    ],
  };
}

function parseMoney(value: unknown): Money {
  const record = asRecord(value);

  if (!record) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "Платёжный провайдер не вернул сумму платежа.",
      502,
    );
  }

  const rawValue = requiredString(record, "value");
  const rawCurrency = requiredString(record, "currency");
  const amountMinor = Math.round(Number(rawValue) * 100);

  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    rawCurrency !== "RUB"
  ) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "Платёжный провайдер вернул некорректную сумму.",
      502,
    );
  }

  return {
    amountMinor,
    currency: rawCurrency as CurrencyCode,
  };
}

function mapPaymentStatus(status: string): PaymentStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "waiting_for_capture":
      return "pending";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    default:
      throw new BillingError(
        "PROVIDER_REQUEST_FAILED",
        "Платёжный провайдер вернул неизвестный статус.",
        502,
      );
  }
}

function parseProviderPayment(payload: unknown): ProviderPayment {
  const payment = asRecord(payload);

  if (!payment) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "Платёжный провайдер вернул некорректный ответ.",
      502,
    );
  }

  const confirmation = asRecord(payment.confirmation);
  const confirmationUrl =
    confirmation && typeof confirmation.confirmation_url === "string"
      ? confirmation.confirmation_url
      : undefined;
  const paidAt =
    typeof payment.captured_at === "string"
      ? payment.captured_at
      : typeof payment.created_at === "string"
        ? payment.created_at
        : undefined;
  const paymentMethod = asRecord(payment.payment_method);
  const paymentMethodSaved = paymentMethod?.saved === true;
  const paymentMethodToken =
    paymentMethodSaved && typeof paymentMethod?.id === "string"
      ? paymentMethod.id
      : undefined;

  return {
    externalPaymentId: requiredString(payment, "id"),
    status: mapPaymentStatus(requiredString(payment, "status")),
    money: parseMoney(payment.amount),
    confirmationUrl,
    paidAt,
    paymentMethodToken,
    paymentMethodSaved,
  };
}

function parseProviderRefund(payload: unknown): ProviderRefund {
  const refund = asRecord(payload);

  if (!refund) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "ЮKassa вернула некорректный ответ на возврат.",
      502,
    );
  }

  const rawStatus = requiredString(refund, "status");

  if (
    rawStatus !== "pending" &&
    rawStatus !== "succeeded" &&
    rawStatus !== "canceled"
  ) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "ЮKassa вернула неизвестный статус возврата.",
      502,
    );
  }

  return {
    externalRefundId: requiredString(refund, "id"),
    externalPaymentId: requiredString(refund, "payment_id"),
    status: rawStatus,
    money: parseMoney(refund.amount),
    occurredAt:
      typeof refund.created_at === "string"
        ? refund.created_at
        : undefined,
  };
}

type ParsedWebhookNotification = ProviderWebhookReference & {
  notification: JsonRecord;
  object: JsonRecord;
};

function parseWebhookNotification(
  rawBody: string,
  merchantAccountId: string,
): ParsedWebhookNotification {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    throw new BillingError(
      "WEBHOOK_REJECTED",
      "Некорректное уведомление ЮKassa.",
      400,
      { cause: error },
    );
  }

  const notification = asRecord(payload);
  const object = notification ? asRecord(notification.object) : null;

  if (
    !notification ||
    notification.type !== "notification" ||
    typeof notification.event !== "string" ||
    !object
  ) {
    throw new BillingError(
      "WEBHOOK_REJECTED",
      "Формат уведомления ЮKassa не поддерживается.",
      400,
    );
  }

  const eventType = notification.event;
  const externalOperationId =
    typeof object.id === "string" ? object.id : "";

  if (!externalOperationId) {
    throw new BillingError(
      "WEBHOOK_REJECTED",
      "В уведомлении ЮKassa отсутствует идентификатор операции.",
      400,
    );
  }

  if (eventType.startsWith("payment.")) {
    return {
      kind: "payment",
      eventType,
      externalOperationId,
      externalPaymentId: externalOperationId,
      merchantAccountId,
      notification,
      object,
    };
  }

  if (eventType.startsWith("refund.")) {
    const externalPaymentId =
      typeof object.payment_id === "string" ? object.payment_id : "";

    if (!externalPaymentId) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "В уведомлении о возврате отсутствует идентификатор платежа.",
        400,
      );
    }

    return {
      kind: "refund",
      eventType,
      externalOperationId,
      externalPaymentId,
      merchantAccountId,
      notification,
      object,
    };
  }

  throw new BillingError(
    "WEBHOOK_REJECTED",
    "Событие ЮKassa не поддерживается.",
    400,
  );
}

function buildWebhookAuditPayload(parsed: ParsedWebhookNotification) {
  return {
    type: "notification",
    event: parsed.eventType,
    object: {
      id: parsed.externalOperationId,
      paymentId: parsed.externalPaymentId,
      status:
        typeof parsed.object.status === "string"
          ? parsed.object.status
          : undefined,
    },
  };
}

export class YooKassaPaymentProvider implements PaymentProvider {
  readonly id = "yookassa" as const;
  private readonly apiBaseUrl = "https://api.yookassa.ru/v3";

  constructor(private readonly options: YooKassaPaymentProviderOptions) {}

  private async request(
    path: string,
    init: RequestInit,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(
        `${this.options.shopId}:${this.options.secretKey}`,
      ).toString("base64")}`,
    );
    headers.set("Accept", "application/json");

    if (init.body) {
      headers.set("Content-Type", "application/json");
    }

    if (idempotencyKey) {
      headers.set("Idempotence-Key", idempotencyKey);
    }

    let response: Response;

    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new BillingError(
        "PROVIDER_REQUEST_FAILED",
        "ЮKassa временно недоступна. Повторите попытку позже.",
        502,
        { cause: error },
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new BillingError(
        "PROVIDER_REQUEST_FAILED",
        "ЮKassa вернула некорректный ответ.",
        502,
        { cause: error },
      );
    }

    if (!response.ok) {
      const providerError = asRecord(payload);
      const description =
        providerError && typeof providerError.description === "string"
          ? providerError.description
          : `HTTP ${response.status}`;

      throw new BillingError(
        "PROVIDER_REQUEST_FAILED",
        "ЮKassa отклонила операцию. Попробуйте ещё раз.",
        response.status >= 500 ? 502 : 422,
        { cause: new Error(description) },
      );
    }

    return payload;
  }

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderPayment> {
    const payload = await this.request(
      "/payments",
      {
        method: "POST",
        body: JSON.stringify({
          amount: formatMoney(input.plan.price),
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: input.returnUrl,
          },
          save_payment_method: input.billingMode === "recurring",
          description: `${input.plan.title} — Академия Абрикософф`,
          receipt: buildReceipt(input.plan, input.receiptContact),
          metadata: {
            internal_order_id: input.orderId,
            customer_id: input.customerId,
            plan_id: input.plan.id,
            legal_entity_id: input.legalEntityId,
          },
        }),
      },
      input.idempotencyKey,
    );

    return parseProviderPayment(payload);
  }

  async refund(
    input: RefundProviderPaymentInput,
  ): Promise<ProviderRefund> {
    const payload = await this.request(
      "/refunds",
      {
        method: "POST",
        body: JSON.stringify({
          payment_id: input.externalPaymentId,
          amount: formatMoney(input.amount),
          description: input.description,
        }),
      },
      input.idempotencyKey,
    );
    return parseProviderRefund(payload);
  }

  async getPayment(
    externalPaymentId: string,
    merchantAccountId: string,
  ): Promise<ProviderPayment> {
    if (merchantAccountId !== this.options.merchantAccountId) {
      throw new BillingError(
        "PROVIDER_NOT_CONFIGURED",
        "Не найдена конфигурация магазина ЮKassa.",
        500,
      );
    }

    const payload = await this.request(
      `/payments/${encodeURIComponent(externalPaymentId)}`,
      { method: "GET" },
    );

    return parseProviderPayment(payload);
  }

  async getRefund(
    externalRefundId: string,
    merchantAccountId: string,
  ): Promise<ProviderRefund> {
    if (merchantAccountId !== this.options.merchantAccountId) {
      throw new BillingError(
        "PROVIDER_NOT_CONFIGURED",
        "Не найдена конфигурация магазина ЮKassa.",
        500,
      );
    }

    const payload = await this.request(
      `/refunds/${encodeURIComponent(externalRefundId)}`,
      { method: "GET" },
    );

    return parseProviderRefund(payload);
  }

  parseWebhookReference(
    rawBody: string,
    _headers: Headers,
  ): ProviderWebhookReference {
    void _headers;
    const parsed = parseWebhookNotification(
      rawBody,
      this.options.merchantAccountId,
    );

    return {
      kind: parsed.kind,
      eventType: parsed.eventType,
      externalOperationId: parsed.externalOperationId,
      externalPaymentId: parsed.externalPaymentId,
      merchantAccountId: parsed.merchantAccountId,
    };
  }

  async parseAndVerifyWebhook(
    rawBody: string,
    _headers: Headers,
  ): Promise<VerifiedProviderWebhook> {
    void _headers;
    const parsed = parseWebhookNotification(
      rawBody,
      this.options.merchantAccountId,
    );
    const auditPayload = buildWebhookAuditPayload(parsed);

    if (parsed.kind === "payment") {
      // Источником истины служит ответ API ЮKassa, а не тело уведомления.
      const payment = await this.getPayment(
        parsed.externalPaymentId,
        parsed.merchantAccountId,
      );
      const eventSeed = [
        parsed.eventType,
        parsed.externalOperationId,
        payment.status,
      ].join(":");

      return {
        kind: "payment",
        externalEventId: createHash("sha256")
          .update(eventSeed)
          .digest("hex"),
        eventType: parsed.eventType,
        externalOperationId: parsed.externalOperationId,
        externalPaymentId: parsed.externalPaymentId,
        merchantAccountId: parsed.merchantAccountId,
        payment,
        occurredAt: payment.paidAt ?? new Date().toISOString(),
        auditPayload,
      };
    }

    const refund = await this.getRefund(
      parsed.externalOperationId,
      parsed.merchantAccountId,
    );

    if (refund.externalPaymentId !== parsed.externalPaymentId) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "Возврат не связан с ожидаемым платежом.",
        400,
      );
    }

    const eventSeed = [
      parsed.eventType,
      parsed.externalOperationId,
      refund.status,
    ].join(":");

    return {
      kind: "refund",
      externalEventId: createHash("sha256")
        .update(eventSeed)
        .digest("hex"),
      eventType: parsed.eventType,
      externalOperationId: parsed.externalOperationId,
      externalPaymentId: parsed.externalPaymentId,
      merchantAccountId: parsed.merchantAccountId,
      refund,
      occurredAt: refund.occurredAt ?? new Date().toISOString(),
      auditPayload,
    };
  }
}
