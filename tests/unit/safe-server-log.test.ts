import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logAdministrationAuditWriteFailure,
  logSecurityEvent,
  logTechnicalEvent,
  logUnexpectedServerError,
} from "@/lib/safe-server-log";

describe("logUnexpectedServerError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("пишет безопасные коды протокола без сообщений и секретов", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cause = Object.assign(
      new Error(
        "Token request contains code=secret-code and client_secret=secret",
      ),
      {
        code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
      },
    );
    const error = Object.assign(
      new Error(
        "https://academy.abrikosoff.com/callback?code=secret-code",
        { cause },
      ),
      {
        code: "OAUTH_RESPONSE_BODY_ERROR",
        error: "invalid_grant",
        status: 400,
      },
    );

    logUnexpectedServerError("identity.telegram_callback_failed", error);

    const payload = JSON.parse(
      String(consoleError.mock.calls[0]?.[0]),
    );

    expect(payload).toMatchObject({
      level: "error",
      event: "identity.telegram_callback_failed",
      errorType: "error",
      errorDetails: {
        name: "Error",
        code: "OAUTH_RESPONSE_BODY_ERROR",
        oauthError: "invalid_grant",
        status: 400,
        cause: {
          name: "Error",
          code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
        },
      },
    });
    expect(payload.incidentId).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toContain("secret-code");
    expect(JSON.stringify(payload)).not.toContain("client_secret");
    expect(JSON.stringify(payload)).not.toContain("callback?");
  });

  it("отбрасывает произвольные строки из полей диагностики", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = {
      name: "Error with private data",
      code: "invalid code with spaces",
      error: "token=secret",
      statusCode: 503,
    };

    logUnexpectedServerError("identity.telegram_callback_failed", error);

    const payload = JSON.parse(
      String(consoleError.mock.calls[0]?.[0]),
    );

    expect(payload).toMatchObject({
      errorType: "object",
      errorDetails: {
        status: 503,
      },
    });
    expect(payload.errorDetails).not.toHaveProperty("name");
    expect(payload.errorDetails).not.toHaveProperty("code");
    expect(payload.errorDetails).not.toHaveProperty("oauthError");
  });
});

describe("logSecurityEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("пишет только разрешённые поля события безопасности", () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const requestId = "123e4567-e89b-42d3-a456-426614174000";

    logSecurityEvent("administration.access_rejected", {
      code: "ADMIN_PERMISSION_DENIED",
      requestId: requestId.toUpperCase(),
      userAgentFamily: "Google Chrome",
    });

    const payload = JSON.parse(
      String(consoleWarn.mock.calls[0]?.[0]),
    );

    expect(payload).toMatchObject({
      level: "warn",
      event: "administration.access_rejected",
      code: "ADMIN_PERMISSION_DENIED",
      requestId,
      userAgentFamily: "Google Chrome",
    });
    expect(payload.incidentId).toEqual(expect.any(String));
  });

  it("не переносит произвольные значения в security-log", () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    logSecurityEvent("event with token=secret", {
      code: "code with token=secret",
      requestId: "not-a-request-id?token=secret",
      userAgentFamily: "private-user@example.test",
    });

    const payload = JSON.parse(
      String(consoleWarn.mock.calls[0]?.[0]),
    );
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      event: "security.invalid_event",
      code: "INVALID_SECURITY_CODE",
    });
    expect(payload).not.toHaveProperty("requestId");
    expect(payload).not.toHaveProperty("userAgentFamily");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("private-user");
  });
});

describe("logAdministrationAuditWriteFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("фиксирует сигнал метрики без текста ошибки", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = Object.assign(
      new Error("token=secret-value"),
      {
        code: "POSTGRES_WRITE_FAILED",
      },
    );

    logAdministrationAuditWriteFailure(error);

    const payload = JSON.parse(
      String(consoleError.mock.calls[0]?.[0]),
    );

    expect(payload).toMatchObject({
      event: "administration.audit_write_failed",
      metric: "admin_audit_write_failed_total",
      increment: 1,
      errorDetails: {
        code: "POSTGRES_WRITE_FAILED",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret-value");
  });
});

describe("logTechnicalEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("пишет только безопасные поля технического события", () => {
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const requestId = "123e4567-e89b-42d3-a456-426614174000";

    logTechnicalEvent(
      "administration.revoke_sessions_not_executed",
      {
        code: "IDEMPOTENCY_CONFLICT",
        requestId,
        userAgentFamily: "Google Chrome",
      },
    );

    const payload = JSON.parse(
      String(consoleInfo.mock.calls[0]?.[0]),
    );

    expect(payload).toMatchObject({
      level: "info",
      event:
        "administration.revoke_sessions_not_executed",
      code: "IDEMPOTENCY_CONFLICT",
      requestId,
      userAgentFamily: "Google Chrome",
    });
    expect(payload.incidentId).toEqual(expect.any(String));
  });
});
