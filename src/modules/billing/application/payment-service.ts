import { createHash, randomUUID } from "node:crypto";
import { getSubscriptionPlan } from "../domain/catalog";
import { BillingError } from "../domain/errors";
import type {
  CheckoutCommand,
  CheckoutResult,
  StoredCheckout,
} from "../domain/types";
import type { PaymentRepository } from "./payment-repository";
import { PaymentProviderRouter } from "./provider-router";

type PaymentServiceOptions = {
  repository: PaymentRepository;
  router: PaymentProviderRouter;
};

function toCheckoutResult(checkout: StoredCheckout): CheckoutResult {
  return {
    orderId: checkout.orderId,
    paymentId: checkout.paymentId,
    provider: checkout.provider,
    status: checkout.status,
    confirmationUrl: checkout.confirmationUrl,
  };
}

function assertCheckoutMatchesCommand(
  checkout: StoredCheckout,
  command: CheckoutCommand,
) {
  if (
    checkout.customerId !== command.customerId ||
    checkout.planId !== command.planId ||
    checkout.legalEntityId !== command.legalEntityId ||
    checkout.countryCode !== command.countryCode
  ) {
    throw new BillingError(
      "INVALID_REQUEST",
      "Этот идентификатор уже использован для другой операции.",
      409,
    );
  }
}

export class PaymentService {
  constructor(private readonly options: PaymentServiceOptions) {}

  async createCheckout(command: CheckoutCommand): Promise<CheckoutResult> {
    const existing =
      await this.options.repository.findCheckoutByIdempotencyKey(
        command.idempotencyKey,
      );

    if (existing) {
      assertCheckoutMatchesCommand(existing, command);
      return toCheckoutResult(existing);
    }

    const plan = getSubscriptionPlan(command.planId);
    const { provider, route } = this.options.router.resolve({
      legalEntityId: command.legalEntityId,
      countryCode: command.countryCode,
      currency: plan.price.currency,
    });
    const orderId = randomUUID();
    const paymentId = randomUUID();
    const returnUrl = new URL("/payment/success", command.publicBaseUrl);
    returnUrl.searchParams.set("orderId", orderId);
    returnUrl.searchParams.set("plan", command.planId);
    returnUrl.searchParams.set("provider", provider.id);

    const providerPayment = await provider.createCheckout({
      orderId,
      customerId: command.customerId,
      legalEntityId: command.legalEntityId,
      merchantAccountId: route.merchantAccountId,
      plan,
      receiptContact: command.receiptContact,
      savePaymentMethod: true,
      idempotencyKey: command.idempotencyKey,
      returnUrl: returnUrl.toString(),
    });

    if (
      providerPayment.money.amountMinor !== plan.price.amountMinor ||
      providerPayment.money.currency !== plan.price.currency
    ) {
      throw new BillingError(
        "PROVIDER_REQUEST_FAILED",
        "Платёжный провайдер вернул некорректную сумму.",
        502,
      );
    }

    const now = new Date().toISOString();
    const stored = await this.options.repository.saveCheckout({
      orderId,
      paymentId,
      customerId: command.customerId,
      planId: command.planId,
      legalEntityId: command.legalEntityId,
      countryCode: command.countryCode,
      merchantAccountId: route.merchantAccountId,
      money: plan.price,
      idempotencyKey: command.idempotencyKey,
      provider: provider.id,
      externalPaymentId: providerPayment.externalPaymentId,
      status: providerPayment.status,
      confirmationUrl:
        providerPayment.confirmationUrl ?? returnUrl.toString(),
      paymentMethodToken: providerPayment.paymentMethodToken,
      recurringConsentAcceptedAt: command.recurringConsent.acceptedAt,
      recurringConsentOfferVersion:
        command.recurringConsent.offerVersion,
      receiptContact: command.receiptContact,
      createdAt: now,
      updatedAt: now,
    });

    assertCheckoutMatchesCommand(stored, command);
    return toCheckoutResult(stored);
  }

  async handleWebhook(
    providerId: "demo" | "yookassa",
    rawBody: string,
    headers: Headers,
  ) {
    const provider = this.options.router.getProvider(providerId);
    const event = await provider.parseAndVerifyWebhook(rawBody, headers);
    const payloadSha256 = createHash("sha256")
      .update(rawBody)
      .digest("hex");

    return this.options.repository.applyPaymentEvent({
      provider: providerId,
      merchantAccountId: event.merchantAccountId,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      externalPaymentId: event.externalPaymentId,
      status: event.payment.status,
      paymentMethodToken: event.payment.paymentMethodToken,
      occurredAt: event.occurredAt,
      payloadSha256,
      payload: event.rawPayload,
    });
  }
}
