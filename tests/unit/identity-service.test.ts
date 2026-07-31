import { describe, expect, it, vi } from "vitest";
import type { IdentityRepository } from "@/modules/identity/application/identity-repository";
import { IdentityService } from "@/modules/identity/application/identity-service";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Владелец",
  primaryMethod: {
    id: "22222222-2222-4222-8222-222222222222",
    type: "telegram" as const,
    identifier: "telegram-owner",
    metadata: {},
  },
};

function runtime() {
  const repository = {
    upsertIdentity: vi.fn().mockResolvedValue(user),
    createSession: vi.fn().mockResolvedValue(undefined),
    findUserBySessionTokenSha256: vi.fn(),
    revokeSession: vi.fn(),
    createLoginChallenge: vi.fn(),
    consumeLoginChallenge: vi.fn(),
  } satisfies IdentityRepository;

  return {
    repository,
    service: new IdentityService(repository, 30),
  };
}

const telegramInput = {
  authenticationMethod: "telegram_oidc" as const,
  methodType: "telegram" as const,
  identifier: "telegram-owner",
  displayName: "Владелец",
  metadata: {},
  consent: {
    acceptedAt: "2026-07-31T10:00:00.000Z",
    documentVersion: "2026-07-28",
    source: "telegram-openid-connect",
  },
};

describe("IdentityService", () => {
  it("создаёт обычный Telegram-вход без административного подтверждения", async () => {
    const { repository, service } = runtime();

    await service.authenticateIdentity(telegramInput);

    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticationMethod: "telegram_oidc",
        authenticationMethodId: user.primaryMethod.id,
        adminVerificationMethod: undefined,
      }),
    );
  });

  it("считает свежий Telegram-вход административным подтверждением только по явному намерению", async () => {
    const { repository, service } = runtime();

    await service.authenticateIdentity({
      ...telegramInput,
      administrativeAuthentication: true,
    });

    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticationMethod: "telegram_oidc",
        authenticationMethodId: user.primaryMethod.id,
        adminVerificationMethod: "telegram_oidc",
      }),
    );
  });

  it("не позволяет demo-входу создать административное подтверждение", async () => {
    const { repository, service } = runtime();

    await expect(
      service.authenticateIdentity({
        ...telegramInput,
        authenticationMethod: "demo",
        administrativeAuthentication: true,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      httpStatus: 400,
    });
    expect(repository.upsertIdentity).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });
});
