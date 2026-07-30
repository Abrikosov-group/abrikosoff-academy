import { describe, expect, it, vi } from "vitest";
import type {
  AdminCommandReservation,
  AdministrationCommandRepository,
  InternalAdminCommand,
  RevokeUserSessionsExecution,
} from "@/modules/administration/application/administration-command-repository";
import {
  normalizeRevokeUserSessionsInput,
  RevokeUserSessionsService,
} from "@/modules/administration/application/revoke-user-sessions-service";
import { AdministrationError } from "@/modules/administration/domain/errors";
import { revokeUserSessionsReasonOptions } from "@/modules/administration/domain/revoke-user-sessions";
import type { AdminContext } from "@/modules/administration/domain/types";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetUserId =
  "22222222-2222-4222-8222-222222222222";

function adminContext(
  permissions = new Set(["sessions.revoke"] as const),
): AdminContext {
  return {
    actor: {
      id: actorId,
      displayName: "Владелец",
      primaryMethod: {
        id: "33333333-3333-4333-8333-333333333333",
        type: "telegram",
        identifier: "owner",
        metadata: {},
      },
    },
    sessionId: "44444444-4444-4444-8444-444444444444",
    roles: ["owner"],
    permissions,
    adminVerifiedAt: new Date("2026-07-30T12:00:00.000Z"),
    adminVerificationMethod: "telegram_oidc",
    requestId: "55555555-5555-4555-8555-555555555555",
  };
}

class FakeCommandRepository
  implements AdministrationCommandRepository
{
  reservation: AdminCommandReservation = {
    state: "reserved",
    executionId: "66666666-6666-4666-8666-666666666666",
    attemptCount: 1,
  };
  execution: RevokeUserSessionsExecution = {
    state: "succeeded",
    revokedSessionCount: 3,
  };
  executeError?: unknown;
  reservedCommand?: InternalAdminCommand;
  failureCode?: string;
  failureRecorded = true;
  failurePersistenceError?: unknown;

  async reserveInternalCommand(command: InternalAdminCommand) {
    this.reservedCommand = command;
    return this.reservation;
  }

  async executeRevokeUserSessions() {
    if (this.executeError) {
      throw this.executeError;
    }

    return this.execution;
  }

  async recordFailedInternalCommand(
    _command: InternalAdminCommand,
    _reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode: string,
  ) {
    if (this.failurePersistenceError) {
      throw this.failurePersistenceError;
    }

    this.failureCode = errorCode;
    return this.failureRecorded;
  }
}

const validInput = {
  context: adminContext(),
  targetUserId,
  reason: "  suspected_unauthorized_access  ",
  idempotencyKey: "revoke-sessions-0001",
};

