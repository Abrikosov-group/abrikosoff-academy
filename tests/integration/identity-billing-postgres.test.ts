import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { PaymentProviderRouter } from "@/modules/billing/application/provider-router";
import { PaymentService } from "@/modules/billing/application/payment-service";
import type {
  CreateProviderCheckoutInput,
  PaymentProvider,
  ProviderPayment,
  RefundProviderPaymentInput,
  VerifiedProviderWebhook,
} from "@/modules/billing/domain/payment-provider";
import { PostgresPaymentRepository } from "@/modules/billing/infrastructure/postgres-payment-repository";
import {
  getSubscriptionSummary,
} from "@/modules/billing/infrastructure/postgres-payment-repository";
import {
  hashIdentityToken,
  IdentityService,
} from "@/modules/identity/application/identity-service";
import { PostgresIdentityRepository } from "@/modules/identity/infrastructure/postgres-identity-repository";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const consent = {
  acceptedAt: "2026-07-28T08:00:00.000Z",
  documentVersion: "2026-07-27",
  source: "integration-test",
};

class PendingPaymentProvider implements PaymentProvider {
  readonly id = "demo" as const;
  checkoutCalls = 0;
  private readonly payments = new Map<string, ProviderPayment>();

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderPayment> {
    this.checkoutCalls += 1;
    const payment: ProviderPayment = {
      externalPaymentId: `integration_${input.idempotencyKey}`,
      status: "pending",
      money: input.plan.price,
      confirmationUrl: input.returnUrl,
    };
    this.payments.set(payment.externalPaymentId, payment);
    return payment;
  }

  async refund(input: RefundProviderPaymentInput) {
    return {
      externalRefundId: `refund_${input.idempotencyKey}`,
      status: "succeeded" as const,
      money: input.amount,
    };
  }

  async getPayment(externalPaymentId: string) {
    const payment = this.payments.get(externalPaymentId);

    if (!payment) {
      throw new Error("Тестовый платёж не найден");
    }

    return payment;
  }

  async parseAndVerifyWebhook(): Promise<VerifiedProviderWebhook> {
    throw new Error("Webhook разбирается отдельно в этом тесте");
  }
}

