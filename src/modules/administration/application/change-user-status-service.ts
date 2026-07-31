import { createHash } from "node:crypto";
import { logAdministrationAuditWriteFailure } from "@/lib/safe-server-log";
import type {
  AdministrationUserStatusCommandRepository,
  ChangeUserStatusCommand,
  ChangeUserStatusExecution,
} from "./administration-command-repository";
import { AdministrationError } from "../domain/errors";
import {
  canonicalUserStatusReason,
  isUserStatusCommandAction,
  isUserStatusReasonCode,
  targetStatusForUserStatusAction,
} from "../domain/user-status-command";
import type {
  UserStatusCommandAction,
  UserStatusReasonCode,
} from "../domain/user-status-command";
import type { AdminContext } from "../domain/types";

export const blockUserAction = "identity.user.block";
export const unblockUserAction = "identity.user.unblock";
export const userStatusIdentityTargetType = "identity_user";

type ChangeUserStatusInput = {
  context: AdminContext;
  targetUserId: string;
  statusAction: unknown;
  reason: unknown;
  idempotencyKey: unknown;
  userAgentFamily?: string;
};

export type ChangeUserStatusResult = {
  status: "active" | "blocked";
  statusChanged: boolean;
  revokedSessionCount: number;
  currentSessionRevoked: boolean;
};

type SuccessfulUserStatusResult = Extract<
  ChangeUserStatusExecution,
  { state: "succeeded" }
>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]+$/u;

function invalidRequest(message: string) {
  return new AdministrationError(
    "ADMIN_COMMAND_INVALID_REQUEST",
    message,
    400,
  );
}

function commandAction(statusAction: UserStatusCommandAction) {
  return statusAction === "block"
    ? blockUserAction
    : unblockUserAction;
}

export function normalizeChangeUserStatusInput(
  input: ChangeUserStatusInput,
): ChangeUserStatusCommand {
  if (!input.context.permissions.has("users.status.write")) {
    throw new AdministrationError(
      "ADMIN_PERMISSION_DENIED",
      "Недостаточно прав для изменения состояния ученика.",
      403,
    );
  }

  const targetUserId = input.targetUserId.toLowerCase();

  if (!uuidPattern.test(targetUserId)) {
    throw invalidRequest(
      "Укажите корректный идентификатор ученика.",
    );
  }

  if (!isUserStatusCommandAction(input.statusAction)) {
    throw invalidRequest(
      "Выберите допустимое действие с учётной записью.",
    );
  }

  const statusAction = input.statusAction;
  const reasonCode =
    typeof input.reason === "string" ? input.reason.trim() : "";

  if (!isUserStatusReasonCode(statusAction, reasonCode)) {
    throw invalidRequest(
      "Выберите допустимую обезличенную причину изменения.",
    );
  }

  const idempotencyKey =
    typeof input.idempotencyKey === "string"
      ? input.idempotencyKey
      : "";

  if (
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 64 ||
    !idempotencyKeyPattern.test(idempotencyKey)
  ) {
    throw invalidRequest(
      "Не удалось подтвердить уникальность операции. Обновите страницу.",
    );
  }

  const action = commandAction(statusAction);
  const targetStatus =
    targetStatusForUserStatusAction(statusAction);

  return {
    principalKey: `user:${input.context.actor.id}`,
    actorUserId: input.context.actor.id,
    actorSessionId: input.context.sessionId,
    actorRoles: input.context.roles,
    action,
    idempotencyKey,
    requestId: input.context.requestId,
    requestSha256: createHash("sha256")
      .update(
        JSON.stringify({
          action,
          reasonCode,
          targetType: userStatusIdentityTargetType,
          targetUserId,
        }),
      )
      .digest("hex"),
    targetType: userStatusIdentityTargetType,
    targetId: targetUserId,
    reason: canonicalUserStatusReason(
      statusAction,
      reasonCode as UserStatusReasonCode,
    ),
    statusAction,
    targetStatus,
    userAgentFamily: input.userAgentFamily,
  };
}

function resultFromStoredValue(
  value: unknown,
  expectedStatus: "active" | "blocked",
): SuccessfulUserStatusResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "Сохранённый результат команды имеет неверный формат.",
    );
  }

  const candidate = value as {
    currentStatus?: unknown;
    previousStatus?: unknown;
    revokedActorSessionId?: unknown;
    revokedSessionCount?: unknown;
    statusChanged?: unknown;
  };

  if (
    candidate.currentStatus !== expectedStatus ||
    (candidate.previousStatus !== "active" &&
      candidate.previousStatus !== "blocked") ||
    typeof candidate.statusChanged !== "boolean" ||
    typeof candidate.revokedSessionCount !== "number" ||
    !Number.isSafeInteger(candidate.revokedSessionCount) ||
    candidate.revokedSessionCount < 0 ||
    candidate.statusChanged !==
      (candidate.previousStatus !== candidate.currentStatus) ||
    (expectedStatus === "active" &&
      candidate.revokedActorSessionId !== undefined) ||
    (candidate.revokedActorSessionId !== undefined &&
      (typeof candidate.revokedActorSessionId !== "string" ||
        !uuidPattern.test(candidate.revokedActorSessionId)))
  ) {
    throw new TypeError(
      "Сохранённый результат команды имеет неверный формат.",
    );
  }

  return {
    state: "succeeded",
    currentStatus: candidate.currentStatus as
      | "active"
      | "blocked",
    previousStatus: candidate.previousStatus as
      | "active"
      | "blocked",
    revokedActorSessionId:
      candidate.revokedActorSessionId as string | undefined,
    revokedSessionCount: candidate.revokedSessionCount,
    statusChanged: candidate.statusChanged,
  };
}