describe("RevokeUserSessionsService", () => {
  it("использует уникальные обезличенные причины допустимой длины", () => {
    const codes = revokeUserSessionsReasonOptions.map(
      (option) => option.code,
    );
    const reasons = revokeUserSessionsReasonOptions.map(
      (option) => option.canonicalReason,
    );

    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(reasons).size).toBe(reasons.length);

    for (const reason of reasons) {
      expect(reason).toBe(reason.trim());
      expect(reason.length).toBeGreaterThanOrEqual(10);
      expect(reason.length).toBeLessThanOrEqual(500);
      expect(reason).not.toMatch(/[\u0000-\u001f\u007f]/u);
    }
  });

  it("нормализует код причины и строит стабильный хэш канонического запроса", () => {
    const first = normalizeRevokeUserSessionsInput(validInput);
    const second = normalizeRevokeUserSessionsInput({
      ...validInput,
      context: {
        ...validInput.context,
        requestId: "77777777-7777-4777-8777-777777777777",
      },
    });
    const changedTarget = normalizeRevokeUserSessionsInput({
      ...validInput,
      targetUserId:
        "88888888-8888-4888-8888-888888888888",
    });

    expect(first.reason).toBe(
      "Подозрение на посторонний доступ",
    );
    expect(first.principalKey).toBe(`user:${actorId}`);
    expect(first.requestSha256).toBe(second.requestSha256);
    expect(changedTarget.requestSha256).not.toBe(
      first.requestSha256,
    );
  });

  it("не принимает команду без sessions.revoke", () => {
    expect(() =>
      normalizeRevokeUserSessionsInput({
        ...validInput,
        context: adminContext(new Set()),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ADMIN_PERMISSION_DENIED",
      }),
    );
  });

  it.each([
    ["короткую причину", { reason: "коротко" }],
    [
      "произвольную причину с персональными данными",
      { reason: "Ученик student@example.com потерял токен" },
    ],
    [
      "небезопасный ключ",
      { idempotencyKey: "not safe key 0001" },
    ],
    ["неверный UUID", { targetUserId: "not-a-uuid" }],
  ])("отклоняет %s до резервирования", (_label, change) => {
    expect(() =>
      normalizeRevokeUserSessionsInput({
        ...validInput,
        ...change,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ADMIN_COMMAND_INVALID_REQUEST",
      }),
    );
  });

  it("возвращает число отозванных сессий", async () => {
    const repository = new FakeCommandRepository();
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).resolves.toEqual({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      revokedSessionCount: 3,
    });
    expect(repository.reservedCommand).toMatchObject({
      actorUserId: actorId,
      targetId: targetUserId,
      reason: "Подозрение на посторонний доступ",
    });
  });

  it("возвращает сохранённый успешный результат без нового исполнения", async () => {
    const repository = new FakeCommandRepository();

    repository.reservation = {
      state: "replayed",
      executionId: "66666666-6666-4666-8666-666666666666",
      status: "succeeded",
      resultStatus: 200,
      result: {
        activeSessionCount: 0,
        revokedSessionCount: 4,
      },
    };
    const execute = vi.spyOn(
      repository,
      "executeRevokeUserSessions",
    );
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).resolves.toEqual({
      activeSessionCount: 0,
      currentSessionRevoked: false,
      revokedSessionCount: 4,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      "конфликт ключа",
      { state: "conflict" as const },
      "IDEMPOTENCY_CONFLICT",
    ],
    [
      "живое исполнение",
      { state: "in_progress" as const },
      "COMMAND_IN_PROGRESS",
    ],
  ])(
    "отражает состояние резервирования: %s",
    async (_label, reservation, expectedCode) => {
      const repository = new FakeCommandRepository();

      repository.reservation = reservation;
      const service = new RevokeUserSessionsService(repository);

      await expect(service.execute(validInput)).rejects.toEqual(
        expect.objectContaining({
          code: expectedCode,
          httpStatus: 409,
        }),
      );
    },
  );

  it("не превращает предметный отказ в failed", async () => {
    const repository = new FakeCommandRepository();

    repository.execution = {
      state: "rejected",
      errorCode: "USER_NOT_FOUND",
      resultStatus: 404,
    };
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).rejects.toEqual(
      expect.objectContaining({
        code: "USER_NOT_FOUND",
        httpStatus: 404,
      }),
    );
    expect(repository.failureCode).toBeUndefined();
  });

  it("финализирует непредвиденный сбой безопасным кодом", async () => {
    const repository = new FakeCommandRepository();

    repository.executeError = new Error(
      "секрет не должен попасть в результат",
    );
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).rejects.toEqual(
      expect.objectContaining({
        code: "REVOKE_USER_SESSIONS_FAILED",
        httpStatus: 500,
      }),
    );
    expect(repository.failureCode).toBe(
      "REVOKE_USER_SESSIONS_FAILED",
    );
  });

  it("сохраняет ключ, если fencing-попытка уже сменилась", async () => {
    const repository = new FakeCommandRepository();

    repository.executeError = new Error(
      "Неоднозначный результат исполнения",
    );
    repository.failureRecorded = false;
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).rejects.toEqual(
      expect.objectContaining({
        code: "COMMAND_ATTEMPT_SUPERSEDED",
        httpStatus: 409,
      }),
    );
  });

  it("оставляет ключ для восстановления при недоступном аудите", async () => {
    const repository = new FakeCommandRepository();

    repository.executeError = new Error(
      "Ошибка бизнес-транзакции",
    );
    repository.failurePersistenceError = new Error(
      "Аудит временно недоступен",
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).rejects.toEqual(
      expect.objectContaining({
        code: "COMMAND_RECOVERY_REQUIRED",
        httpStatus: 503,
      }),
    );
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("сохраняет прежний предметный отказ при повторе", async () => {
    const repository = new FakeCommandRepository();

    repository.reservation = {
      state: "replayed",
      executionId: "66666666-6666-4666-8666-666666666666",
      status: "rejected",
      resultStatus: 404,
      result: {
        activeSessionCount: 0,
        revokedSessionCount: 0,
      },
      errorCode: "USER_NOT_FOUND",
    };
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).rejects.toEqual(
      expect.objectContaining({
        code: "USER_NOT_FOUND",
        httpStatus: 404,
      }),
    );
  });

  it("возвращает сохранённый failed без нового исполнения", async () => {
    const repository = new FakeCommandRepository();

    repository.reservation = {
      state: "replayed",
      executionId: "66666666-6666-4666-8666-666666666666",
      status: "failed",
      resultStatus: 500,
      result: {
        completed: false,
      },
      errorCode: "REVOKE_USER_SESSIONS_FAILED",
    };
    const execute = vi.spyOn(
      repository,
      "executeRevokeUserSessions",
    );
    const service = new RevokeUserSessionsService(repository);

    await expect(service.execute(validInput)).rejects.toEqual(
      expect.objectContaining({
        code: "REVOKE_USER_SESSIONS_FAILED",
        httpStatus: 500,
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(repository.failureCode).toBeUndefined();
  });
});

describe("AdministrationError", () => {
  it("сохраняет публичный код команды", () => {
    const error = new AdministrationError(
      "COMMAND_IN_PROGRESS",
      "Операция выполняется.",
      409,
    );

    expect(error.code).toBe("COMMAND_IN_PROGRESS");
  });
});
