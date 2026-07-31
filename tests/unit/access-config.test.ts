import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessConfig } from "@/modules/access/server/access-config";

describe("конфигурация эффективного доступа", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("по умолчанию включает безопасный shadow без выдачи грантов", () => {
    vi.stubEnv("EFFECTIVE_ACCESS_MODE", "");
    vi.stubEnv("MANUAL_ACCESS_GRANTING_ENABLED", "");

    expect(getAccessConfig()).toEqual({
      effectiveAccessMode: "shadow",
      manualAccessGrantingEnabled: false,
    });
  });

  it.each([
    "legacy",
    "shadow",
    "v2",
    "legacy_paid_plus_manual",
  ] as const)("принимает закрытый режим %s", (mode) => {
    vi.stubEnv("EFFECTIVE_ACCESS_MODE", mode);
    vi.stubEnv("MANUAL_ACCESS_GRANTING_ENABLED", "false");

    expect(getAccessConfig()).toEqual({
      effectiveAccessMode: mode,
      manualAccessGrantingEnabled: false,
    });
  });

  it("отклоняет неизвестный режим", () => {
    vi.stubEnv("EFFECTIVE_ACCESS_MODE", "combined");

    expect(() => getAccessConfig()).toThrowError(
      "EFFECTIVE_ACCESS_MODE должен быть legacy, shadow, v2 или legacy_paid_plus_manual.",
    );
  });

  it("отклоняет неоднозначное значение флага выдачи", () => {
    vi.stubEnv("MANUAL_ACCESS_GRANTING_ENABLED", "yes");

    expect(() => getAccessConfig()).toThrowError(
      "MANUAL_ACCESS_GRANTING_ENABLED должен быть true или false.",
    );
  });

  it("читает явное включение выдачи без неявного переключения режима", () => {
    vi.stubEnv("EFFECTIVE_ACCESS_MODE", "v2");
    vi.stubEnv("MANUAL_ACCESS_GRANTING_ENABLED", "true");

    expect(getAccessConfig()).toEqual({
      effectiveAccessMode: "v2",
      manualAccessGrantingEnabled: true,
    });
  });
});
