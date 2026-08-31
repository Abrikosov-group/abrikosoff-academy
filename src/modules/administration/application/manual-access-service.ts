import { createHash } from "node:crypto";
import { logAdministrationAuditWriteFailure } from "@/lib/safe-server-log";
import type { AccessConfig } from "@/modules/access/server/access-config";
import type {
  AdministrationManualAccessCommandRepository,
  GrantManualAccessCommand,
  RevokeManualAccessCommand,
} from "./administration-command-repository";
import type {
  GrantManualAccessExecution,
  RevokeManualAccessExecution,
} from "./administration-command-repository";
import { AdministrationError } from "../domain/errors";
import type { AdminContext, AdminPermission } from "../domain/types";

export type GrantManualAccessResult = Omit<
  Extract<GrantManualAccessExecution, { state: "succeeded" }>,
  "state"
>;
export type RevokeManualAccessResult = Omit<
  Extract<RevokeManualAccessExecution, { state: "succeeded" }>,
  "state"
>;

export const grantManualAccessAction = "access.manual.grant";
export const revokeManualAccessAction = "access.manual.revoke";
const identityUserTargetType = "identity_user";
const manualGrantTargetType = "access_manual_grant";
const maximumRegularGrantMilliseconds = 31 * 24 * 60 * 60 * 1000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]+$/u;
const explicitIsoPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;

type CommonInput = {
  context: AdminContext;
  targetUserId: string;
  reason: unknown;
  idempotencyKey: unknown;
  userAgentFamily?: string;
};

export type GrantManualAccessInput = CommonInput & {
  periodStart: unknown;
  periodEnd: unknown;
};

export type RevokeManualAccessInput = CommonInput & {
  grantId: string;
};

function invalidRequest(message: string) {
  return new AdministrationError(
    "ADMIN_COMMAND_INVALID_REQUEST",
    message,
    400,
  );
}

function normalizeUuid(value: string, label: string) {
  const normalized = value.toLowerCase();

  if (!uuidPattern.test(normalized)) {
    throw invalidRequest(`Укажите корректный ${label}.`);
  }

  return normalized;
}

function normalizeReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";

  if (
    reason.length < 10 ||
    reason.length > 500 ||
    controlCharacterPattern.test(reason)
  ) {
    throw invalidRequest(
      "Причина должна содержать от 10 до 500 символов без управляющих знаков.",
    );
  }

  return reason;
}

function normalizeIdempotencyKey(value: unknown) {
  const idempotencyKey = typeof value === "string" ? value : "";

  if (
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 64 ||
    !idempotencyKeyPattern.test(idempotencyKey)
  ) {
    throw invalidRequest(
      "Не удалось подтвердить уникальность операции. Обновите страницу.",
    );
  }

  return idempotencyKey;
}

function normalizeTimestamp(value: unknown, label: string) {
  const match =
    typeof value === "string" ? explicitIsoPattern.exec(value) : null;
  if (!match) {
    throw invalidRequest(
      `${label} должно содержать дату и время с часовым поясом.`,
    );
  }
  const [, year, month, day, hour, minute, second, , , offsetHour, offsetMinute] =
    match;
  const numericMonth = Number(month);
  const maximumDay =
    numericMonth >= 1 && numericMonth <= 12
      ? new Date(Date.UTC(Number(year), numericMonth, 0)).getUTCDate()
      : 0;
  if (
    Number(day) < 1 ||
    Number(day) > maximumDay ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offsetHour !== undefined && Number(offsetHour) > 23) ||
    (offsetMinute !== undefined && Number(offsetMinute) > 59)
  ) {
    throw invalidRequest(`${label} содержит некорректную дату.`);
  }

  const date = new Date(value as string);

  if (!Number.isFinite(date.getTime())) {
    throw invalidRequest(`${label} содержит некорректную дату.`);
  }

  return date.toISOString();
}

