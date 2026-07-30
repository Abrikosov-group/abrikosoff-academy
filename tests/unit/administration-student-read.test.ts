import { describe, expect, it } from "vitest";
import {
  decodeAdminStudentCursor,
  encodeAdminStudentCursor,
  parseAdminStudentListQuery,
} from "@/modules/administration/domain/student-list-query";
import {
  deriveEffectivePaidAccess,
  formatIpAddress,
  formatPrimaryIdentityMethod,
  formatRussianCount,
  formatStudentSummaryIdentity,
  hasLegacyTelegramProfileMetadata,
  hasNoSessionTechnicalContext,
  maskIdentityIdentifier,
  normalizeAdminStudentsReturnTo,
  normalizeTelegramUsername,
  selectPrimaryTelegramMethod,
  sortAdminStudentSessions,
  telegramProfileUrl,
} from "@/modules/administration/domain/student-presentation";
import type {
  AdminStudentIdentityMethod,
  AdminStudentSession,
} from "@/modules/administration/domain/student-read-model";

const cursor = {
  createdAt: "2026-07-29T10:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
};

describe("запрос списка учеников", () => {
  it("принимает только поддерживаемые фильтры", () => {
    const parsed = parseAdminStudentListQuery({
      q: "  @student_name  ",
      status: "active",
      access: "scheduled",
      source: "paid",
      plan: "annual",
      from: "2026-07-01",
      to: "2026-07-31",
      limit: "100",
      cursor: encodeAdminStudentCursor(cursor),
    });

    expect(parsed).toEqual({
      filters: {
        query: "@student_name",
        status: "active",
        access: "scheduled",
        source: "paid",
        plan: "annual",
        registeredFrom: "2026-07-01",
        registeredTo: "2026-07-31",
        limit: 100,
      },
      cursor,
    });
  });

  it("безопасно сбрасывает неизвестные значения и битый курсор", () => {
    expect(
      parseAdminStudentListQuery({
        status: "administrator",
        access: "all",
        source: "manual",
        plan: "lifetime",
        from: "2026-02-30",
        to: "не-дата",
        limit: "5000",
        cursor: "не-курсор",
      }),
    ).toEqual({
      filters: {
        query: "",
        status: undefined,
        access: undefined,
        source: undefined,
        plan: undefined,
        registeredFrom: undefined,
        registeredTo: undefined,
        limit: 50,
      },
      cursor: undefined,
    });
  });

  it("принимает составной фильтр без удалённых учеников", () => {
    expect(
      parseAdminStudentListQuery({
        status: "not_deleted",
      }).filters.status,
    ).toBe("not_deleted");
  });

  it("кодирует непрозрачный курсор без потери значений", () => {
    const encoded = encodeAdminStudentCursor(cursor);

    expect(encoded).not.toContain(cursor.id);
    expect(decodeAdminStudentCursor(encoded)).toEqual(cursor);
  });
});

