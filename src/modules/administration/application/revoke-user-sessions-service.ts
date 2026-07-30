import { createHash } from "node:crypto";
import { logAdministrationAuditWriteFailure } from "@/lib/safe-server-log";
import type { AdministrationCommandRepository } from "./administration-command-repository";
import { AdministrationError } from "../domain/errors";
import {
  canonicalRevokeUserSessionsReason,
  isRevokeUserSessionsReasonCode,
} from "../domain/revoke-user-sessions";
import type { AdminContext } from "../domain/types";

export const revokeUserSessionsAction =
  "identity.sessions.revoke_all";
export const identityUserTargetType = "identity_user";

type RevokeUserSessionsInput = {
  context: AdminContext;
  targetUserId: string;
  reason: unknown;
  idempotencyKey: unknown;
  userAgentFamily?: string;
};

export type RevokeUserSessionsResult = {
  revokedSessionCount: number;
  activeSessionCount: 0;
  currentSessionRevoked: boolean;
};

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

export function normalizeRevokeUserSessionsInput(
  input: RevokeUserSessionsInput,
) {
  if (!input.context.permissions.has("sessions.revoke")) {
    throw new AdministrationError(
      "ADMIN_PERMISSION_DENIED",
      "Недостаточно прав для отзыва сессий.",
      403,
    );
  }

  const targetUserId = input.targetUserId.toLowerCase();

  if (!uuidPattern.test(targetUserId)) {
    throw invalidRequest(
      "Укажите корректный идентификатор ученика.",
    );
  }

  const reasonCode =
    typeof input.reason === "string" ? input.reason.trim() : "";

  if (!isRevokeUserSessionsReasonCode(reasonCode)) {
    throw invalidRequest(
      "Выберите допустимую обезличенную причину отзыва.",
    );
  }
  const reason =
    canonicalRevokeUserSessionsReason(reasonCode);

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

  return {
    principalKey: `user:${input.context.actor.id}`,
    actorUserId: input.context.actor.id,
    actorSessionId: input.context.sessionId,
    actorRoles: input.context.roles,
    action: revokeUserSessionsAction,
    idempotencyKey,
    requestId: input.context.requestId,
    requestSha256: createHash("sha256")
      .update(
        JSON.stringify({
          action: revokeUserSessionsAction,
          reasonCode,
          targetType: identityUserTargetType,
          targetUserId,
        }),
      )
      .digest("hex"),
    targetType: identityUserTargetType,
    targetId: targetUserId,
    reason,
    userAgentFamily: input.userAgentFamily,
  };
}

function resultFromStoredValue(value: unknown) {
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
    activeSessionCount?: unknown;
    revokedActorSessionId?: unknown;
    revokedSessionCount?: unknown;
  };

  if (
    candidate.activeSessionCount !== 0 ||
    typeof candidate.revokedSessionCount !== "number" ||
    !Number.isSafeInteger(candidate.revokedSessionCount) ||
    candidate.revokedSessionCount < 0 ||
    (candidate.revokedActorSessionId !== undefined &&
      (typeof candidate.revokedActorSessionId !== "string" ||
        !uuidPattern.test(candidate.revokedActorSessionId)))
  ) {
    throw new TypeError(
      "Сохранённый результат команды имеет неверный формат.",
    );
  }

  return {
    activeSessionCount: 0,
    revokedActorSessionId:
      candidate.revokedActorSessionId as string | undefined,
    revokedSessionCount: candidate.revokedSessionCount,
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

  return new AdministrationError(
    "REVOKE_USER_SESSIONS_FAILED",
    "Не удалось отозвать сессии. Повторите попытку позже.",
    resultStatus >= 500 ? resultStatus : 500,
  );
}

export class RevokeUserSessionsService {
  constructor(
    private readonly repository: AdministrationCommandRepository,
  ) {}

  async execute(
    input: RevokeUserSessionsInput,
  ): Promise<RevokeUserSessionsResult> {
    const command = normalizeRevokeUserSessionsInput(input);
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
        "Отзыв сессий уже выполняется. Повторите попытку позже.",
        409,
      );
    }

    if (reservation.state === "replayed") {
      if (reservation.status === "succeeded") {
        const storedResult = resultFromStoredValue(
          reservation.result,
        );

        return {
          activeSessionCount: 0,
          currentSessionRevoked:
            storedResult.revokedActorSessionId ===
            input.context.sessionId,
          revokedSessionCount:
            storedResult.revokedSessionCount,
        };
      }

      throw terminalCommandError(
        reservation.errorCode,
        reservation.resultStatus,
      );
    }

    try {
      const execution =
        await this.repository.executeRevokeUserSessions(
          command,
          reservation,
        );

      if (execution.state === "rejected") {
        throw terminalCommandError(
          execution.errorCode,
          execution.resultStatus,
        );
      }

      return {
        activeSessionCount: 0,
        currentSessionRevoked:
          execution.revokedActorSessionId ===
          input.context.sessionId,
        revokedSessionCount: execution.revokedSessionCount,
      };
    } catch (error) {
      if (
        error instanceof AdministrationError &&
        (error.code === "USER_NOT_FOUND" ||
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
            "REVOKE_USER_SESSIONS_FAILED",
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
        "REVOKE_USER_SESSIONS_FAILED",
        "Не удалось отозвать сессии. Повторите попытку позже.",
        500,
        { cause: error },
      );
    }
  }
}