function requestSha256(value: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function commonCommand(
  input: CommonInput,
  permission: AdminPermission,
) {
  if (!input.context.permissions.has(permission)) {
    throw new AdministrationError(
      "ADMIN_PERMISSION_DENIED",
      "Недостаточно прав для управления ручным доступом.",
      403,
    );
  }

  return {
    principalKey: `user:${input.context.actor.id}`,
    actorUserId: input.context.actor.id,
    actorSessionId: input.context.sessionId,
    actorRoles: input.context.roles,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    requestId: input.context.requestId,
    reason: normalizeReason(input.reason),
    userAgentFamily: input.userAgentFamily,
  };
}

export function normalizeGrantManualAccessInput(
  input: GrantManualAccessInput,
): GrantManualAccessCommand {
  const common = commonCommand(input, "access.manual.grant");
  const customerId = normalizeUuid(
    input.targetUserId,
    "идентификатор ученика",
  );
  const periodStart = normalizeTimestamp(
    input.periodStart,
    "Начало периода",
  );
  const periodEnd = normalizeTimestamp(
    input.periodEnd,
    "Окончание периода",
  );

  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw invalidRequest(
      "Окончание периода должно быть позже начала.",
    );
  }

  if (
    !input.context.permissions.has("access.manual.grant_long") &&
    Date.parse(periodEnd) - Date.parse(periodStart) >
      maximumRegularGrantMilliseconds
  ) {
    throw invalidRequest(
      "Период ручного доступа не должен превышать 31 сутки.",
    );
  }

  const hashInput = {
    action: grantManualAccessAction,
    targetType: identityUserTargetType,
    customerId,
    periodStart,
    periodEnd,
    reason: common.reason,
  };

  return {
    ...common,
    action: grantManualAccessAction,
    requestSha256: requestSha256(hashInput),
    targetType: identityUserTargetType,
    targetId: customerId,
    customerId,
    periodStart,
    periodEnd,
  };
}

export function normalizeRevokeManualAccessInput(
  input: RevokeManualAccessInput,
): RevokeManualAccessCommand {
  const common = commonCommand(input, "access.manual.revoke");
  const customerId = normalizeUuid(
    input.targetUserId,
    "идентификатор ученика",
  );
  const grantId = normalizeUuid(
    input.grantId,
    "идентификатор ручного гранта",
  );
  const hashInput = {
    action: revokeManualAccessAction,
    targetType: manualGrantTargetType,
    customerId,
    grantId,
    reason: common.reason,
  };

  return {
    ...common,
    action: revokeManualAccessAction,
    requestSha256: requestSha256(hashInput),
    targetType: manualGrantTargetType,
    targetId: grantId,
    customerId,
    grantId,
  };
}

function commandStateError(state: "conflict" | "in_progress") {
  return state === "conflict"
    ? new AdministrationError(
        "IDEMPOTENCY_CONFLICT",
        "Этот ключ уже связан с другой командой. Обновите страницу.",
        409,
      )
    : new AdministrationError(
        "COMMAND_IN_PROGRESS",
        "Операция уже выполняется. Повторите попытку позже.",
        409,
      );
}

function terminalCommandError(
  errorCode: string | undefined,
  resultStatus: number,
  failureCode:
    | "GRANT_MANUAL_ACCESS_FAILED"
    | "REVOKE_MANUAL_ACCESS_FAILED" = "GRANT_MANUAL_ACCESS_FAILED",
) {
  const known = {
    ADMIN_COMMAND_INVALID_REQUEST: [
      "Окончание периода должно быть в будущем.",
      400,
    ],
    USER_NOT_FOUND: ["Ученик не найден.", 404],
    MANUAL_ACCESS_GRANTING_DISABLED: [
      "Новая выдача ручного доступа временно выключена.",
      409,
    ],
    MANUAL_ACCESS_GRANTING_REQUIRES_V2: [
      "Выдача ручного доступа доступна только в режиме v2.",
      409,
    ],
    MANUAL_ACCESS_GRANT_NOT_FOUND: ["Ручной грант не найден.", 404],
    MANUAL_ACCESS_GRANT_ALREADY_REVOKED: [
      "Ручной грант уже отозван.",
      409,
    ],
  } as const;
  const match = errorCode ? known[errorCode as keyof typeof known] : undefined;

  return match
    ? new AdministrationError(
        errorCode as keyof typeof known,
        match[0],
        match[1],
      )
    : new AdministrationError(
        resultStatus >= 500
          ? failureCode
          : "ADMIN_COMMAND_INVALID_REQUEST",
        "Не удалось выполнить операцию с ручным доступом.",
        resultStatus >= 500 ? resultStatus : 500,
      );
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isEffectiveAccessDecision(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const decision = value as Record<string, unknown>;
  if (
    !isCanonicalIso(decision.evaluatedAt) ||
    typeof decision.canReadCourses !== "boolean" ||
    !Array.isArray(decision.activeBases)
  ) {
    return false;
  }
  if (
    decision.activePeriod !== null &&
    (!decision.activePeriod ||
      typeof decision.activePeriod !== "object" ||
      Array.isArray(decision.activePeriod) ||
      !isCanonicalIso(
        (decision.activePeriod as Record<string, unknown>).start,
      ) ||
      !isCanonicalIso(
        (decision.activePeriod as Record<string, unknown>).end,
      ))
  ) {
    return false;
  }
  return decision.activeBases.every((basis) => {
    if (!basis || typeof basis !== "object" || Array.isArray(basis)) {
      return false;
    }
    const candidate = basis as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      uuidPattern.test(candidate.id) &&
      (candidate.source === "paid" ||
        candidate.source === "manual" ||
        candidate.source === "grace") &&
      isCanonicalIso(candidate.periodStart) &&
      isCanonicalIso(candidate.periodEnd)
    );
  });
}

