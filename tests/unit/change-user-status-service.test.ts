import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminCommandReservation,
  AdministrationUserStatusCommandRepository,
  ChangeUserStatusCommand,
  ChangeUserStatusExecution,
} from "@/modules/administration/application/administration-command-repository";
import {
  blockUserAction,
  ChangeUserStatusService,
  normalizeChangeUserStatusInput,
  unblockUserAction,
  userStatusIdentityTargetType,
} from "@/modules/administration/application/change-user-status-service";
import {
  blockUserReasonOptions,
  unblockUserReasonOptions,
} from "@/modules/administration/domain/user-status-command";
import type { AdminContext } from "@/modules/administration/domain/types";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetUserId =
  "22222222-2222-4222-8222-222222222222";
const actorSessionId =
  "44444444-4444-4444-8444-444444444444";

function adminContext(
  permissions = new Set(["users.status.write"] as const),
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
    sessionId: actorSessionId,
    roles: ["owner"],
    permissions,
    adminVerifiedAt: new Date("2026-07-31T12:00:00.000Z"),
    adminVerificationMethod: "telegram_oidc",
    requestId: "55555555-5555-4555-8555-555555555555",
  };
}

class FakeCommandRepository
  implements AdministrationUserStatusCommandRepository
{
  reservation: AdminCommandReservation = {
    state: "reserved",
    executionId: "66666666-6666-4666-8666-666666666666",
    attemptCount: 1,
  };
  execution: ChangeUserStatusExecution = {
    state: "succeeded",
    previousStatus: "active",
    currentStatus: "blocked",
    statusChanged: true,
    revokedSessionCount: 3,
  };
  executeError?: unknown;
  reservedCommand?: ChangeUserStatusCommand;
  failureCode?: string;
  failureRecorded = true;
  failurePersistenceError?: unknown;

  async reserveInternalCommand(
    command: ChangeUserStatusCommand,
  ) {
    this.reservedCommand = command;
    return this.reservation;
  }

  async executeChangeUserStatus() {
    if (this.executeError) {
      throw this.executeError;
    }

    return this.execution;
  }

  async recordFailedInternalCommand(
    _command: ChangeUserStatusCommand,
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

const validBlockInput = {
  context: adminContext(),
  targetUserId,
  statusAction: "block",
  reason: "  suspected_unauthorized_access  ",
  idempotencyKey: "change-status-0001",
};

describe("ChangeUserStatusService", () => {
  it("использует уникальные обезличенные причины допустимой длины", () => {
    const options = [
      ...blockUserReasonOptions,
      ...unblockUserReasonOptions,
    ];
    const codes = options.map((option) => option.code);
    const reasons = options.map(
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

  it("нормализует блокировку и строит стабильный хэш запроса", () => {
    const first = normalizeChangeUserStatusInput(
      validBlockInput,
    );
    const second = normalizeChangeUserStatusInput({
      ...validBlockInput,
      context: {
        ...validBlockInput.context,
        requestId: "77777777-7777-4777-8777-777777777777",
      },
    });
    const unblocked = normalizeChangeUserStatusInput({
      ...validBlockInput,
      statusAction: "unblock",
      reason: "security_check_completed",
    });

    expect(first).toMatchObject({
      action: blockUserAction,
      principalKey: `user:${actorId}`,
      reason: "Подозрение на посторонний доступ",
      statusAction: "block",
      targetId: targetUserId,
      targetStatus: "blocked",
    });
    expect(first.requestSha256).toBe(second.requestSha256);
    expect(first.requestSha256).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            action: blockUserAction,
            reasonCode: "suspected_unauthorized_access",
            targetType: userStatusIdentityTargetType,
            targetUserId,
          }),
        )
        .digest("hex"),
    );
    expect(unblocked).toMatchObject({
      action: unblockUserAction,
      statusAction: "unblock",
      targetStatus: "active",
    });
    expect(unblocked.requestSha256).not.toBe(
      first.requestSha256,
    );
  });

  it("не принимает команду без users.status.write", () => {
    expect(() =>
      normalizeChangeUserStatusInput({
        ...validBlockInput,
        context: adminContext(new Set()),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ADMIN_PERMISSION_DENIED",
      }),
    );
  });

  it.each([
    ["неизвестное действие", { statusAction: "delete" }],
    [
      "причину разблокировки для блокировки",
      { reason: "security_check_completed" },
    ],
    [
      "произвольную причину с персональными данными",
      { reason: "Ученик student@example.com нарушил правила" },
    ],
    [
      "небезопасный ключ",
      { idempotencyKey: "not safe key 0001" },
    ],
    ["неверный UUID", { targetUserId: "not-a-uuid" }],
  ])("отклоняет %s до резервирования", (_label, change) => {
    expect(() =>
      normalizeChangeUserStatusInput({
        ...validBlockInput,
        ...change,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ADMIN_COMMAND_INVALID_REQUEST",
      }),
    );
  });

  it("возвращает состояние и число отозванных сессий", async () => {
    const repository = new FakeCommandRepository();
    const service = new ChangeUserStatusService(repository);

    await expect(
      service.execute(validBlockInput),
    ).resolves.toEqual({
      status: "blocked",
      statusChanged: true,
      revokedSessionCount: 3,
      currentSessionRevoked: false,
    });
    expect(repository.reservedCommand).toMatchObject({
      actorUserId: actorId,
      targetId: targetUserId,
      reason: "Подозрение на посторонний доступ",
    });
  });

  it("отмечает отзыв текущей сессии актёра", async () => {
    const repository = new FakeCommandRepository();

    repository.execution = {
      state: "succeeded",
      previousStatus: "active",
      currentStatus: "blocked",
      statusChanged: true,
      revokedSessionCount: 1,
      revokedActorSessionId: actorSessionId,
    };
    const service = new ChangeUserStatusService(repository);

    await expect(
      service.execute(validBlockInput),
    ).resolves.toMatchObject({
      currentSessionRevoked: true,
    });
  });

  it("возвращает число старых сессий, отозванных при разблокировке", async () => {
    const repository = new FakeCommandRepository();

    repository.reservation = {
      state: "replayed",
      executionId: "66666666-6666-4666-8666-666666666666",
      status: "succeeded",
      resultStatus: 200,
      result: {
        previousStatus: "blocked",
        currentStatus: "active",
        statusChanged: true,
        revokedSessionCount: 2,
      },
    };
    const service = new ChangeUserStatusService(repository);

    await expect(
      service.execute({
        ...validBlockInput,
        statusAction: "unblock",
        reason: "security_check_completed",
      }),
    ).resolves.toEqual({
      status: "active",
      statusChanged: true,
      revokedSessionCount: 2,
      currentSessionRevoked: false,
    });
  });

  it("возвращает сохранённый результат без нового исполнения", async () => {
    const repository = new FakeCommandRepository();

    repository.reservation = {
      state: "replayed",
      executionId: "66666666-6666-4666-8666-666666666666",
      status: "succeeded",
      resultStatus: 200,
      result: {
        previousStatus: "active",
        currentStatus: "blocked",
        statusChanged: true,
        revokedSessionCount: 2,
      },
    };
    const execute = vi.spyOn(
      repository,
      "executeChangeUserStatus",
    );
    const service = new ChangeUserStatusService(repository);

    await expect(
      service.execute(validBlockInput),
    ).resolves.toEqual({
      status: "blocked",
      statusChanged: true,
      revokedSessionCount: 2,
      currentSessionRevoked: false,
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
      const service = new ChangeUserStatusService(repository);

      await expect(
        service.execute(validBlockInput),
      ).rejects.toEqual(
        expect.objectContaining({
          code: expectedCode,
          httpStatus: 409,
        }),
      );
    },
  );

  it.each([
    ["USER_NOT_FOUND", 404],
    ["USER_STATUS_TRANSITION_INVALID", 409],
    ["LAST_AVAILABLE_OWNER", 409],
  ] as const)(
    "сохраняет предметный отказ %s",
    async (errorCode, resultStatus) => {
      const repository = new FakeCommandRepository();

      repository.execution = {
        state: "rejected",
        errorCode,
        resultStatus,
      };
      const service = new ChangeUserStatusService(repository);

      await expect(
        service.execute(validBlockInput),
      ).rejects.toMatchObject({
        code: errorCode,
        httpStatus: resultStatus,
      });
      expect(repository.failureCode).toBeUndefined();
    },
  );

  it("финализирует непредвиденный сбой безопасным кодом", async () => {
    const repository = new FakeCommandRepository();

    repository.executeError = new Error(
      "секрет не должен попасть в результат",
    );
    const service = new ChangeUserStatusService(repository);

    await expect(
      service.execute(validBlockInput),
    ).rejects.toMatchObject({
      code: "CHANGE_USER_STATUS_FAILED",
      httpStatus: 500,
    });
    expect(repository.failureCode).toBe(
      "CHANGE_USER_STATUS_FAILED",
    );
  });

  it("сохраняет ключ для восстановления при недоступном аудите", async () => {
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
    const service = new ChangeUserStatusService(repository);

    await expect(
      service.execute(validBlockInput),
    ).rejects.toMatchObject({
      code: "COMMAND_RECOVERY_REQUIRED",
      httpStatus: 503,
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        '"event":"administration.audit_write_failed"',
      ),
    );
    consoleError.mockRestore();
  });
});
