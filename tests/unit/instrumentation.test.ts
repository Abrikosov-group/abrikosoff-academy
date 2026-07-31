import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validateEffectiveAccessConfigurationMock } = vi.hoisted(() => ({
  validateEffectiveAccessConfigurationMock: vi.fn(),
}));

vi.mock(
  "@/modules/access/server/get-effective-access",
  () => ({
    validateEffectiveAccessConfiguration:
      validateEffectiveAccessConfigurationMock,
  }),
);

import { register } from "@/instrumentation";

describe("серверная инициализация Next.js", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("проверяет конфигурацию эффективного доступа до готовности Node.js-сервера", async () => {
    validateEffectiveAccessConfigurationMock.mockResolvedValue(undefined);

    await register();

    expect(
      validateEffectiveAccessConfigurationMock,
    ).toHaveBeenCalledOnce();
  });

  it("не скрывает ошибку startup-проверки", async () => {
    const configurationError = new TypeError(
      "Запрещённая конфигурация эффективного доступа",
    );
    validateEffectiveAccessConfigurationMock.mockRejectedValue(
      configurationError,
    );

    await expect(register()).rejects.toBe(configurationError);
  });

  it("завершает процесс после ошибки startup-проверки", async () => {
    const configurationError = new TypeError(
      "Запрещённая конфигурация эффективного доступа",
    );
    const exitMock = vi
      .spyOn(process, "exit")
      .mockImplementation(
        (() => undefined) as typeof process.exit,
      );
    vi.useFakeTimers();
    validateEffectiveAccessConfigurationMock.mockRejectedValue(
      configurationError,
    );

    await expect(register()).rejects.toBe(configurationError);
    await vi.runAllTimersAsync();

    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("не загружает Node.js-валидатор в Edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(
      validateEffectiveAccessConfigurationMock,
    ).not.toHaveBeenCalled();
  });
});