function parseStoredResult(
  value: unknown,
  status: "granted",
): GrantManualAccessResult;
function parseStoredResult(
  value: unknown,
  status: "revoked",
): RevokeManualAccessResult;
function parseStoredResult(value: unknown, status: "granted" | "revoked") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "Сохранённый результат команды имеет неверный формат.",
    );
  }

  const candidate = value as Record<string, unknown>;

  if (
    candidate.status !== status ||
    typeof candidate.grantId !== "string" ||
    typeof candidate.customerId !== "string" ||
    !uuidPattern.test(candidate.grantId) ||
    !uuidPattern.test(candidate.customerId) ||
    !isEffectiveAccessDecision(candidate.effectiveAccess) ||
    (status === "granted" &&
      (!isCanonicalIso(candidate.periodStart) ||
        !isCanonicalIso(candidate.periodEnd) ||
        !isCanonicalIso(candidate.grantedAt) ||
        typeof candidate.overlapCount !== "number" ||
        !Number.isInteger(candidate.overlapCount) ||
        candidate.overlapCount < 0)) ||
    (status === "revoked" && !isCanonicalIso(candidate.revokedAt))
  ) {
    throw new TypeError(
      "Сохранённый результат команды имеет неверный формат.",
    );
  }

  return candidate as
    | GrantManualAccessResult
    | RevokeManualAccessResult;
}

async function recordUnexpectedFailure(
  repository: AdministrationManualAccessCommandRepository,
  command: GrantManualAccessCommand | RevokeManualAccessCommand,
  reservation: { executionId: string; attemptCount: number },
  errorCode: "GRANT_MANUAL_ACCESS_FAILED" | "REVOKE_MANUAL_ACCESS_FAILED",
  cause: unknown,
): Promise<never> {
  try {
    if (
      !(await repository.recordFailedInternalCommand(
        command,
        reservation,
        errorCode,
      ))
    ) {
      throw new AdministrationError(
        "COMMAND_ATTEMPT_SUPERSEDED",
        "Результат операции уточняется. Повторите этот же запрос позже.",
        409,
        { cause },
      );
    }
  } catch (persistenceError) {
    if (persistenceError instanceof AdministrationError) {
      throw persistenceError;
    }
    logAdministrationAuditWriteFailure(persistenceError);
    throw new AdministrationError(
      "COMMAND_RECOVERY_REQUIRED",
      "Не удалось подтвердить итог операции. Повторите этот же запрос позже.",
      503,
      { cause },
    );
  }

  throw new AdministrationError(
    errorCode,
    "Не удалось выполнить операцию с ручным доступом. Повторите попытку позже.",
    500,
    { cause },
  );
}

export class GrantManualAccessService {
  constructor(
    private readonly repository: AdministrationManualAccessCommandRepository,
    private readonly config: AccessConfig,
  ) {}