describe("безопасное представление ученика", () => {
  it("различает IPv4 и компактно показывает длинный IPv6", () => {
    expect(formatIpAddress("45.182.123.99")).toEqual({
      compact: "45.182.123.99",
      version: "IPv4",
    });
    expect(
      formatIpAddress(
        "2804:291c:903:c443:d274:a50d:e556:62cb",
      ),
    ).toEqual({
      compact: "2804:291c:903:…:e556:62cb",
      version: "IPv6",
    });
    expect(formatIpAddress("::1")).toEqual({
      compact: "::1",
      version: "IPv6",
    });
  });

  it("маскирует постоянные идентификаторы входа", () => {
    expect(
      maskIdentityIdentifier("email", "student@example.test"),
    ).toBe("s•••@example.test");
    expect(
      maskIdentityIdentifier("phone", "+7 (958) 111-07-75"),
    ).toBe("••••••••75");
    expect(
      maskIdentityIdentifier("telegram", "8965978102"),
    ).toBe("89…02");
  });

  it("не показывает Telegram sub при наличии username", () => {
    expect(
      formatPrimaryIdentityMethod({
        type: "telegram",
        identifier: "8965978102",
        telegramUsername: "student_name",
      }),
    ).toBe("Telegram · @st…me");
  });

  it.each([
    [0, "0 сессий"],
    [1, "1 сессия"],
    [2, "2 сессии"],
    [5, "5 сессий"],
    [11, "11 сессий"],
    [21, "21 сессия"],
    [24, "24 сессии"],
  ])(
    "склоняет подписанный счётчик %s",
    (count, expected) => {
      expect(
        formatRussianCount(count, [
          "сессия",
          "сессии",
          "сессий",
        ]),
      ).toBe(expected);
    },
  );

  it("выбирает последний подтверждённый Telegram-профиль", () => {
    const methods: AdminStudentIdentityMethod[] = [
      {
        id: "first",
        type: "telegram",
        maskedIdentifier: "11…11",
        verifiedAt: "2026-07-29T10:00:00.000Z",
        telegramProfile: {
          subject: "first-subject",
          requestedScopes: ["openid"],
        },
      },
      {
        id: "email",
        type: "email",
        maskedIdentifier: "s•••@example.test",
        verifiedAt: "2026-07-30T12:00:00.000Z",
      },
      {
        id: "latest",
        type: "telegram",
        maskedIdentifier: "22…22",
        verifiedAt: "2026-07-30T11:00:00.000Z",
        telegramProfile: {
          subject: "latest-subject",
          requestedScopes: ["openid", "profile"],
        },
      },
    ];

    expect(selectPrimaryTelegramMethod(methods)?.id).toBe(
      "latest",
    );
  });

  it("определяет legacy-профиль по версии схемы, а не по необязательным полям", () => {
    expect(
      hasLegacyTelegramProfileMetadata({
        subject: "current-subject",
        metadataVersion: 1,
        requestedScopes: ["openid", "profile"],
      }),
    ).toBe(false);
    expect(
      hasLegacyTelegramProfileMetadata({
        subject: "legacy-subject",
        requestedScopes: [],
      }),
    ).toBe(true);
  });

  it("показывает username Telegram или безопасный email в сводке", () => {
    const emailMethod: AdminStudentIdentityMethod = {
      id: "email",
      type: "email",
      maskedIdentifier: "s•••@example.test",
      verifiedAt: "2026-07-30T12:00:00.000Z",
    };
    const telegramMethod: AdminStudentIdentityMethod = {
      id: "telegram",
      type: "telegram",
      maskedIdentifier: "77…13",
      telegramUsername: "@student_name",
      verifiedAt: "2026-07-29T12:00:00.000Z",
    };

    expect(formatStudentSummaryIdentity([emailMethod])).toBe(
      "Email · s•••@example.test",
    );
    expect(
      formatStudentSummaryIdentity([
        emailMethod,
        telegramMethod,
      ]),
    ).toBe("@student_name");
    expect(formatStudentSummaryIdentity([])).toBe(
      "Способы входа не подключены",
    );
  });

  it("сортирует сессии по состоянию и времени создания", () => {
    const session = (
      id: string,
      state: AdminStudentSession["state"],
      createdAt: string,
      lastSeenAt = createdAt,
    ): AdminStudentSession => ({
      id,
      state,
      createdAt,
      lastSeenAt,
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    const sessions = [
      session(
        "expired-new",
        "expired",
        "2026-07-30T12:00:00.000Z",
      ),
      session(
        "active-old",
        "active",
        "2026-07-29T12:00:00.000Z",
        "2026-07-31T12:00:00.000Z",
      ),
      session(
        "revoked",
        "revoked",
        "2026-07-31T12:00:00.000Z",
      ),
      session(
        "active-new",
        "active",
        "2026-07-30T12:00:00.000Z",
        "2026-07-28T12:00:00.000Z",
      ),
    ];

    expect(
      sortAdminStudentSessions(sessions).map(
        (item) => item.id,
      ),
    ).toEqual([
      "active-new",
      "active-old",
      "expired-new",
      "revoked",
    ]);
    expect(sessions[0]?.id).toBe("expired-new");
  });

  it("отличает старую сессию без технического контекста", () => {
    const base: AdminStudentSession = {
      id: "session",
      state: "active",
      createdAt: "2026-07-30T12:00:00.000Z",
      lastSeenAt: "2026-07-30T12:00:00.000Z",
      expiresAt: "2026-08-30T12:00:00.000Z",
    };

    expect(hasNoSessionTechnicalContext(base)).toBe(true);
    expect(
      hasNoSessionTechnicalContext({
        ...base,
        authenticationMethod: "telegram_oidc",
      }),
    ).toBe(true);
    expect(
      hasNoSessionTechnicalContext({
        ...base,
        userAgentFamily: "Google Chrome",
      }),
    ).toBe(false);
  });

  it("строит Telegram URL только из допустимого username", () => {
    expect(normalizeTelegramUsername("@student_name")).toBe(
      "student_name",
    );
    expect(telegramProfileUrl("student_name")).toBe(
      "https://t.me/student_name",
    );
    expect(telegramProfileUrl("../redirect")).toBeUndefined();
  });

  it("принимает returnTo только на список учеников", () => {
    expect(
      normalizeAdminStudentsReturnTo(
        "/admin/students?q=telegram&limit=25",
      ),
    ).toBe("/admin/students?q=telegram&limit=25");
    expect(
      normalizeAdminStudentsReturnTo(
        "/admin/students/user-id",
      ),
    ).toBe("/admin/students");
    expect(
      normalizeAdminStudentsReturnTo(
        "https://example.test/admin/students",
      ),
    ).toBe("/admin/students");
  });
});

describe("фактический оплаченный доступ", () => {
  const at = new Date("2026-07-29T12:00:00.000Z");
  const baseGrant = {
    source: "paid" as const,
    orderId: "11111111-1111-4111-8111-111111111111",
    planId: "monthly" as const,
    status: "granted" as const,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    grantedAt: "2026-07-01T00:00:00.000Z",
  };

  it("выбирает максимальное окончание пересекающихся активных грантов", () => {
    const result = deriveEffectivePaidAccess(
      [
        baseGrant,
        {
          ...baseGrant,
          orderId: "22222222-2222-4222-8222-222222222222",
          planId: "annual",
          periodEnd: "2027-07-01T00:00:00.000Z",
        },
      ],
      at,
    );

    expect(result.summary).toMatchObject({
      state: "active",
      activeUntil: "2027-07-01T00:00:00.000Z",
    });
    expect(result.grants.every((grant) => grant.effectiveNow)).toBe(
      true,
    );
  });

  it("продлевает окончание по непрерывной цепочке будущих периодов", () => {
    const result = deriveEffectivePaidAccess(
      [
        baseGrant,
        {
          ...baseGrant,
          orderId: "22222222-2222-4222-8222-222222222222",
          periodStart: "2026-07-31T00:00:00.000Z",
          periodEnd: "2026-09-01T00:00:00.000Z",
        },
        {
          ...baseGrant,
          orderId: "33333333-3333-4333-8333-333333333333",
          periodStart: "2026-08-31T00:00:00.000Z",
          periodEnd: "2026-10-01T00:00:00.000Z",
        },
      ],
      at,
    );

    expect(result.summary).toMatchObject({
      state: "active",
      activeUntil: "2026-10-01T00:00:00.000Z",
    });
    expect(result.grants.filter((grant) => grant.effectiveNow)).toHaveLength(
      1,
    );
  });

  it.each([
    [
      "scheduled",
      {
        ...baseGrant,
        periodStart: "2026-08-02T00:00:00.000Z",
        periodEnd: "2026-09-02T00:00:00.000Z",
      },
    ],
    [
      "expired",
      {
        ...baseGrant,
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
      },
    ],
    [
      "revoked",
      {
        ...baseGrant,
        status: "revoked" as const,
        revokedAt: "2026-07-15T00:00:00.000Z",
      },
    ],
  ] as const)("различает состояние %s", (state, grant) => {
    const summary = deriveEffectivePaidAccess([grant], at).summary;

    expect(summary.state).toBe(state);
    if (state === "revoked") {
      expect(summary.mostRecentEnd).toBeUndefined();
    }
  });

  it("возвращает none при отсутствии источников", () => {
    expect(deriveEffectivePaidAccess([], at).summary).toEqual({
      state: "none",
      activeUntil: undefined,
      scheduledFrom: undefined,
      mostRecentEnd: undefined,
    });
  });
});
