import { describe, expect, it, vi } from "vitest";
import type { AdministrationRepository } from "@/modules/administration/application/administration-repository";
import { AdministrationService } from "@/modules/administration/application/administration-service";
import type { AdminSessionRecord } from "@/modules/administration/domain/types";

const now = new Date("2026-07-29T10:00:00.000Z");

function session(
  overrides: Partial<AdminSessionRecord> = {},
): AdminSessionRecord {
  return {
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Владелец",
      primaryMethod: {
        id: "22222222-2222-4222-8222-222222222222",
        type: "telegram",
        identifier: "telegram-owner",
        metadata: {},
      },
    },
    sessionId: "33333333-3333-4333-8333-333333333333",
    authenticatedAt: new Date("2026-07-29T09:00:00.000Z"),
    authenticationMethod: "telegram_oidc",
    authenticationMethodId:
      "22222222-2222-4222-8222-222222222222",
    authenticationMethodMatches: true,
    adminVerifiedAt: new Date("2026-07-29T09:30:00.000Z"),
    adminVerificationMethod: "telegram_oidc",
    adminBreakGlassExpiresAt: null,
    roles: ["owner"],
    ...overrides,
  };
}

function runtime(
  record: AdminSessionRecord | null,
  enabled = true,
) {
  const repository = {
    findActiveRolesByUserId: vi.fn().mockResolvedValue(
      record?.roles ?? [],
    ),
    findAdminSessionByTokenSha256: vi
      .fn()
      .mockResolvedValue(record),
    rotateSessionForTelegramAdmin: vi.fn(),
  } satisfies AdministrationRepository;
  const service = new AdministrationService(repository, {
    enabled,
    sessionTtlDays: 30,
  });

  return { repository, service };
}

describe("AdministrationService", () => {
  it("показывает вход в админку только для активной включённой роли", async () => {
    const ownerRuntime = runtime(session());
    const supportRuntime = runtime(
      session({ roles: ["support"] }),
    );

    await expect(
      ownerRuntime.service.canEnterAdministration(
        session().actor.id,
      ),
    ).resolves.toBe(true);
    await expect(
      supportRuntime.service.canEnterAdministration(
        session().actor.id,
      ),
    ).resolves.toBe(false);
    expect(
      ownerRuntime.repository.findActiveRolesByUserId,
    ).toHaveBeenCalledWith(session().actor.id);
  });

  it("не обращается к ролям при выключенном контуре", async () => {
    const { repository, service } = runtime(session(), false);

    await expect(
      service.canEnterAdministration(session().actor.id),
    ).resolves.toBe(false);
    expect(
      repository.findActiveRolesByUserId,
    ).not.toHaveBeenCalled();
  });

  it("запрещает контур при выключенном release-гейте", async () => {
    const { service } = runtime(session(), false);

    await expect(
      service.getContext({
        tokenSha256: "a".repeat(64),
        permission: "admin.enter",
        requestId: "request-1",
        now,
      }),
    ).rejects.toMatchObject({
      code: "ADMINISTRATION_DISABLED",
      httpStatus: 404,
    });
  });

  it("не повышает legacy- и demo-сессии", async () => {
    for (const record of [
      session({
        authenticatedAt: null,
        authenticationMethod: null,
        authenticationMethodId: null,
        authenticationMethodMatches: false,
      }),
      session({
        authenticationMethod: "demo",
      }),
      session({
        authenticationMethodMatches: false,
      }),
    ]) {
      const { service } = runtime(record);

      await expect(
        service.prepareTelegramVerification({
          tokenSha256: "b".repeat(64),
          now,
        }),
      ).rejects.toMatchObject({
        code: "ADMIN_LOGIN_REQUIRED",
      });
    }
  });

  it("отличает отсутствие роли от повторного подтверждения", async () => {
    const withoutRole = runtime(session({ roles: [] })).service;
    const withoutVerification = runtime(
      session({
        adminVerifiedAt: null,
        adminVerificationMethod: null,
      }),
    ).service;

    await expect(
      withoutRole.getContext({
        tokenSha256: "c".repeat(64),
        permission: "admin.enter",
        requestId: "request-2",
        now,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_ROLE_REQUIRED",
      httpStatus: 403,
    });
    await expect(
      withoutVerification.getContext({
        tokenSha256: "d".repeat(64),
        permission: "admin.enter",
        requestId: "request-3",
        now,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_REAUTH_REQUIRED",
    });
  });

  it("отклоняет административное подтверждение старше 12 часов", async () => {
    const { service } = runtime(
      session({
        adminVerifiedAt: new Date(
          "2026-07-28T21:59:59.000Z",
        ),
      }),
    );

    await expect(
      service.getContext({
        tokenSha256: "e".repeat(64),
        permission: "admin.enter",
        requestId: "request-4",
        now,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_REAUTH_REQUIRED",
    });
  });

  it("возвращает только серверные роли и разрешения", async () => {
    const { service } = runtime(session());
    const context = await service.getContext({
      tokenSha256: "f".repeat(64),
      permission: "dashboard.read",
      requestId: "request-5",
      now,
    });

    expect(context).toMatchObject({
      sessionId: "33333333-3333-4333-8333-333333333333",
      roles: ["owner"],
      adminVerificationMethod: "telegram_oidc",
      requestId: "request-5",
    });
    expect(context.permissions.has("roles.write")).toBe(true);
  });

  it("не включает отключённую роль support", async () => {
    const { service } = runtime(session({ roles: ["support"] }));

    await expect(
      service.getContext({
        tokenSha256: "1".repeat(64),
        permission: "users.read",
        requestId: "request-6",
        now,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_ROLE_REQUIRED",
    });
  });

  it("ротирует токен только после репозиторной проверки Telegram", async () => {
    const { repository, service } = runtime(session());
    repository.rotateSessionForTelegramAdmin.mockResolvedValue({
      user: session().actor,
    });

    const confirmed = await service.confirmTelegramVerification({
      currentTokenSha256: "2".repeat(64),
      expectedSessionId:
        "33333333-3333-4333-8333-333333333333",
      expectedUserId:
        "11111111-1111-4111-8111-111111111111",
      telegramIdentifier: "telegram-owner",
      userAgentFamily: "Google Chrome",
      now,
    });

    expect(confirmed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(confirmed.expiresAt).toEqual(
      new Date("2026-08-28T10:00:00.000Z"),
    );
    expect(
      repository.rotateSessionForTelegramAdmin,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTokenSha256: "2".repeat(64),
        expectedSessionId:
          "33333333-3333-4333-8333-333333333333",
        expectedUserId:
          "11111111-1111-4111-8111-111111111111",
        telegramIdentifier: "telegram-owner",
        userAgentFamily: "Google Chrome",
        newTokenSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });
});
