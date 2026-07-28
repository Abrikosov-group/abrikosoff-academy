import { afterEach, describe, expect, it, vi } from "vitest";
import { logUnexpectedServerError } from "@/lib/safe-server-log";

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
