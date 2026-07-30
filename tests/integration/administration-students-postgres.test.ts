import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { AdministrationStudentReadService } from "@/modules/administration/application/administration-student-read-service";
import { configuredPermissionsForRole } from "@/modules/administration/domain/permissions";
import { PostgresAdministrationStudentReadRepository } from "@/modules/administration/infrastructure/postgres-administration-student-read-repository";
import type {
  AdminStudentListFilters,
  AdminStudentStatus,
} from "@/modules/administration/domain/student-read-model";
import type { AdminPermission } from "@/modules/administration/domain/types";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const at = new Date("2026-07-29T12:00:00.000Z");
const defaultFilters: AdminStudentListFilters = {
  query: "",
  limit: 50,
};
const ownerPermissions = configuredPermissionsForRole("owner");

type StudentSeed = {
  id?: string;
  displayName: string;
  receiptEmail?: string;
  status?: AdminStudentStatus;
  createdAt?: string;
  telegramSub?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramProfileName?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  telegramPhotoUrl?: string;
  telegramRequestedScopes?: readonly string[];
  telegramTokenIssuedAt?: string;
  telegramTokenExpiresAt?: string;
  telegramProfileMetadataVersion?: number | null;
};

async function insertStudent(pool: Pool, seed: StudentSeed) {
  const userId = seed.id ?? randomUUID();
  const telegramMethodId = randomUUID();

  await pool.query(
    `
      INSERT INTO identity_users (
        id,
        display_name,
        receipt_email,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $5)
    `,
    [
      userId,
      seed.displayName,
      seed.receiptEmail ?? null,
      seed.status ?? "active",
      seed.createdAt ?? "2026-07-29T10:00:00.000Z",
    ],
  );
  await pool.query(
    `
      INSERT INTO identity_methods (
        id,
        user_id,
        method_type,
        identifier,
        verified_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'telegram',
        $3,
        '2026-07-29T10:00:00.000Z',
        $4::jsonb,
        '2026-07-29T10:00:00.000Z',
        '2026-07-29T10:00:00.000Z'
      )
    `,
    [
      telegramMethodId,
      userId,
      seed.telegramSub ?? `student-${userId}`,
      JSON.stringify({
        profileMetadataVersion:
          seed.telegramProfileMetadataVersion === undefined
            ? 1
            : seed.telegramProfileMetadataVersion,
        telegramUserId: seed.telegramUserId,
        username: seed.telegramUsername,
        profileName: seed.telegramProfileName,
        firstName: seed.telegramFirstName,
        lastName: seed.telegramLastName,
        photoUrl: seed.telegramPhotoUrl,
        requestedScopes: seed.telegramRequestedScopes,
        tokenIssuedAt: seed.telegramTokenIssuedAt,
        tokenExpiresAt: seed.telegramTokenExpiresAt,
      }),
    ],
  );

  return { userId, telegramMethodId };
}

async function insertPaidGrant(
  pool: Pool,
  input: {
    userId: string;
    planId?: "monthly" | "annual";
    grantStatus?: "granted" | "revoked";
    periodStart: string;
    periodEnd: string;
  },
) {
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const grantStatus = input.grantStatus ?? "granted";
  const revokedAt =
    grantStatus === "revoked"
      ? "2026-07-29T11:00:00.000Z"
      : null;

  await pool.query(
    `
      INSERT INTO billing_orders (
        id,
        customer_id,
        plan_id,
        legal_entity_id,
        country_code,
        amount_minor,
        currency,
        status,
        idempotency_key,
        selected_provider,
        merchant_account_id,
        offer_accepted_at,
        offer_version,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'ip-fedotova',
        'RU',
        150000,
        'RUB',
        'paid',
        $4,
        'demo',
        'administration-test',
        '2026-07-29T09:00:00.000Z',
        'integration-test',
        '2026-07-29T09:00:00.000Z',
        '2026-07-29T09:00:00.000Z'
      )
    `,
    [
      orderId,
      input.userId,
      input.planId ?? "monthly",
      randomUUID(),
    ],
  );
  await pool.query(
    `
      INSERT INTO billing_payments (
        id,
        order_id,
        provider,
        merchant_account_id,
        external_payment_id,
        provider_operation_key,
        status,
        amount_minor,
        currency,
        paid_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'demo',
        'administration-test',
        $3,
        $4,
        'succeeded',
        150000,
        'RUB',
        '2026-07-29T09:01:00.000Z',
        '2026-07-29T09:00:00.000Z',
        '2026-07-29T09:01:00.000Z'
      )
    `,
    [paymentId, orderId, randomUUID(), randomUUID()],
  );
  await pool.query(
    `
      INSERT INTO billing_access_grants (
        order_id,
        customer_id,
        plan_id,
        status,
        period_start,
        period_end,
        granted_at,
        revoked_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        '2026-07-29T09:01:00.000Z',
        $7,
        '2026-07-29T09:01:00.000Z',
        '2026-07-29T09:01:00.000Z'
      )
    `,
    [
      orderId,
      input.userId,
      input.planId ?? "monthly",
      grantStatus,
      input.periodStart,
      input.periodEnd,
      revokedAt,
    ],
  );

  return { orderId, paymentId };
}