describe("Identity и Billing с PostgreSQL", () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    application_name: "academy-integration-tests",
    max: 4,
  });

  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("создаёт, находит и отзывает непрозрачную сессию", async () => {
    const repository = new PostgresIdentityRepository(pool);
    const service = new IdentityService(repository, 30);
    const session = await service.authenticateIdentity({
      methodType: "telegram",
      identifier: "integration-telegram-session",
      displayName: "Тестовая ученица",
      receiptEmail: "session@example.test",
      metadata: {
        username: "integration_student",
      },
      consent,
    });
    const tokenHash = hashIdentityToken(session.token);

    await expect(
      repository.findUserBySessionTokenSha256(tokenHash),
    ).resolves.toMatchObject({
      id: session.user.id,
      displayName: "Тестовая ученица",
      receiptEmail: "session@example.test",
    });

    await repository.revokeSession(tokenHash);

    await expect(
      repository.findUserBySessionTokenSha256(tokenHash),
    ).resolves.toBeNull();
  });

  it("разрешает использовать ссылку входа по почте только один раз", async () => {
    const repository = new PostgresIdentityRepository(pool);
    const service = new IdentityService(repository, 30);
    const challenge = await service.requestEmailLogin({
      email: "magic-link@example.test",
      displayName: "Пользователь почты",
      redirectPath: "/dashboard",
      consent,
    });

    const verified = await service.verifyEmailLogin(challenge.token);

    expect(verified.redirectPath).toBe("/dashboard");
    expect(verified.session.user).toMatchObject({
      displayName: "Пользователь почты",
      receiptEmail: "magic-link@example.test",
    });
    await expect(
      service.verifyEmailLogin(challenge.token),
    ).rejects.toMatchObject({
      code: "LOGIN_EXPIRED",
      httpStatus: 400,
    });
  });

  it("не дублирует заказ и активацию подписки", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityService = new IdentityService(identityRepository, 30);
    const session = await identityService.authenticateIdentity({
      methodType: "telegram",
      identifier: "integration-telegram-payment",
      displayName: "Плательщик",
      receiptEmail: "payer@example.test",
      metadata: {},
      consent,
    });
    const paymentRepository = new PostgresPaymentRepository(pool);
    const provider = new PendingPaymentProvider();
    const router = new PaymentProviderRouter({
      providers: [provider],
      routes: [
        {
          provider: "demo",
          merchantAccountId: "demo-primary",
          legalEntityId: "ip-fedotova",
          currency: "RUB",
          countryCodes: ["RU"],
          priority: 100,
        },
      ],
    });
    const service = new PaymentService({
      repository: paymentRepository,
      router,
    });
    const command = {
      customerId: session.user.id,
      planId: "monthly" as const,
      countryCode: "RU",
      legalEntityId: "ip-fedotova",
      receiptContact: {
        email: "payer@example.test",
      },
      offerAcceptance: {
        acceptedAt: "2026-07-28T08:10:00.000Z",
        offerVersion: "2026-07-28",
      },
      idempotencyKey: "integration-checkout-001",
      publicBaseUrl: "https://academy.example.test",
    };

    const firstCheckout = await service.createCheckout(command);
    const repeatedCheckout = await service.createCheckout(command);

    expect(repeatedCheckout).toEqual(firstCheckout);
    expect(provider.checkoutCalls).toBe(1);
    await expect(
      service.createCheckout({
        ...command,
        planId: "annual",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      httpStatus: 409,
    });
    await expect(
      getSubscriptionSummary(pool, session.user.id),
    ).resolves.toBeNull();

    const storedCheckout =
      await paymentRepository.findCheckoutByIdempotencyKey(
        command.idempotencyKey,
      );

    expect(storedCheckout).not.toBeNull();

    const paymentEvent = {
      provider: "demo" as const,
      merchantAccountId: "demo-primary",
      externalEventId: "integration-event-001",
      eventType: "payment.succeeded",
      externalPaymentId: storedCheckout!.externalPaymentId,
      status: "succeeded" as const,
      occurredAt: "2026-07-28T08:15:00.000Z",
      payloadSha256: "a".repeat(64),
      payload: {
        event: "payment.succeeded",
      },
    };
    const applied =
      await paymentRepository.applyPaymentEvent(paymentEvent);

    expect(applied.outcome).toBe("applied");
    const activeSubscription = await getSubscriptionSummary(
      pool,
      session.user.id,
    );

    expect(activeSubscription).toMatchObject({
      status: "active",
      planId: "monthly",
      autoRenew: false,
    });
    expect(activeSubscription?.currentPeriodEnd).toBeTruthy();

    const periodEnd = activeSubscription!.currentPeriodEnd;
    const duplicate =
      await paymentRepository.applyPaymentEvent(paymentEvent);
    const subscriptionAfterDuplicate = await getSubscriptionSummary(
      pool,
      session.user.id,
    );
    const counts = await pool.query<{
      mandates: string;
      saved_payment_methods: string;
      subscriptions: string;
      webhooks: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM billing_subscriptions) AS subscriptions,
          (SELECT count(*) FROM billing_webhook_events) AS webhooks,
          (SELECT count(*) FROM billing_payment_mandates) AS mandates,
          (
            SELECT count(*)
            FROM billing_payments
            WHERE payment_method_token IS NOT NULL
          ) AS saved_payment_methods
      `,
    );

    expect(duplicate.outcome).toBe("duplicate");
    expect(subscriptionAfterDuplicate?.currentPeriodEnd).toBe(periodEnd);
    expect(counts.rows[0]).toEqual({
      mandates: "0",
      saved_payment_methods: "0",
      subscriptions: "1",
      webhooks: "1",
    });
  });
});
