import { describe, expect, it } from "vitest";
import { PaymentProviderRouter } from "@/modules/billing/application/provider-router";
import { BillingError } from "@/modules/billing/domain/errors";
import type { PaymentProvider } from "@/modules/billing/domain/payment-provider";
import type { PaymentProviderId } from "@/modules/billing/domain/types";

function createUnusedProvider(id: PaymentProviderId): PaymentProvider {
  const unused = async () => {
    throw new Error("Метод не должен вызываться в тесте маршрутизации");
  };

  return {
    id,
    createCheckout: unused,
    chargeSavedMethod: unused,
    refund: unused,
    getPayment: unused,
    parseAndVerifyWebhook: unused,
  };
}

describe("PaymentProviderRouter", () => {
  it("выбирает подходящий маршрут с наименьшим приоритетом", () => {
    const router = new PaymentProviderRouter({
      providers: [
        createUnusedProvider("demo"),
        createUnusedProvider("yookassa"),
      ],
      routes: [
        {
          provider: "demo",
          merchantAccountId: "demo-primary",
          legalEntityId: "ip-fedotova",
          currency: "RUB",
          countryCodes: ["RU"],
          priority: 200,
        },
        {
          provider: "yookassa",
          merchantAccountId: "yookassa-primary",
          legalEntityId: "ip-fedotova",
          currency: "RUB",
          countryCodes: ["RU"],
          priority: 100,
        },
      ],
    });

    const result = router.resolve({
      legalEntityId: "ip-fedotova",
      countryCode: "RU",
      currency: "RUB",
    });

    expect(result.provider.id).toBe("yookassa");
    expect(result.route.merchantAccountId).toBe("yookassa-primary");
  });

  it("отклоняет страну без платёжного маршрута", () => {
    const router = new PaymentProviderRouter({
      providers: [createUnusedProvider("yookassa")],
      routes: [
        {
          provider: "yookassa",
          merchantAccountId: "yookassa-primary",
          legalEntityId: "ip-fedotova",
          currency: "RUB",
          countryCodes: ["RU"],
          priority: 100,
        },
      ],
    });

    expect(() =>
      router.resolve({
        legalEntityId: "ip-fedotova",
        countryCode: "DE",
        currency: "RUB",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BillingError>>({
        code: "NO_PAYMENT_ROUTE",
        httpStatus: 422,
      }),
    );
  });

  it("не возвращает провайдера, которого нет в runtime", () => {
    const router = new PaymentProviderRouter({
      providers: [],
      routes: [
        {
          provider: "yookassa",
          merchantAccountId: "yookassa-primary",
          legalEntityId: "ip-fedotova",
          currency: "RUB",
          priority: 100,
        },
      ],
    });

    expect(() =>
      router.resolve({
        legalEntityId: "ip-fedotova",
        countryCode: "RU",
        currency: "RUB",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<BillingError>>({
        code: "UNSUPPORTED_PROVIDER",
        httpStatus: 404,
      }),
    );
  });
});
