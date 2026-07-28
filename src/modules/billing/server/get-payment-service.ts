import "server-only";

import { PaymentProviderRouter } from "../application/provider-router";
import { PaymentService } from "../application/payment-service";
import { BillingError } from "../domain/errors";
import type { PaymentProvider } from "../domain/payment-provider";
import { getInMemoryPaymentRepository } from "../infrastructure/in-memory-payment-repository";
import { PostgresPaymentRepository } from "../infrastructure/postgres-payment-repository";
import { DemoPaymentProvider } from "../infrastructure/providers/demo-payment-provider";
import { YooKassaPaymentProvider } from "../infrastructure/providers/yookassa-payment-provider";
import { getBillingConfig } from "./billing-config";
import {
  getDatabasePool,
  hasDatabaseConfiguration,
} from "@/lib/database";

export function getPaymentRuntime() {
  const config = getBillingConfig();

  if (config.mode === "disabled") {
    throw new BillingError(
      "PAYMENTS_DISABLED",
      "Приём платежей временно отключён.",
      503,
    );
  }

  const providers: PaymentProvider[] = [];

  if (config.mode === "demo") {
    providers.push(
      new DemoPaymentProvider(config.demoWebhookSecret),
    );
  }

  if (config.yookassa) {
    providers.push(new YooKassaPaymentProvider(config.yookassa));
  }

  const router = new PaymentProviderRouter({
    providers,
    routes: config.routes,
  });

  return {
    config,
    service: new PaymentService({
      repository: hasDatabaseConfiguration()
        ? new PostgresPaymentRepository(getDatabasePool())
        : getInMemoryPaymentRepository(),
      router,
    }),
  };
}
