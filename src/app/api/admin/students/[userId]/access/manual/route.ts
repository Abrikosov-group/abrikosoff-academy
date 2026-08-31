import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  readJsonBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";
import {
  logSecurityEvent,
  logTechnicalEvent,
  logUnexpectedServerError,
} from "@/lib/safe-server-log";
import { normalizeUserAgentFamily } from "@/lib/user-agent-family";
import { AdministrationError } from "@/modules/administration/domain/errors";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { administrationErrorResponse } from "@/modules/administration/server/http";
import { requireAdministrationRequestOrigin } from "@/modules/administration/server/request-origin";
import {
  clearSessionCookie,
  getCurrentSessionTokenSha256,
} from "@/modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBodyBytes = 8 * 1024;
const securityErrorCodes = new Set([
  "ADMIN_AUTH_REQUIRED",
  "ADMIN_LOGIN_REQUIRED",
  "ADMIN_REAUTH_REQUIRED",
  "ADMIN_ROLE_REQUIRED",
  "ADMIN_PERMISSION_DENIED",
]);
const technicalErrorCodes = new Set([
  "ADMIN_COMMAND_INVALID_REQUEST",
  "IDEMPOTENCY_CONFLICT",
  "COMMAND_IN_PROGRESS",
  "COMMAND_ATTEMPT_SUPERSEDED",
  "COMMAND_RECOVERY_REQUIRED",
  "MANUAL_ACCESS_GRANTING_DISABLED",
  "MANUAL_ACCESS_GRANTING_REQUIRES_V2",
]);

type RouteContext = { params: Promise<{ userId: string }> };
type GrantBody = {
  periodStart?: unknown;
  periodEnd?: unknown;
  reason?: unknown;
};

function invalidRequest(message: string, cause?: unknown) {
  return new AdministrationError(
    "ADMIN_COMMAND_INVALID_REQUEST",
    message,
    400,
    cause === undefined ? undefined : { cause },
  );
}

function validateBody(value: unknown): GrantBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("Некорректные данные операции.");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "periodEnd,periodStart,reason") {
    throw invalidRequest("Запрос содержит неподдерживаемые поля.");
  }
  return value as GrantBody;
}

export async function POST(request: Request, routeContext: RouteContext) {
  const requestId = randomUUID();
  const userAgentFamily = normalizeUserAgentFamily(
    request.headers.get("user-agent"),
  );

  try {
    if (!getAdministrationConfig().enabled) {
      throw new AdministrationError(
        "ADMINISTRATION_DISABLED",
        "Административная панель пока не включена.",
        404,
      );
    }
    requireAdministrationRequestOrigin(request);
    const { service, grantManualAccessService } =
      getAdministrationRuntime();
    const context = await service.getContext({
      tokenSha256: await getCurrentSessionTokenSha256(),
      permission: "access.manual.grant",
      requestId,
    });
    const { userId } = await routeContext.params;
    let parsedBody: unknown;

    try {
      parsedBody = await readJsonBodyWithLimit(
        request,
        maximumBodyBytes,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw new AdministrationError(
          "ADMIN_COMMAND_INVALID_REQUEST",
          "Размер данных операции превышает допустимый.",
          413,
        );
      }
      throw invalidRequest("Некорректные данные операции.", error);
    }

    const body = validateBody(parsedBody);
    const result = await grantManualAccessService.execute({
      context,
      targetUserId: userId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      reason: body.reason,
      idempotencyKey: request.headers.get("Idempotency-Key"),
      userAgentFamily,
    });

    return NextResponse.json(
      { ...result, requestId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AdministrationError) {
      if (securityErrorCodes.has(error.code)) {
        logSecurityEvent("administration.manual_access_grant_rejected", {
          code: error.code,
          requestId,
          userAgentFamily,
        });
      } else if (technicalErrorCodes.has(error.code)) {
        logTechnicalEvent("administration.manual_access_grant_not_executed", {
          code: error.code,
          requestId,
          userAgentFamily,
        });
      } else if (error.code === "GRANT_MANUAL_ACCESS_FAILED") {
        logUnexpectedServerError(
          "administration.manual_access_grant_failed",
          error,
        );
      }
      const response = administrationErrorResponse(error, requestId);
      if (
        error.code === "ADMIN_AUTH_REQUIRED" ||
        error.code === "ADMIN_LOGIN_REQUIRED"
      ) {
        clearSessionCookie(response);
      }
      return response;
    }

    logUnexpectedServerError(
      "administration.manual_access_grant_failed",
      error,
    );
    return Response.json(
      {
        error: {
          code: "GRANT_MANUAL_ACCESS_FAILED",
          message: "Не удалось выдать ручной доступ. Повторите попытку позже.",
        },
        requestId,
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
