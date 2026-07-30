import { randomUUID } from "node:crypto";
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
  ProviderRefund,
  ProviderWebhookReference,
  RefundProviderPaymentInput,
  VerifiedProviderWebhook,
} from "@/modules/billing/domain/payment-provider";
import { PostgresPaymentRepository } from "@/modules/billing/infrastructure/postgres-payment-repository";
import {
  getCustomerOrderHistory,
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
      externalPaymentId: input.externalPaymentId,
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

  async getRefund(): Promise<ProviderRefund> {
    throw new Error("Возврат разбирается отдельно в этом тесте");
  }

  parseWebhookReference(): ProviderWebhookReference {
    throw new Error("Webhook разбирается отдельно в этом тесте");
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
      authenticationMethod: "telegram_oidc",
      methodType: "telegram",
      identifier: "integration-telegram-session",
      displayName: "Тестовая ученица",
      receiptEmail: "session@example.test",
      metadata: {
        photoUrl: "https://cdn4.telesco.pe/file/avatar-v1.jpg",
        username: "integration_student",
      },
      consent,
      clientContext: {
        ipAddress: "203.0.113.42",
        countryCode: "RU",
        region: "Москва",
        regionCode: "MOW",
        city: "Москва",
        timezone: "Europe/Moscow",
        userAgentFamily: "Google Chrome",
        browserVersion: "138.0.0.0",
        operatingSystem: "macOS",
        operatingSystemVersion: "15.5",
        deviceType: "desktop",
        deviceVendor: "Apple",
        deviceModel: "Mac",
        architecture: "arm",
        bitness: "64",
        preferredLanguage: "ru-RU",
        rawUserAgent: "Integration Chrome on macOS",
        cloudflareRayId: "9abcdef012345678-DME",
      },
    });
    const tokenHash = hashIdentityToken(session.token);
    const storedContext = await pool.query<{
      client_ip: string;
      country_code: string;
      region: string;
      region_code: string;
      city: string;
      client_timezone: string;
      user_agent_family: string;
      browser_version: string;
      operating_system: string;
      operating_system_version: string;
      device_type: string;
      device_vendor: string;
      device_model: string;
      client_architecture: string;
      client_bitness: string;
      preferred_language: string;
      raw_user_agent: string;
      cloudflare_ray_id: string;
    }>(
      `
        SELECT
          host(client_ip) AS client_ip,
          country_code,
          region,
          region_code,
          city,
          client_timezone,
          user_agent_family,
          browser_version,
          operating_system,
          operating_system_version,
          device_type,
          device_vendor,
          device_model,
          client_architecture,
          client_bitness,
          preferred_language,
          raw_user_agent,
          cloudflare_ray_id
        FROM identity_sessions
        WHERE token_sha256 = $1
      `,
      [tokenHash],
    );

    expect(storedContext.rows[0]).toEqual({
      client_ip: "203.0.113.42",
      country_code: "RU",
      region: "Москва",
      region_code: "MOW",
      city: "Москва",
      client_timezone: "Europe/Moscow",
      user_agent_family: "Google Chrome",
      browser_version: "138.0.0.0",
      operating_system: "macOS",
      operating_system_version: "15.5",
      device_type: "desktop",
      device_vendor: "Apple",
      device_model: "Mac",
      client_architecture: "arm",
      client_bitness: "64",
      preferred_language: "ru-RU",
      raw_user_agent: "Integration Chrome on macOS",
      cloudflare_ray_id: "9abcdef012345678-DME",
    });

    await expect(
      repository.findUserBySessionTokenSha256(tokenHash),
    ).resolves.toMatchObject({
      id: session.user.id,
      avatarUrl: "https://cdn4.telesco.pe/file/avatar-v1.jpg",
      displayName: "Тестовая ученица",
      receiptEmail: "session@example.test",
    });

    await pool.query(
      `
        INSERT INTO identity_methods (
          id,
          user_id,
          method_type,
          identifier,
          verified_at,
          metadata
        )
        VALUES (
          $1,
          $2,
          'email',
          'linked-session@example.test',
          now() + interval '1 minute',
          '{}'::jsonb
        )
      `,
      [randomUUID(), session.user.id],
    );

    await expect(
      repository.findUserBySessionTokenSha256(tokenHash),
    ).resolves.toMatchObject({
      avatarUrl: "https://cdn4.telesco.pe/file/avatar-v1.jpg",
      primaryMethod: {
        type: "email",
      },
    });

    await repository.revokeSession(tokenHash);

    await expect(
      repository.findUserBySessionTokenSha256(tokenHash),
    ).resolves.toBeNull();
  });

  it("обогащает Telegram metadata существующего способа входа", async () => {
    const repository = new PostgresIdentityRepository(pool);
    const service = new IdentityService(repository, 30);
    const identifier = `telegram-profile-${randomUUID()}`;

    await service.authenticateIdentity({
      authenticationMethod: "telegram_oidc",
      methodType: "telegram",
      identifier,
      displayName: "Первый Telegram-вход",
      metadata: {
        telegramUserId: "7739870613",
        username: "profile_before",
      },
      consent,
    });
    await service.authenticateIdentity({
      authenticationMethod: "telegram_oidc",
      methodType: "telegram",
      identifier,
      displayName: "German Abrikosov",
      metadata: {
        profileMetadataVersion: 1,
        telegramUserId: "7739870613",
        username: "german_abrikosov",
        profileName: "German Abrikosov",
        firstName: "German",
        lastName: "Abrikosov",
        photoUrl:
          "https://cdn4.telesco.pe/file/profile-after.jpg",
        requestedScopes: ["openid", "profile"],
        tokenIssuedAt: "2026-07-29T22:15:00.000Z",
        tokenExpiresAt: "2026-07-29T22:25:00.000Z",
      },
      consent,
    });
    const stored = await pool.query<{ metadata: unknown }>(
      `
        SELECT metadata
        FROM identity_methods
        WHERE method_type = 'telegram'
          AND identifier = $1
      `,
      [identifier],
    );

    expect(stored.rows[0]?.metadata).toEqual({
      profileMetadataVersion: 1,
      telegramUserId: "7739870613",
      username: "german_abrikosov",
      profileName: "German Abrikosov",
      firstName: "German",
      lastName: "Abrikosov",
      photoUrl:
        "https://cdn4.telesco.pe/file/profile-after.jpg",
      requestedScopes: ["openid", "profile"],
      tokenIssuedAt: "2026-07-29T22:15:00.000Z",
      tokenExpiresAt: "2026-07-29T22:25:00.000Z",
    });
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

  it("атомарно создаёт одну учётную запись при одновременном входе", async () => {
    const repository = new PostgresIdentityRepository(pool);
    const identifier = "integration-telegram-race";
    const results = await Promise.all([
      repository.upsertIdentity({
        methodType: "telegram",
        identifier,
        displayName: "Первый вход",
        receiptEmail: "race@example.test",
        metadata: { attempt: 1 },
        consent,
      }),
      repository.upsertIdentity({
        methodType: "telegram",
        identifier,
        displayName: "Повторный вход",
        receiptEmail: "race@example.test",
        metadata: { attempt: 2 },
        consent,
      }),
    ]);
    const counts = await pool.query<{
      users: string;
      methods: string;
      consents: string;
    }>(
      `
        SELECT
          (
            SELECT count(DISTINCT users.id)
            FROM identity_users users
            JOIN identity_methods methods ON methods.user_id = users.id
            WHERE methods.method_type = 'telegram'
              AND methods.identifier = $1
          ) AS users,
          (
            SELECT count(*)
            FROM identity_methods
            WHERE method_type = 'telegram' AND identifier = $1
          ) AS methods,
          (
            SELECT count(*)
            FROM identity_consents
            WHERE user_id = $2
              AND document_type = 'privacy'
              AND document_version = $3
          ) AS consents
      `,
      [identifier, results[0].id, consent.documentVersion],
    );

    expect(results[0].id).toBe(results[1].id);
    expect(counts.rows[0]).toEqual({
      users: "1",
      methods: "1",
      consents: "1",
    });
  });

  it("не дублирует заказ и активацию подписки", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityService = new IdentityService(identityRepository, 30);
    const session = await identityService.authenticateIdentity({
      authenticationMethod: "telegram_oidc",
      methodType: "telegram",
      identifier: "integration-telegram-payment",
      displayName: "Плательщик",
      receiptEmail: "payer@example.test",
      metadata: {},
      consent,
    });
    let processingTime = "2026-07-28T08:15:00.000Z";
    const paymentRepository = new PostgresPaymentRepository(
      pool,
      () => new Date(processingTime),
    );
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
    await expect(
      getCustomerOrderHistory(pool, session.user.id),
    ).resolves.toEqual([
      expect.objectContaining({
        id: storedCheckout!.orderId,
        planId: "monthly",
        status: "pending",
        amountMinor: 150_000,
        currency: "RUB",
        provider: "demo",
      }),
    ]);

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
    await expect(
      getCustomerOrderHistory(pool, session.user.id),
    ).resolves.toEqual([
      expect.objectContaining({
        id: storedCheckout!.orderId,
        status: "paid",
        paidAt: paymentEvent.occurredAt,
      }),
    ]);
    await expect(
      service.createCheckout({
        ...command,
        planId: "annual",
        idempotencyKey: "integration-checkout-active-access",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_ALREADY_ACTIVE",
      httpStatus: 409,
    });

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
      access_grants: string;
      webhooks: string;
    }>(
      `
        SELECT
          (
            SELECT count(*)
            FROM billing_subscriptions
            WHERE customer_id = $1
          ) AS subscriptions,
          (
            SELECT count(*)
            FROM billing_access_grants
            WHERE customer_id = $1
          ) AS access_grants,
          (
            SELECT count(*)
            FROM billing_webhook_events
            WHERE external_event_id = $2
          ) AS webhooks,
          (
            SELECT count(*)
            FROM billing_payment_mandates
            WHERE customer_id = $1
          ) AS mandates,
          (
            SELECT count(*)
            FROM billing_payments
            WHERE order_id = $3
              AND payment_method_token IS NOT NULL
          ) AS saved_payment_methods
      `,
      [
        session.user.id,
        paymentEvent.externalEventId,
        storedCheckout!.orderId,
      ],
    );

    expect(duplicate.outcome).toBe("duplicate");
    expect(subscriptionAfterDuplicate?.currentPeriodEnd).toBe(periodEnd);
    expect(counts.rows[0]).toEqual({
      access_grants: "1",
      mandates: "0",
      saved_payment_methods: "0",
      subscriptions: "1",
      webhooks: "1",
    });

    const refundEvent = {
      provider: "demo" as const,
      merchantAccountId: "demo-primary",
      externalEventId: "integration-refund-event-001",
      eventType: "refund.succeeded",
      externalPaymentId: storedCheckout!.externalPaymentId,
      externalRefundId: "integration-refund-001",
      status: "succeeded" as const,
      money: storedCheckout!.money,
      occurredAt: "2026-07-28T08:20:00.000Z",
      payloadSha256: "b".repeat(64),
      payload: {
        event: "refund.succeeded",
      },
    };
    processingTime = "2026-07-28T08:20:00.000Z";
    const refundResult =
      await paymentRepository.applyRefundEvent(refundEvent);
    const subscriptionAfterRefund = await getSubscriptionSummary(
      pool,
      session.user.id,
    );
    const refundState = await pool.query<{
      order_status: string;
      payment_status: string;
      refund_status: string;
    }>(
      `
        SELECT
          orders.status AS order_status,
          payments.status AS payment_status,
          refunds.status AS refund_status
        FROM billing_orders orders
        JOIN billing_payments payments ON payments.order_id = orders.id
        JOIN billing_refunds refunds ON refunds.payment_id = payments.id
        WHERE orders.id = $1 AND refunds.external_refund_id = $2
      `,
      [storedCheckout!.orderId, refundEvent.externalRefundId],
    );

    expect(refundResult).toMatchObject({
      outcome: "applied",
      checkout: {
        status: "refunded",
      },
    });
    expect(subscriptionAfterRefund?.status).toBe("canceled");
    expect(subscriptionAfterRefund?.currentPeriodEnd).toBe(
      refundEvent.occurredAt,
    );
    expect(refundState.rows[0]).toEqual({
      order_status: "refunded",
      payment_status: "refunded",
      refund_status: "succeeded",
    });
  });

  it("возврат одного из двух оплаченных заказов сохраняет другой срок доступа", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityService = new IdentityService(identityRepository, 30);
    const session = await identityService.authenticateIdentity({
      authenticationMethod: "telegram_oidc",
      methodType: "telegram",
      identifier: "integration-telegram-access-grants",
      displayName: "Два платежа",
      receiptEmail: "access-grants@example.test",
      metadata: {},
      consent,
    });
    let processingTime = "2026-07-28T10:00:00.000Z";
    const paymentRepository = new PostgresPaymentRepository(
      pool,
      () => new Date(processingTime),
    );
    const provider = new PendingPaymentProvider();
    const service = new PaymentService({
      repository: paymentRepository,
      router: new PaymentProviderRouter({
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
      }),
    });
    const baseCommand = {
      customerId: session.user.id,
      countryCode: "RU",
      legalEntityId: "ip-fedotova",
      receiptContact: {
        email: "access-grants@example.test",
      },
      offerAcceptance: {
        acceptedAt: "2026-07-28T09:55:00.000Z",
        offerVersion: "2026-07-28",
      },
      publicBaseUrl: "https://academy.example.test",
    };

    await service.createCheckout({
      ...baseCommand,
      planId: "monthly",
      idempotencyKey: "integration-access-grant-monthly",
    });
    await service.createCheckout({
      ...baseCommand,
      planId: "annual",
      idempotencyKey: "integration-access-grant-annual",
    });
    const monthlyCheckout =
      await paymentRepository.findCheckoutByIdempotencyKey(
        "integration-access-grant-monthly",
      );
    const annualCheckout =
      await paymentRepository.findCheckoutByIdempotencyKey(
        "integration-access-grant-annual",
      );

    expect(monthlyCheckout).not.toBeNull();
    expect(annualCheckout).not.toBeNull();

    await paymentRepository.applyPaymentEvent({
      provider: "demo",
      merchantAccountId: "demo-primary",
      externalEventId: "integration-access-grant-monthly-paid",
      eventType: "payment.succeeded",
      externalPaymentId: monthlyCheckout!.externalPaymentId,
      status: "succeeded",
      occurredAt: "2026-07-27T10:00:00.000Z",
      payloadSha256: "d".repeat(64),
      payload: { event: "payment.succeeded" },
    });
    processingTime = "2026-07-28T10:01:00.000Z";
    await paymentRepository.applyPaymentEvent({
      provider: "demo",
      merchantAccountId: "demo-primary",
      externalEventId: "integration-access-grant-annual-paid",
      eventType: "payment.succeeded",
      externalPaymentId: annualCheckout!.externalPaymentId,
      status: "succeeded",
      occurredAt: "2026-07-27T10:01:00.000Z",
      payloadSha256: "e".repeat(64),
      payload: { event: "payment.succeeded" },
    });

    await expect(
      getSubscriptionSummary(pool, session.user.id),
    ).resolves.toMatchObject({
      status: "active",
      planId: "annual",
      currentPeriodEnd: "2027-07-28T10:01:00.000Z",
    });

    processingTime = "2026-07-28T10:05:00.000Z";
    await paymentRepository.applyRefundEvent({
      provider: "demo",
      merchantAccountId: "demo-primary",
      externalEventId: "integration-access-grant-annual-refunded",
      eventType: "refund.succeeded",
      externalPaymentId: annualCheckout!.externalPaymentId,
      externalRefundId: "integration-access-grant-refund-annual",
      status: "succeeded",
      money: annualCheckout!.money,
      occurredAt: "2026-07-27T10:05:00.000Z",
      payloadSha256: "f".repeat(64),
      payload: { event: "refund.succeeded" },
    });

    await expect(
      getSubscriptionSummary(pool, session.user.id),
    ).resolves.toMatchObject({
      status: "active",
      planId: "monthly",
      currentPeriodEnd: "2026-08-28T10:00:00.000Z",
    });
    const grants = await pool.query<{
      order_id: string;
      status: string;
    }>(
      `
        SELECT order_id, status
        FROM billing_access_grants
        WHERE customer_id = $1
        ORDER BY order_id
      `,
      [session.user.id],
    );

    expect(grants.rows).toEqual(
      expect.arrayContaining([
        {
          order_id: monthlyCheckout!.orderId,
          status: "granted",
        },
        {
          order_id: annualCheckout!.orderId,
          status: "revoked",
        },
      ]),
    );
  });

  it("повторно применяет webhook, который пришёл раньше платежа", async () => {
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityService = new IdentityService(identityRepository, 30);
    const session = await identityService.authenticateIdentity({
      authenticationMethod: "telegram_oidc",
      methodType: "telegram",
      identifier: "integration-telegram-late-webhook",
      displayName: "Раннее уведомление",
      receiptEmail: "late-webhook@example.test",
      metadata: {},
      consent,
    });
    const accessGrantedAt = "2026-07-30T09:30:00.000Z";
    const paymentRepository = new PostgresPaymentRepository(
      pool,
      () => new Date(accessGrantedAt),
    );
    const provider = new PendingPaymentProvider();
    const service = new PaymentService({
      repository: paymentRepository,
      router: new PaymentProviderRouter({
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
      }),
    });
    const idempotencyKey = "integration-late-webhook-001";
    const externalPaymentId = `integration_${idempotencyKey}`;
    const event = {
      provider: "demo" as const,
      merchantAccountId: "demo-primary",
      externalEventId: "integration-late-event-001",
      eventType: "payment.succeeded",
      externalPaymentId,
      status: "succeeded" as const,
      occurredAt: "2026-07-28T09:00:00.000Z",
      payloadSha256: "c".repeat(64),
      payload: {
        event: "payment.succeeded",
      },
    };

    await expect(
      paymentRepository.applyPaymentEvent(event),
    ).resolves.toEqual({
      outcome: "unmatched",
      checkout: null,
    });
    await service.createCheckout({
      customerId: session.user.id,
      planId: "monthly",
      countryCode: "RU",
      legalEntityId: "ip-fedotova",
      receiptContact: {
        email: "late-webhook@example.test",
      },
      offerAcceptance: {
        acceptedAt: "2026-07-28T08:55:00.000Z",
        offerVersion: "2026-07-28",
      },
      idempotencyKey,
      publicBaseUrl: "https://academy.example.test",
    });
    const retried = await paymentRepository.applyPaymentEvent(event);
    const subscription = await getSubscriptionSummary(
      pool,
      session.user.id,
    );
    const accessGrant = await pool.query<{
      period_start: Date;
      period_end: Date;
    }>(
      `
        SELECT period_start, period_end
        FROM billing_access_grants
        WHERE order_id = $1
      `,
      [retried.checkout?.orderId],
    );

    expect(retried).toMatchObject({
      outcome: "applied",
      checkout: {
        status: "succeeded",
      },
    });
    expect(subscription).toMatchObject({
      status: "active",
      planId: "monthly",
      autoRenew: false,
    });
    expect(accessGrant.rows[0]?.period_start.toISOString()).toBe(
      accessGrantedAt,
    );
    expect(accessGrant.rows[0]?.period_end.toISOString()).toBe(
      "2026-08-30T09:30:00.000Z",
    );
  });
});
