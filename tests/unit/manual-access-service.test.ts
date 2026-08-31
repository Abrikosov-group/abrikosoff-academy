import { describe, expect, it, vi } from "vitest";
import type {
  AdminCommandInspection,
  AdminCommandReservation,
  AdministrationManualAccessCommandRepository,
  GrantManualAccessCommand,
  GrantManualAccessExecution,
  RevokeManualAccessExecution,
} from "@/modules/administration/application/administration-command-repository";
import {
  GrantManualAccessService,
  normalizeGrantManualAccessInput,
  normalizeRevokeManualAccessInput,
  RevokeManualAccessService,
} from "@/modules/administration/application/manual-access-service";
import type {
  AdminContext,
  AdminPermission,
} from "@/modules/administration/domain/types";

const actorId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const grantId = "33333333-3333-4333-8333-333333333333";

function context(
  permissions: ReadonlySet<AdminPermission> = new Set([
    "access.manual.grant",
    "access.manual.revoke",
  ] as const),
): AdminContext {
  return {
    actor: {
      id: actorId,
      displayName: "Владелец",
      primaryMethod: {
        id: "44444444-4444-4444-8444-444444444444",
        type: "telegram",
        identifier: "owner",
        metadata: {},
      },
    },
    sessionId: "55555555-5555-4555-8555-555555555555",
    roles: ["owner"],
    permissions,
    adminVerifiedAt: new Date(),
    adminVerificationMethod: "telegram_oidc",
    requestId: "66666666-6666-4666-8666-666666666666",
  };
}

const effectiveAccess = {
  evaluatedAt: "2026-09-01T00:00:00.000Z",
  canReadCourses: true,
  activePeriod: {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-10-01T00:00:00.000Z",
  },
  activeBases: [
    {
      id: grantId,
      source: "manual" as const,
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-10-01T00:00:00.000Z",
    },
  ],
};

class FakeRepository
  implements AdministrationManualAccessCommandRepository
{
  inspection: AdminCommandInspection = { state: "missing" };
  reservation: AdminCommandReservation = {
    state: "reserved",
    executionId: "77777777-7777-4777-8777-777777777777",
    attemptCount: 1,
  };
  grantExecution: GrantManualAccessExecution = {
    state: "succeeded",
    grantId,
    customerId,
    status: "granted",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T00:00:00.000Z",
    grantedAt: "2026-09-01T00:00:00.000Z",
    overlapCount: 0,
    effectiveAccess,
  };
  revokeExecution: RevokeManualAccessExecution = {
    state: "succeeded",
    grantId,
    customerId,
    status: "revoked",
    revokedAt: "2026-09-02T00:00:00.000Z",
    effectiveAccess: { ...effectiveAccess, canReadCourses: false },
  };
  rejectedGate?: string;

  async inspectInternalCommand() {
    return this.inspection;
  }
  async reserveInternalCommand() {
    return this.reservation;
  }
  async executeGrantManualAccess() {
    return this.grantExecution;
  }
  async executeRevokeManualAccess() {
    return this.revokeExecution;
  }
  async rejectManualAccessGrantingGate(
    _command: GrantManualAccessCommand,
    _reservation: { executionId: string; attemptCount: number },
    errorCode:
      | "MANUAL_ACCESS_GRANTING_DISABLED"
      | "MANUAL_ACCESS_GRANTING_REQUIRES_V2",
  ) {
    this.rejectedGate = errorCode;
    return true;
  }
  async recordFailedInternalCommand() {
    return true;
  }
}

const grantInput = {
  context: context(),
  targetUserId: customerId,
  periodStart: "2026-09-01T03:00:00+03:00",
  periodEnd: "2026-10-01T03:00:00+03:00",
  reason: "  Доступ по решению владельца Академии  ",
  idempotencyKey: "manual-grant-0001",
};

