import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reportEffectiveAccessShadowEvaluationFailure,
  reportEffectiveAccessShadowMismatch,
} from "@/modules/access/server/effective-access-observability";

describe("наблюдаемость shadow-доступа", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("увеличивает метрику только с безопасным кодом несовпадения", () => {
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    reportEffectiveAccessShadowMismatch(
      "EFFECTIVE_ACCESS_V2_ONLY",
    );

    const payload = JSON.parse(
      String(consoleInfo.mock.calls[0]?.[0]),
    );

    expect(payload).toEqual({
      level: "info",
      event: "access.effective_access_shadow_mismatch",
      metric: "effective_access_shadow_mismatch_total",
      increment: 1,
      code: "EFFECTIVE_ACCESS_V2_ONLY",
    });
  });

  it("не переносит сообщение ошибки нового чтения в технический лог", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = Object.assign(
      new Error(
        "student=private-user@example.test token=secret-value",
      ),
      { code: "POSTGRES_READ_FAILED" },
    );

    reportEffectiveAccessShadowEvaluationFailure(error);

    const payload = JSON.parse(
      String(consoleError.mock.calls[0]?.[0]),
    );
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      level: "error",
      event: "access.effective_access_shadow_evaluation_failed",
      incidentId: expect.any(String),
      errorType: "error",
      errorDetails: {
        name: "Error",
        code: "POSTGRES_READ_FAILED",
      },
    });
    expect(payload).not.toHaveProperty("userId");
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("secret-value");
  });
});