  async execute(
    input: GrantManualAccessInput,
  ): Promise<GrantManualAccessResult> {
    const command = normalizeGrantManualAccessInput(input);
    const inspection = await this.repository.inspectInternalCommand(command);

    if (inspection.state === "conflict" || inspection.state === "in_progress") {
      throw commandStateError(inspection.state);
    }
    if (inspection.state === "replayed") {
      if (inspection.status === "succeeded") {
        return parseStoredResult(inspection.result, "granted");
      }
      throw terminalCommandError(
        inspection.errorCode,
        inspection.resultStatus,
      );
    }

    if (
      inspection.state === "missing" &&
      Date.parse(command.periodEnd) <= Date.now()
    ) {
      throw invalidRequest("Окончание периода должно быть в будущем.");
    }

    const gateError = !this.config.manualAccessGrantingEnabled
      ? "MANUAL_ACCESS_GRANTING_DISABLED"
      : this.config.effectiveAccessMode !== "v2"
        ? "MANUAL_ACCESS_GRANTING_REQUIRES_V2"
        : null;

    if (inspection.state === "missing" && gateError) {
      throw terminalCommandError(gateError, 409);
    }

    const reservation = await this.repository.reserveInternalCommand(command);

    if (reservation.state === "conflict" || reservation.state === "in_progress") {
      throw commandStateError(reservation.state);
    }
    if (reservation.state === "replayed") {
      if (reservation.status === "succeeded") {
        return parseStoredResult(reservation.result, "granted");
      }
      throw terminalCommandError(
        reservation.errorCode,
        reservation.resultStatus,
      );
    }
    if (gateError) {
      await this.repository.rejectManualAccessGrantingGate(
        command,
        reservation,
        gateError,
      );
      throw terminalCommandError(gateError, 409);
    }

    try {
      const result = await this.repository.executeGrantManualAccess(
        command,
        reservation,
      );
      if (result.state === "rejected") {
        throw terminalCommandError(
          result.errorCode,
          result.resultStatus,
        );
      }
      return {
        grantId: result.grantId,
        customerId: result.customerId,
        status: result.status,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        grantedAt: result.grantedAt,
        overlapCount: result.overlapCount,
        effectiveAccess: result.effectiveAccess,
      };
    } catch (error) {
      if (
        error instanceof AdministrationError &&
        (error.code === "USER_NOT_FOUND" ||
          error.code === "ADMIN_COMMAND_INVALID_REQUEST" ||
          error.code === "COMMAND_ATTEMPT_SUPERSEDED")
      ) {
        throw error;
      }
      return recordUnexpectedFailure(
        this.repository,
        command,
        reservation,
        "GRANT_MANUAL_ACCESS_FAILED",
        error,
      );
    }
  }
}

export class RevokeManualAccessService {
  constructor(
    private readonly repository: AdministrationManualAccessCommandRepository,
  ) {}

  async execute(
    input: RevokeManualAccessInput,
  ): Promise<RevokeManualAccessResult> {
    const command = normalizeRevokeManualAccessInput(input);
    const reservation = await this.repository.reserveInternalCommand(command);

    if (reservation.state === "conflict" || reservation.state === "in_progress") {
      throw commandStateError(reservation.state);
    }
    if (reservation.state === "replayed") {
      if (reservation.status === "succeeded") {
        return parseStoredResult(reservation.result, "revoked");
      }
      throw terminalCommandError(
        reservation.errorCode,
        reservation.resultStatus,
        "REVOKE_MANUAL_ACCESS_FAILED",
      );
    }

    try {
      const result = await this.repository.executeRevokeManualAccess(
        command,
        reservation,
      );
      if (result.state === "rejected") {
        throw terminalCommandError(
          result.errorCode,
          result.resultStatus,
          "REVOKE_MANUAL_ACCESS_FAILED",
        );
      }
      return {
        grantId: result.grantId,
        customerId: result.customerId,
        status: result.status,
        revokedAt: result.revokedAt,
        effectiveAccess: result.effectiveAccess,
      };
    } catch (error) {
      if (
        error instanceof AdministrationError &&
        (error.code === "MANUAL_ACCESS_GRANT_NOT_FOUND" ||
          error.code === "MANUAL_ACCESS_GRANT_ALREADY_REVOKED" ||
          error.code === "COMMAND_ATTEMPT_SUPERSEDED")
      ) {
        throw error;
      }
      return recordUnexpectedFailure(
        this.repository,
        command,
        reservation,
        "REVOKE_MANUAL_ACCESS_FAILED",
        error,
      );
    }
  }
}