describe("ручное управление доступом", () => {
  it("нормализует UTC, причину и стабильный request hash", () => {
    const first = normalizeGrantManualAccessInput(grantInput);
    const second = normalizeGrantManualAccessInput({
      ...grantInput,
      context: { ...grantInput.context, requestId: crypto.randomUUID() },
    });
    expect(first.periodStart).toBe("2026-09-01T00:00:00.000Z");
    expect(first.periodEnd).toBe("2026-10-01T00:00:00.000Z");
    expect(first.reason).toBe("Доступ по решению владельца Академии");
    expect(first.requestSha256).toBe(second.requestSha256);
  });

  it.each([
    ["неканонический UUID", { targetUserId: "not-a-uuid" }],
    ["дата без offset", { periodStart: "2026-09-01T00:00:00" }],
    ["несуществующая календарная дата", { periodStart: "2026-02-30T00:00:00Z" }],
    ["короткая причина", { reason: "коротко" }],
    ["управляющий символ", { reason: "Причина доступа\nс переносом" }],
    ["короткий ключ", { idempotencyKey: "short" }],
    ["обратный период", { periodEnd: "2026-08-01T00:00:00Z" }],
  ])("отклоняет некорректный ввод: %s", (_label, change) => {
    expect(() =>
      normalizeGrantManualAccessInput({ ...grantInput, ...change }),
    ).toThrowError(
      expect.objectContaining({ code: "ADMIN_COMMAND_INVALID_REQUEST" }),
    );
  });

  it("ограничивает обычную выдачу 31 сутками и разрешает длинную владельцу", () => {
    expect(() =>
      normalizeGrantManualAccessInput({
        ...grantInput,
        periodEnd: "2026-10-02T00:00:00Z",
      }),
    ).not.toThrow();
    expect(() =>
      normalizeGrantManualAccessInput({
        ...grantInput,
        periodEnd: "2026-11-01T00:00:00Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "ADMIN_COMMAND_INVALID_REQUEST" }));
    expect(() =>
      normalizeGrantManualAccessInput({
        ...grantInput,
        context: context(
          new Set([
            "access.manual.grant",
            "access.manual.grant_long",
          ] as const),
        ),
        periodEnd: "2026-11-01T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("отклоняет окончание в прошлом до резервирования", async () => {
    const repository = new FakeRepository();
    const reserve = vi.spyOn(repository, "reserveInternalCommand");
    const service = new GrantManualAccessService(repository, {
      manualAccessGrantingEnabled: true,
      effectiveAccessMode: "v2",
    });
    await expect(
      service.execute({
        ...grantInput,
        periodStart: "2025-01-01T00:00:00Z",
        periodEnd: "2025-01-02T00:00:00Z",
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "ADMIN_COMMAND_INVALID_REQUEST" }),
    );
    expect(reserve).not.toHaveBeenCalled();
  });

  it("проверяет предметные права выдачи и отзыва", async () => {
    const repository = new FakeRepository();
    const noPermissions = context(new Set());
    await expect(
      new GrantManualAccessService(repository, {
        manualAccessGrantingEnabled: true,
        effectiveAccessMode: "v2",
      }).execute({ ...grantInput, context: noPermissions }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "ADMIN_PERMISSION_DENIED" }),
    );
    await expect(
      new RevokeManualAccessService(repository).execute({
        context: noPermissions,
        targetUserId: customerId,
        grantId,
        reason: "Доступ выдан на неверный период",
        idempotencyKey: "manual-revoke-001",
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "ADMIN_PERMISSION_DENIED" }),
    );
  });

  it("не резервирует новую выдачу при выключенном флаге", async () => {
    const repository = new FakeRepository();
    const reserve = vi.spyOn(repository, "reserveInternalCommand");
    const service = new GrantManualAccessService(repository, {
      manualAccessGrantingEnabled: false,
      effectiveAccessMode: "v2",
    });
    await expect(service.execute(grantInput)).rejects.toEqual(
      expect.objectContaining({ code: "MANUAL_ACCESS_GRANTING_DISABLED" }),
    );
    expect(reserve).not.toHaveBeenCalled();
  });

  it("возвращает точный replay успеха до текущих release-gates", async () => {
    const repository = new FakeRepository();
    repository.inspection = {
      state: "replayed",
      executionId: "77777777-7777-4777-8777-777777777777",
      status: "succeeded",
      resultStatus: 201,
      result: {
        ...repository.grantExecution,
        state: undefined,
      },
    };
    const service = new GrantManualAccessService(repository, {
      manualAccessGrantingEnabled: false,
      effectiveAccessMode: "shadow",
    });
    await expect(service.execute(grantInput)).resolves.toMatchObject({
      grantId,
      status: "granted",
    });
  });

  it.each(["conflict", "in_progress"] as const)(
    "возвращает состояние журнала %s",
    async (state) => {
      const repository = new FakeRepository();
      repository.inspection = { state };
      const service = new GrantManualAccessService(repository, {
        manualAccessGrantingEnabled: true,
        effectiveAccessMode: "v2",
      });
      await expect(service.execute(grantInput)).rejects.toEqual(
        expect.objectContaining({
          code:
            state === "conflict"
              ? "IDEMPOTENCY_CONFLICT"
              : "COMMAND_IN_PROGRESS",
        }),
      );
    },
  );

  it("закрывает повреждённый сохранённый результат", async () => {
    const repository = new FakeRepository();
    repository.inspection = {
      state: "replayed",
      executionId: "77777777-7777-4777-8777-777777777777",
      status: "succeeded",
      resultStatus: 201,
      result: { status: "granted" },
    };
    const service = new GrantManualAccessService(repository, {
      manualAccessGrantingEnabled: false,
      effectiveAccessMode: "shadow",
    });
    await expect(service.execute(grantInput)).rejects.toThrow(
      "Сохранённый результат команды имеет неверный формат.",
    );
  });

  it("терминально отклоняет захваченную выдачу при закрывшемся gate", async () => {
    const repository = new FakeRepository();
    repository.inspection = { state: "recoverable" };
    const service = new GrantManualAccessService(repository, {
      manualAccessGrantingEnabled: true,
      effectiveAccessMode: "shadow",
    });
    await expect(service.execute(grantInput)).rejects.toEqual(
      expect.objectContaining({ code: "MANUAL_ACCESS_GRANTING_REQUIRES_V2" }),
    );
    expect(repository.rejectedGate).toBe(
      "MANUAL_ACCESS_GRANTING_REQUIRES_V2",
    );
  });

  it("отзыв не зависит от флага выдачи и адресует конкретный грант", async () => {
    const repository = new FakeRepository();
    const service = new RevokeManualAccessService(repository);
    await expect(
      service.execute({
        context: context(),
        targetUserId: customerId,
        grantId,
        reason: "Доступ выдан на неверный период",
        idempotencyKey: "manual-revoke-001",
      }),
    ).resolves.toMatchObject({ grantId, status: "revoked" });
  });

  it("хэш отзыва учитывает ученика, грант и точную причину", () => {
    const first = normalizeRevokeManualAccessInput({
      context: context(),
      targetUserId: customerId,
      grantId,
      reason: "Доступ выдан на неверный период",
      idempotencyKey: "manual-revoke-001",
    });
    const changed = normalizeRevokeManualAccessInput({
      context: context(),
      targetUserId: customerId,
      grantId,
      reason: "Доступ отзывается по другому решению",
      idempotencyKey: "manual-revoke-001",
    });
    expect(first.targetType).toBe("access_manual_grant");
    expect(first.requestSha256).not.toBe(changed.requestSha256);
  });
});
