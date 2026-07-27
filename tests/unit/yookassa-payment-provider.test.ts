import { afterEach, describe, expect, it, vi } from "vitest";
import { YooKassaPaymentProvider } from "@/modules/billing/infrastructure/providers/yookassa-payment-provider";

function createProvider() {
  return new YooKassaPaymentProvider({
    shopId: "test-shop",
    secretKey: "test-secret",
    merchantAccountId: "yookassa-primary",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("YooKassaPaymentProvider", () => {
  it("проверяет платёжное уведомление через объект платежа", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "payment-001",
        status: "succeeded",
        amount: {
          value: "1500.00",
          currency: "RUB",
        },
        captured_at: "2026-07-28T10:05:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();
    const body = JSON.stringify({
      type: "notification",
      event: "payment.succeeded",
      object: {
        id: "payment-001",
        status: "succeeded",
      },
    });

    const event = await provider.parseAndVerifyWebhook(
      body,
      new Headers(),
    );

    expect(event).toMatchObject({
      kind: "payment",
      externalPaymentId: "payment-001",
      externalOperationId: "payment-001",
      merchantAccountId: "yookassa-primary",
      payment: {
        status: "succeeded",
      },
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.yookassa.ru/v3/payments/payment-001",
    );
  });

  it("использует payment_id возврата и проверяет объект возврата", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "refund-001",
        payment_id: "payment-001",
        status: "succeeded",
        amount: {
          value: "750.00",
          currency: "RUB",
        },
        created_at: "2026-07-28T10:10:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider();
    const body = JSON.stringify({
      type: "notification",
      event: "refund.succeeded",
      object: {
        id: "refund-001",
        payment_id: "payment-001",
        status: "succeeded",
      },
    });

    const reference = provider.parseWebhookReference(
      body,
      new Headers(),
    );

    expect(reference).toMatchObject({
      kind: "refund",
      externalOperationId: "refund-001",
      externalPaymentId: "payment-001",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const event = await provider.parseAndVerifyWebhook(
      body,
      new Headers(),
    );

    expect(event).toMatchObject({
      kind: "refund",
      externalOperationId: "refund-001",
      externalPaymentId: "payment-001",
      refund: {
        externalRefundId: "refund-001",
        externalPaymentId: "payment-001",
        status: "succeeded",
        money: {
          amountMinor: 75_000,
          currency: "RUB",
        },
      },
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.yookassa.ru/v3/refunds/refund-001",
    );
  });
});
