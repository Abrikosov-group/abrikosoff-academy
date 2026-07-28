import { BillingError } from "../domain/errors";
import type { PaymentProvider } from "../domain/payment-provider";
import type {
  CurrencyCode,
  PaymentProviderId,
  ProviderRoute,
} from "../domain/types";

type PaymentProviderRouterOptions = {
  providers: PaymentProvider[];
  routes: ProviderRoute[];
};

export class PaymentProviderRouter {
  private readonly providers: Map<PaymentProviderId, PaymentProvider>;

  constructor(private readonly options: PaymentProviderRouterOptions) {
    this.providers = new Map(
      options.providers.map((provider) => [provider.id, provider]),
    );
  }

  resolve(input: {
    legalEntityId: string;
    countryCode: string;
    currency: CurrencyCode;
  }): { route: ProviderRoute; provider: PaymentProvider } {
    const route = this.options.routes
      .filter(
        (candidate) =>
          candidate.legalEntityId === input.legalEntityId &&
          candidate.currency === input.currency &&
          (!candidate.countryCodes ||
            candidate.countryCodes.includes(input.countryCode)),
      )
      .sort((left, right) => left.priority - right.priority)[0];

    if (!route) {
      throw new BillingError(
        "NO_PAYMENT_ROUTE",
        "Для выбранной страны и валюты пока нет доступного способа оплаты.",
        422,
      );
    }

    return {
      route,
      provider: this.getProvider(route.provider),
    };
  }

  getProvider(providerId: PaymentProviderId): PaymentProvider {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new BillingError(
        "UNSUPPORTED_PROVIDER",
        "Платёжный провайдер не поддерживается.",
        404,
      );
    }

    return provider;
  }
}
