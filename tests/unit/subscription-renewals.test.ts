import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYooKassaRenewal,
  getYooKassaRenewal,
} from "../../scripts/lib/subscription-renewals.mjs";

const originalShopId = process.env.YOOKASSA_SHOP_ID;
const originalSecretKey = process.env.YOOKASSA_SECRET_KEY;

afterEach(() => {
  if (originalShopId === undefined) delete process.env.YOOKASSA_SHOP_ID;
  else process.env.YOOKASSA_SHOP_ID = originalShopId;

  if (originalSecretKey === undefined) delete process.env.YOOKASSA_SECRET_KEY;
  else process.env.YOOKASSA_SECRET_KEY = originalSecretKey;
});

describe("worker автоматического продления", () => {
  it("передаёт ЮKassa сохранённый способ и постоянный ключ операции", async () => {
    process.env.YOOKASSA_SHOP_ID = "test-shop";
    process.env.YOOKASSA_SECRET_KEY = "test-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "payment-renewal",
        status: "succeeded",
        amount: { value: "14000.00", currency: "RUB" },
        captured_at: "2042-01-01T10:00:00.000Z",
        payment_method: { id: "method-saved", saved: true },
      }),
    );

    const payment = await createYooKassaRenewal(
      {
        order_id: "order-renewal",
        customer_id: "customer-renewal",
        plan_id: "annual",
        legal_entity_id: "ip-fedotova",
        amount_minor: 1_400_000,
        currency: "RUB",
        idempotency_key: "renewal-payment-key",
        provider_payment_method_token: "method-saved",
        receipt_email: "student@example.test",
        receipt_phone: null,
      },
      fetchMock,
    );

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "Idempotence-Key": "renewal-payment-key",
    });
    expect(request.payment_method_id).toBe("method-saved");
    expect(payment).toMatchObject({
      status: "succeeded",
      paymentMethodToken: "method-saved",
    });
  });

  it("проверяет уже созданный платёж через GET", async () => {
    process.env.YOOKASSA_SHOP_ID = "test-shop";
    process.env.YOOKASSA_SECRET_KEY = "test-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "payment-pending",
        status: "pending",
        amount: { value: "1500.00", currency: "RUB" },
        created_at: "2042-01-01T10:00:00.000Z",
        payment_method: { id: "method-saved", saved: true },
      }),
    );

    const payment = await getYooKassaRenewal(
      {
        provider_payment_method_token: "method-saved",
      },
      "payment-pending",
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.yookassa.ru/v3/payments/payment-pending",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "Idempotence-Key",
    );
    expect(payment).toMatchObject({
      externalPaymentId: "payment-pending",
      status: "pending",
    });
  });
});
