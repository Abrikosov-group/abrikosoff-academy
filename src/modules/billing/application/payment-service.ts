import { createHash, randomUUID } from "node:crypto";
import { getSubscriptionPlan } from "../domain/catalog";
import { BillingError } from "../domain/errors";
import type {
  CheckoutCommand,
  CheckoutReservation,
  CheckoutResult,
  PaymentProviderId,
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
  checkout: CheckoutReservation,
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

function assertProviderMoneyMatchesCheckout(
  checkout: CheckoutReservation,
  amountMinor: number,
  currency: string,
) {
  if (
    amountMinor !== checkout.money.amountMinor ||
    currency !== checkout.money.currency
  ) {
    throw new BillingError(
      "PROVIDER_REQUEST_FAILED",
      "Платёжный провайдер вернул некорректную сумму.",
      502,
    );
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
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
    const reservedAt = new Date().toISOString();
    let reservation =
      await this.options.repository.findCheckoutReservationByIdempotencyKey(
        command.idempotencyKey,
      );

    if (!reservation) {
      const { provider: routedProvider, route } =
        this.options.router.resolve({
          legalEntityId: command.legalEntityId,
          countryCode: command.countryCode,
          currency: plan.price.currency,
        });

      const billingMode = route.billingMode ?? "one_time";

      if (billingMode === "recurring" && !command.recurringConsent) {
        throw new BillingError(
          "INVALID_REQUEST",
          "Подтвердите автоматическое продление подписки.",
          400,
        );
      }

      reservation = await this.options.repository.reserveCheckout({
        orderId: randomUUID(),
        customerId: command.customerId,
        planId: command.planId,
        legalEntityId: command.legalEntityId,
        countryCode: command.countryCode,
        merchantAccountId: route.merchantAccountId,
        money: plan.price,
        idempotencyKey: command.idempotencyKey,
        provider: routedProvider.id,
        billingMode,
        renewalSequence: 0,
        offerAcceptedAt: command.offerAcceptance.acceptedAt,
        offerVersion: command.offerAcceptance.offerVersion,
        recurringConsentAcceptedAt:
          billingMode === "recurring"
            ? command.recurringConsent?.acceptedAt
            : undefined,
        recurringConsentOfferVersion:
          billingMode === "recurring"
            ? command.recurringConsent?.offerVersion
            : undefined,
        receiptContact: command.receiptContact,
        createdAt: reservedAt,
        updatedAt: reservedAt,
      });
    }

    assertCheckoutMatchesCommand(reservation, command);

    const provider = this.options.router.getProvider(
      reservation.provider,
    );
    const reservedPlan = {
      ...plan,
      price: reservation.money,
    };
    const returnUrl = new URL("/payment/success", command.publicBaseUrl);
    returnUrl.searchParams.set("orderId", reservation.orderId);
    returnUrl.searchParams.set("plan", command.planId);
    returnUrl.searchParams.set("provider", provider.id);

    const providerPayment = await provider.createCheckout({
      orderId: reservation.orderId,
      customerId: command.customerId,
      legalEntityId: command.legalEntityId,
      merchantAccountId: reservation.merchantAccountId,
      plan: reservedPlan,
      receiptContact: reservation.receiptContact,
      idempotencyKey: command.idempotencyKey,
      returnUrl: returnUrl.toString(),
      billingMode: reservation.billingMode,
    });

    assertProviderMoneyMatchesCheckout(
      reservation,
      providerPayment.money.amountMinor,
      providerPayment.money.currency,
    );

    const stored = await this.options.repository.saveCheckout({
      ...reservation,
      paymentId: randomUUID(),
      externalPaymentId: providerPayment.externalPaymentId,
      status: providerPayment.status,
      confirmationUrl:
        providerPayment.confirmationUrl ?? returnUrl.toString(),
      updatedAt: new Date().toISOString(),
      paymentMethodToken: providerPayment.paymentMethodToken,
      paymentMethodSaved: providerPayment.paymentMethodSaved === true,
    });

    assertCheckoutMatchesCommand(stored, command);
    return toCheckoutResult(stored);
  }

  async handleWebhook(
    providerId: PaymentProviderId,
    rawBody: string,
    headers: Headers,
  ) {
    const provider = this.options.router.getProvider(providerId);
    const reference = provider.parseWebhookReference(rawBody, headers);
    const knownCheckout =
      await this.options.repository.findCheckoutByExternalPaymentId(
        providerId,
        reference.merchantAccountId,
        reference.externalPaymentId,
      );

    const event = await provider.parseAndVerifyWebhook(rawBody, headers);
    const payloadSha256 = sha256(rawBody);

    if (
      event.kind !== reference.kind ||
      event.externalOperationId !== reference.externalOperationId ||
      event.externalPaymentId !== reference.externalPaymentId ||
      event.merchantAccountId !== reference.merchantAccountId
    ) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "Платёжное уведомление не прошло проверку.",
        400,
      );
    }

    if (event.kind === "payment") {
      if (
        !knownCheckout &&
        event.payment.internalOrderId &&
        event.payment.internalRenewalAttemptId
      ) {
        const recovered =
          await this.options.repository.applyRecoveredRenewalPaymentEvent({
            provider: providerId,
            merchantAccountId: event.merchantAccountId,
            externalEventId: event.externalEventId,
            eventType: event.eventType,
            externalPaymentId: event.externalPaymentId,
            status: event.payment.status,
            paymentMethodToken: event.payment.paymentMethodToken,
            paymentMethodSaved: event.payment.paymentMethodSaved === true,
            occurredAt: event.occurredAt,
            payloadSha256,
            payload: event.auditPayload,
            internalOrderId: event.payment.internalOrderId,
            internalRenewalAttemptId:
              event.payment.internalRenewalAttemptId,
            money: event.payment.money,
          });

        if (recovered.outcome === "unmatched") {
          throw new BillingError(
            "WEBHOOK_NOT_READY",
            "Платёж пока не найден. Уведомление будет обработано повторно.",
            503,
          );
        }

        return recovered;
      }

      if (!knownCheckout) {
        throw new BillingError(
          "WEBHOOK_NOT_READY",
          "Платёж пока не найден. Уведомление будет обработано повторно.",
          503,
        );
      }

      assertProviderMoneyMatchesCheckout(
        knownCheckout,
        event.payment.money.amountMinor,
        event.payment.money.currency,
      );

      return this.options.repository.applyPaymentEvent({
        provider: providerId,
        merchantAccountId: event.merchantAccountId,
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        externalPaymentId: event.externalPaymentId,
        status: event.payment.status,
        paymentMethodToken: event.payment.paymentMethodToken,
        paymentMethodSaved: event.payment.paymentMethodSaved === true,
        occurredAt: event.occurredAt,
        payloadSha256,
        payload: event.auditPayload,
      });
    }

    if (!knownCheckout) {
      throw new BillingError(
        "WEBHOOK_NOT_READY",
        "Платёж пока не найден. Уведомление будет обработано повторно.",
        503,
      );
    }

    if (
      event.refund.money.currency !== knownCheckout.money.currency ||
      event.refund.money.amountMinor > knownCheckout.money.amountMinor
    ) {
      throw new BillingError(
        "WEBHOOK_REJECTED",
        "Возврат содержит некорректную сумму.",
        400,
      );
    }

    return this.options.repository.applyRefundEvent({
      provider: providerId,
      merchantAccountId: event.merchantAccountId,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      externalPaymentId: event.externalPaymentId,
      externalRefundId: event.refund.externalRefundId,
      status: event.refund.status,
      money: event.refund.money,
      occurredAt: event.occurredAt,
      payloadSha256,
      payload: event.auditPayload,
    });
  }

  async reconcileCheckout(orderId: string, customerId: string) {
    const checkout =
      await this.options.repository.findCheckoutByOrderIdForCustomer(
        orderId,
        customerId,
      );

    if (!checkout) {
      throw new BillingError(
        "PAYMENT_NOT_FOUND",
        "Платёж не найден.",
        404,
      );
    }

    if (
      checkout.status === "succeeded" ||
      checkout.status === "canceled" ||
      checkout.status === "failed" ||
      checkout.status === "partially_refunded" ||
      checkout.status === "refunded"
    ) {
      return toCheckoutResult(checkout);
    }

    const provider = this.options.router.getProvider(checkout.provider);
    const payment = await provider.getPayment(
      checkout.externalPaymentId,
      checkout.merchantAccountId,
    );
    assertProviderMoneyMatchesCheckout(
      checkout,
      payment.money.amountMinor,
      payment.money.currency,
    );
    const occurredAt = payment.paidAt ?? new Date().toISOString();
    const auditPayload = {
      source: "return-page-reconciliation",
      externalPaymentId: checkout.externalPaymentId,
      status: payment.status,
    };
    const serializedPayload = JSON.stringify(auditPayload);

    await this.options.repository.applyPaymentEvent({
      provider: checkout.provider,
      merchantAccountId: checkout.merchantAccountId,
      externalEventId: sha256(
        [
          "reconcile",
          checkout.provider,
          checkout.externalPaymentId,
          payment.status,
        ].join(":"),
      ),
      eventType: "payment.reconciled",
      externalPaymentId: checkout.externalPaymentId,
      status: payment.status,
      paymentMethodToken: payment.paymentMethodToken,
      paymentMethodSaved: payment.paymentMethodSaved === true,
      occurredAt,
      payloadSha256: sha256(serializedPayload),
      payload: auditPayload,
    });

    const reconciled =
      await this.options.repository.findCheckoutByOrderIdForCustomer(
        orderId,
        customerId,
      );

    if (!reconciled) {
      throw new BillingError(
        "PAYMENT_NOT_FOUND",
        "Платёж не найден.",
        404,
      );
    }

    return toCheckoutResult(reconciled);
  }
}