function terminalCommandError(
  errorCode: string | undefined,
  resultStatus: number,
) {
  if (errorCode === "USER_NOT_FOUND") {
    return new AdministrationError(
      "USER_NOT_FOUND",
      "Ученик не найден.",
      404,
    );
  }

  if (errorCode === "USER_STATUS_TRANSITION_INVALID") {
    return new AdministrationError(
      "USER_STATUS_TRANSITION_INVALID",
      "Состояние этой учётной записи нельзя изменить.",
      409,
    );
  }

  if (errorCode === "LAST_AVAILABLE_OWNER") {
    return new AdministrationError(
      "LAST_AVAILABLE_OWNER",
      "Последнего доступного владельца нельзя заблокировать.",
      409,
    );
  }

  return new AdministrationError(
    "CHANGE_USER_STATUS_FAILED",
    "Не удалось изменить состояние ученика. Повторите попытку позже.",
    resultStatus >= 500 ? resultStatus : 500,
  );
}

function resultForClient(
  result: SuccessfulUserStatusResult,
  actorSessionId: string,
): ChangeUserStatusResult {
  return {
    status: result.currentStatus,
    statusChanged: result.statusChanged,
    revokedSessionCount: result.revokedSessionCount,
    currentSessionRevoked:
      result.revokedActorSessionId === actorSessionId,
  };
}

export class ChangeUserStatusService {
  constructor(
    private readonly repository: AdministrationUserStatusCommandRepository,
  ) {}

  async execute(
    input: ChangeUserStatusInput,
  ): Promise<ChangeUserStatusResult> {
    const command = normalizeChangeUserStatusInput(input);
    const reservation =
      await this.repository.reserveInternalCommand(command);

    if (reservation.state === "conflict") {
      throw new AdministrationError(
        "IDEMPOTENCY_CONFLICT",
        "Этот ключ уже связан с другой командой. Обновите страницу.",
        409,
      );
    }

    if (reservation.state === "in_progress") {
      throw new AdministrationError(
        "COMMAND_IN_PROGRESS",
        "Изменение состояния уже выполняется. Повторите попытку позже.",
        409,
      );
    }

    if (reservation.state === "replayed") {
      if (reservation.status === "succeeded") {
        return resultForClient(
          resultFromStoredValue(
            reservation.result,
            command.targetStatus,
          ),
          input.context.sessionId,
        );
      }

      throw terminalCommandError(
        reservation.errorCode,
        reservation.resultStatus,
      );
    }

    try {
      const execution =
        await this.repository.executeChangeUserStatus(
          command,
          reservation,
        );

      if (execution.state === "rejected") {
        throw terminalCommandError(
          execution.errorCode,
          execution.resultStatus,
        );
      }

      return resultForClient(
        execution,
        input.context.sessionId,
      );
    } catch (error) {
      if (
        error instanceof AdministrationError &&
        (error.code === "USER_NOT_FOUND" ||
          error.code === "USER_STATUS_TRANSITION_INVALID" ||
          error.code === "LAST_AVAILABLE_OWNER" ||
          error.code === "COMMAND_ATTEMPT_SUPERSEDED")
      ) {
        throw error;
      }

      let failureRecorded: boolean;

      try {
        failureRecorded =
          await this.repository.recordFailedInternalCommand(
            command,
            reservation,
            "CHANGE_USER_STATUS_FAILED",
          );
      } catch (persistenceError) {
        logAdministrationAuditWriteFailure(persistenceError);
        throw new AdministrationError(
          "COMMAND_RECOVERY_REQUIRED",
          "Не удалось подтвердить итог операции. Повторите этот же запрос позже.",
          503,
          { cause: error },
        );
      }

      if (!failureRecorded) {
        throw new AdministrationError(
          "COMMAND_ATTEMPT_SUPERSEDED",
          "Результат операции уточняется. Повторите этот же запрос позже.",
          409,
          { cause: error },
        );
      }

      throw new AdministrationError(
        "CHANGE_USER_STATUS_FAILED",
        "Не удалось изменить состояние ученика. Повторите попытку позже.",
        500,
        { cause: error },
      );
    }
  }
}