describe("read-only Administration учеников с PostgreSQL", () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    application_name: "academy-admin-students-integration-tests",
    max: 4,
  });
  const service = new AdministrationStudentReadService(
    new PostgresAdministrationStudentReadRepository(pool),
  );

  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("находит одного ученика по всем заявленным идентификаторам", async () => {
    const telegramSub = `admin-read-sub-${randomUUID()}`;
    const telegramUserId = "7739870613";
    const { userId } = await insertStudent(pool, {
      displayName: "Мария Поисковая",
      receiptEmail: "receipt-search@example.test",
      telegramSub,
      telegramUserId,
      telegramUsername: "student_search_username",
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
        VALUES
          (
            $1,
            $3,
            'email',
            'confirmed-search@example.test',
            '2026-07-29T10:05:00.000Z',
            '{}'::jsonb
          ),
          (
            $2,
            $3,
            'phone',
            '+79581110775',
            '2026-07-29T10:06:00.000Z',
            '{}'::jsonb
          )
      `,
      [randomUUID(), randomUUID(), userId],
    );

    for (const query of [
      userId,
      telegramSub,
      telegramUserId,
      "student_search_username",
      "@student_search_username",
      "receipt-search@example.test",
      "confirmed-search@example.test",
      "+79581110775",
      "Мария",
      "Поисковая",
    ]) {
      const result = await service.listStudents({
        filters: {
          ...defaultFilters,
          query,
        },
        displayTimeZone: "Europe/Moscow",
        permissions: ownerPermissions,
        at,
      });

      expect(
        result.items.map((student) => student.id),
        `поиск по ${query}`,
      ).toContain(userId);
    }

    const supportPermissions = new Set<AdminPermission>([
      "users.read",
      "access.read",
    ]);
    const hiddenReceiptEmail = await service.listStudents({
      filters: {
        ...defaultFilters,
        query: "receipt-search@example.test",
      },
      displayTimeZone: "Europe/Moscow",
      permissions: supportPermissions,
      at,
    });
    const confirmedLoginEmail = await service.listStudents({
      filters: {
        ...defaultFilters,
        query: "confirmed-search@example.test",
      },
      displayTimeZone: "Europe/Moscow",
      permissions: supportPermissions,
      at,
    });

    expect(
      hiddenReceiptEmail.items.map((student) => student.id),
    ).not.toContain(userId);
    expect(
      confirmedLoginEmail.items.map((student) => student.id),
    ).toContain(userId);
  });

  it("различает состояния оплаченного доступа и фильтрует тариф", async () => {
    const cases = [
      {
        state: "active",
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-08-01T00:00:00.000Z",
        grantStatus: "granted",
      },
      {
        state: "scheduled",
        start: "2026-08-01T00:00:00.000Z",
        end: "2026-09-01T00:00:00.000Z",
        grantStatus: "granted",
      },
      {
        state: "expired",
        start: "2026-06-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
        grantStatus: "granted",
      },
      {
        state: "revoked",
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-08-01T00:00:00.000Z",
        grantStatus: "revoked",
      },
    ] as const;

    for (const testCase of cases) {
      const { userId } = await insertStudent(pool, {
        displayName: `Состояние доступа ${testCase.state}`,
        telegramUsername: `access_${testCase.state}`,
      });
      await insertPaidGrant(pool, {
        userId,
        planId:
          testCase.state === "active" ? "annual" : "monthly",
        grantStatus: testCase.grantStatus,
        periodStart: testCase.start,
        periodEnd: testCase.end,
      });
      if (testCase.state === "active") {
        await insertPaidGrant(pool, {
          userId,
          planId: "annual",
          periodStart: "2026-07-31T00:00:00.000Z",
          periodEnd: "2026-09-01T00:00:00.000Z",
        });
      }

      const result = await service.listStudents({
        filters: {
          ...defaultFilters,
          query: `Состояние доступа ${testCase.state}`,
          access: testCase.state,
          source: "paid",
          plan:
            testCase.state === "active" ? "annual" : "monthly",
        },
        displayTimeZone: "Europe/Moscow",
        permissions: ownerPermissions,
        at,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: userId,
        accessState: testCase.state,
        hasPayments: true,
      });
      if (testCase.state === "active") {
        expect(result.items[0]?.accessUntil).toBe(
          "2026-09-01T00:00:00.000Z",
        );
      }
    }

    const { userId: withoutAccessId } = await insertStudent(pool, {
      displayName: "Состояние доступа none",
      telegramUsername: "access_none",
    });
    const withoutAccess = await service.listStudents({
      filters: {
        ...defaultFilters,
        query: "Состояние доступа none",
        access: "none",
      },
      displayTimeZone: "Europe/Moscow",
      permissions: ownerPermissions,
      at,
    });

    expect(withoutAccess.items).toEqual([
      expect.objectContaining({
        id: withoutAccessId,
        accessState: "none",
        hasPayments: false,
      }),
    ]);
  });

  it("возвращает следующие строки по непрозрачному курсору без дублей", async () => {
    const insertedIds: string[] = [];

    for (let index = 0; index < 26; index += 1) {
      const createdAt = new Date(
        Date.UTC(2026, 6, 20, 0, index),
      ).toISOString();
      const { userId } = await insertStudent(pool, {
        displayName: `Курсорная выборка ${String(index).padStart(
          2,
          "0",
        )}`,
        createdAt,
      });
      insertedIds.push(userId);
    }

    const first = await service.listStudents({
      filters: {
        query: "Курсорная выборка",
        limit: 25,
      },
      displayTimeZone: "Europe/Moscow",
      permissions: ownerPermissions,
      at,
    });

    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).toBeDefined();

    const cursorPayload = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString("utf8"),
    ) as [string, string];
    const second = await service.listStudents({
      filters: {
        query: "Курсорная выборка",
        limit: 25,
      },
      cursor: {
        createdAt: cursorPayload[0],
        id: cursorPayload[1],
      },
      displayTimeZone: "Europe/Moscow",
      permissions: ownerPermissions,
      at,
    });
    const returnedIds = [
      ...first.items.map((student) => student.id),
      ...second.items.map((student) => student.id),
    ];

    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set(returnedIds).size).toBe(26);
    expect(new Set(returnedIds)).toEqual(new Set(insertedIds));
  });

  it("возвращает карточку без токена с маскированными методами и доступом", async () => {
    const { userId, telegramMethodId } = await insertStudent(pool, {
      displayName: "Карточка Ученика",
      receiptEmail: "receipt-detail@example.test",
      telegramSub: "8965978102",
      telegramUserId: "7739870613",
      telegramUsername: "detail_student",
      telegramProfileName: "Карточка Ученика",
      telegramFirstName: "Карточка",
      telegramLastName: "Ученика",
      telegramPhotoUrl:
        "https://cdn4.telesco.pe/file/detail-avatar.jpg",
      telegramRequestedScopes: ["openid", "profile"],
      telegramTokenIssuedAt: "2026-07-29T09:59:00.000Z",
      telegramTokenExpiresAt: "2026-07-29T10:09:00.000Z",
    });
    const rawToken = `secret-session-${randomUUID()}`;
    const tokenSha256 = createHash("sha256")
      .update(rawToken)
      .digest("hex");

    await pool.query(
      `
        INSERT INTO identity_sessions (
          id,
          user_id,
          token_sha256,
          expires_at,
          authenticated_at,
          authentication_method,
          authentication_method_id,
          created_at,
          last_seen_at,
          user_agent_family,
          client_ip,
          country_code,
          region,
          region_code,
          city,
          client_timezone,
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
        )
        VALUES (
          $1,
          $2,
          $3,
          '2026-08-29T12:00:00.000Z',
          '2026-07-29T11:00:00.000Z',
          'telegram_oidc',
          $4,
          '2026-07-29T11:00:00.000Z',
          '2026-07-29T11:15:00.000Z',
          'Google Chrome',
          '203.0.113.42',
          'RU',
          'Москва',
          'MOW',
          'Москва',
          'Europe/Moscow',
          '138.0.0.0',
          'macOS',
          '15.5',
          'desktop',
          'Apple',
          'Mac',
          'arm',
          '64',
          'ru-RU',
          'Integration Chrome on macOS',
          '9abcdef012345678-DME'
        )
      `,
      [randomUUID(), userId, tokenSha256, telegramMethodId],
    );
    await pool.query(
      `
        INSERT INTO identity_sessions (
          id,
          user_id,
          token_sha256,
          expires_at,
          created_at,
          user_agent_family
        )
        SELECT
          (
            '10000000-0000-4000-8000-'
            || lpad(to_hex(sequence_number), 12, '0')
          )::uuid,
          $1,
          repeat('a', 56)
            || lpad(to_hex(sequence_number), 8, '0'),
          '2026-08-20T12:00:00.000Z',
          '2026-07-20T00:00:00.000Z'::timestamptz
            + sequence_number * interval '1 second',
          'Safari'
        FROM generate_series(1, 101)
          AS sequence_rows(sequence_number)
      `,
      [userId],
    );
    const { orderId } = await insertPaidGrant(pool, {
      userId,
      planId: "annual",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2027-07-01T00:00:00.000Z",
    });
    await pool.query(
      `
        INSERT INTO billing_orders (
          id,
          customer_id,
          plan_id,
          legal_entity_id,
          country_code,
          amount_minor,
          currency,
          status,
          idempotency_key,
          selected_provider,
          merchant_account_id,
          offer_accepted_at,
          offer_version,
          created_at,
          updated_at
        )
        SELECT
          (
            '20000000-0000-4000-8000-'
            || lpad(to_hex(sequence_number), 12, '0')
          )::uuid,
          $1::uuid,
          'monthly',
          'ip-fedotova',
          'RU',
          150000,
          'RUB',
          'refunded',
          'revoked-history-' || sequence_number,
          'demo',
          'administration-test',
          '2026-07-29T10:00:00.000Z',
          'integration-test',
          '2026-07-29T10:00:00.000Z'::timestamptz
            + sequence_number * interval '1 second',
          '2026-07-29T10:00:00.000Z'::timestamptz
            + sequence_number * interval '1 second'
        FROM generate_series(1, 100)
          AS sequence_rows(sequence_number)
      `,
      [userId],
    );
    await pool.query(
      `
        INSERT INTO billing_access_grants (
          order_id,
          customer_id,
          plan_id,
          status,
          period_start,
          period_end,
          granted_at,
          revoked_at,
          created_at,
          updated_at
        )
        SELECT
          (
            '20000000-0000-4000-8000-'
            || lpad(to_hex(sequence_number), 12, '0')
          )::uuid,
          $1::uuid,
          'monthly',
          'revoked',
          '2026-06-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z',
          '2026-07-29T10:00:00.000Z'::timestamptz
            + sequence_number * interval '1 second',
          '2026-07-29T11:00:00.000Z',
          '2026-07-29T10:00:00.000Z'::timestamptz
            + sequence_number * interval '1 second',
          '2026-07-29T11:00:00.000Z'
        FROM generate_series(1, 100)
          AS sequence_rows(sequence_number)
      `,
      [userId],
    );
    const detail = await service.findStudentDetail({
      userId,
      permissions: ownerPermissions,
      at,
    });

    expect(detail).toMatchObject({
      id: userId,
      displayName: "Карточка Ученика",
      paymentContextVisible: true,
      billingContextVisible: true,
      receiptEmail: "receipt-detail@example.test",
      methods: [
        {
          type: "telegram",
          maskedIdentifier: "89…02",
          telegramUsername: "detail_student",
          telegramProfile: {
            subject: "8965978102",
            metadataVersion: 1,
            userId: "7739870613",
            profileName: "Карточка Ученика",
            firstName: "Карточка",
            lastName: "Ученика",
            username: "detail_student",
            photoUrl:
              "https://cdn4.telesco.pe/file/detail-avatar.jpg",
            requestedScopes: ["openid", "profile"],
            tokenIssuedAt: "2026-07-29T09:59:00.000Z",
            tokenExpiresAt:
              "2026-07-29T10:09:00.000Z",
          },
        },
      ],
      sessions: expect.arrayContaining([
        expect.objectContaining({
          authenticationMethod: "telegram_oidc",
          userAgentFamily: "Google Chrome",
          browserVersion: "138.0.0.0",
          operatingSystem: "macOS",
          operatingSystemVersion: "15.5",
          deviceType: "desktop",
          deviceVendor: "Apple",
          deviceModel: "Mac",
          architecture: "arm",
          bitness: "64",
          ipAddress: "203.0.113.42",
          countryCode: "RU",
          region: "Москва",
          regionCode: "MOW",
          city: "Москва",
          timezone: "Europe/Moscow",
          preferredLanguage: "ru-RU",
          rawUserAgent: "Integration Chrome on macOS",
          cloudflareRayId: "9abcdef012345678-DME",
        }),
      ]),
      sessionCount: 102,
      sessionsTruncated: true,
      effectiveAccess: {
        state: "active",
        activeUntil: "2027-07-01T00:00:00.000Z",
      },
      paidGrants: expect.arrayContaining([
        expect.objectContaining({
          orderId,
          planId: "annual",
          effectiveNow: true,
        }),
      ]),
      paymentCount: 1,
    });
    expect(detail?.sessions).toHaveLength(100);
    expect(detail?.paidGrants).toHaveLength(101);
    expect(JSON.stringify(detail)).not.toContain(rawToken);
    expect(JSON.stringify(detail)).not.toContain(tokenSha256);

    const restrictedDetail = await service.findStudentDetail({
      userId,
      permissions: new Set<AdminPermission>([
        "users.read",
        "access.read",
      ]),
      at,
    });
    const restrictedJson = JSON.stringify(restrictedDetail);

    expect(restrictedDetail).toMatchObject({
      id: userId,
      paymentContextVisible: false,
      billingContextVisible: false,
    });
    expect(restrictedDetail).not.toHaveProperty("receiptEmail");
    expect(restrictedDetail).not.toHaveProperty("paymentCount");
    expect(
      restrictedDetail?.paidGrants.every(
        (grant) => grant.orderId === undefined,
      ),
    ).toBe(true);
    expect(restrictedJson).not.toContain(
      "receipt-detail@example.test",
    );
    expect(restrictedJson).not.toContain(orderId);
  });

  it("возвращает null для неизвестного и некорректного UUID", async () => {
    await expect(
      service.findStudentDetail({
        userId: randomUUID(),
        permissions: ownerPermissions,
        at,
      }),
    ).resolves.toBeNull();
    await expect(
      service.findStudentDetail({
        userId: "не-uuid",
        permissions: ownerPermissions,
        at,
      }),
    ).resolves.toBeNull();
  });

  it("не открывает карточку без обязательных разрешений", async () => {
    await expect(
      service.findStudentDetail({
        userId: randomUUID(),
        permissions: new Set<AdminPermission>(["users.read"]),
        at,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_PERMISSION_DENIED",
      httpStatus: 403,
    });
  });

  it("не открывает список без обязательных разрешений", () => {
    try {
      service.listStudents({
        filters: defaultFilters,
        displayTimeZone: "Europe/Moscow",
        permissions: new Set<AdminPermission>(["users.read"]),
        at,
      });
      expect.unreachable(
        "Сервис обязан отклонить запрос без access.read.",
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: "ADMIN_PERMISSION_DENIED",
        httpStatus: 403,
      });
    }
  });
});
