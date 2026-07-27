import "server-only";

import { BillingError } from "../domain/errors";
import type {
  PaymentProviderId,
  ProviderRoute,
} from "../domain/types";

export type PaymentsMode = "demo" | "live" | "disabled";

export const academyLegalEntityId = "ip-fedotova";

export type BillingConfig = {
  mode: PaymentsMode;
  defaultProvider: PaymentProviderId;
  publicBaseUrl?: string;
  demoWebhookSecret: string;
  yookassa?: {
    shopId: string;
    secretKey: string;
    merchantAccountId: string;
  };
  routes: ProviderRoute[];
};

function readPaymentsMode(): PaymentsMode {
  const configured = process.env.PAYMENTS_MODE?.trim();

  if (
    configured === "demo" ||
    configured === "live" ||
    configured === "disabled"
  ) {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "disabled" : "demo";
}

function readDefaultProvider(mode: PaymentsMode): PaymentProviderId {
  const configured = process.env.PAYMENT_DEFAULT_PROVIDER?.trim();

  if (configured === "demo" || configured === "yookassa") {
    return configured;
  }

  return mode === "live" ? "yookassa" : "demo";
}

export function getBillingConfig(): BillingConfig {
  const mode = readPaymentsMode();
  const defaultProvider = readDefaultProvider(mode);
  const publicBaseUrl = process.env.APP_BASE_URL?.trim() || undefined;
  const demoWebhookSecret =
    process.env.DEMO_WEBHOOK_SECRET?.trim() || "local-demo-only";
  const routes: ProviderRoute[] = [];
  let yookassa: BillingConfig["yookassa"];

  if (mode === "demo") {
    routes.push({
      provider: "demo",
      merchantAccountId: "demo-primary",
      legalEntityId: academyLegalEntityId,
      currency: "RUB",
      priority: 100,
    });
  }

  if (mode === "live") {
    const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
    const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
    const merchantAccountId =
      process.env.YOOKASSA_MERCHANT_ACCOUNT_ID?.trim() ||
      "yookassa-primary";

    if (defaultProvider !== "yookassa" || !shopId || !secretKey) {
      throw new BillingError(
        "PROVIDER_NOT_CONFIGURED",
        "Платежи ЮKassa ещё не настроены.",
        503,
      );
    }

    yookassa = {
      shopId,
      secretKey,
      merchantAccountId,
    };
    routes.push({
      provider: "yookassa",
      merchantAccountId,
      legalEntityId: academyLegalEntityId,
      currency: "RUB",
      priority: 100,
    });
  }

  return {
    mode,
    defaultProvider,
    publicBaseUrl,
    demoWebhookSecret,
    yookassa,
    routes,
  };
}

export function resolvePublicBaseUrl(requestUrl: string, config: BillingConfig) {
  const candidate =
    config.publicBaseUrl ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : new URL(requestUrl).origin);

  if (!candidate) {
    throw new BillingError(
      "PROVIDER_NOT_CONFIGURED",
      "Не задан публичный адрес Академии.",
      503,
    );
  }

  try {
    return new URL(candidate).origin;
  } catch (error) {
    throw new BillingError(
      "PROVIDER_NOT_CONFIGURED",
      "Публичный адрес Академии задан некорректно.",
      503,
      { cause: error },
    );
  }
}
