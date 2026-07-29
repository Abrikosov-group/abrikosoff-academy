import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdministrationConfigMock,
  hasDatabaseConfigurationMock,
  logUnexpectedServerErrorMock,
  queryMock,
} = vi.hoisted(() => ({
  getAdministrationConfigMock: vi.fn(),
  hasDatabaseConfigurationMock: vi.fn(),
  logUnexpectedServerErrorMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@/lib/database", () => ({
  getDatabasePool: () => ({
    query: queryMock,
  }),
  hasDatabaseConfiguration: hasDatabaseConfigurationMock,
}));

vi.mock("@/lib/safe-server-log", () => ({
  logUnexpectedServerError: logUnexpectedServerErrorMock,
}));

vi.mock(
  "@/modules/administration/server/administration-config",
  () => ({
    getAdministrationConfig: getAdministrationConfigMock,
  }),
);

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_VERSION", "health-test");
    getAdministrationConfigMock.mockReturnValue({ enabled: false });
    hasDatabaseConfigurationMock.mockReturnValue(true);
    queryMock.mockResolvedValue({ rows: [{ result: 1 }] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("возвращает независимые успешные состояния зависимостей", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      version: "health-test",
      administration: "ok",
      database: "ok",
    });
    expect(queryMock).toHaveBeenCalledWith("SELECT 1");
    expect(logUnexpectedServerErrorMock).not.toHaveBeenCalled();
  });

  it("не обозначает исправную базу недоступной при ошибке Administration", async () => {
    const configurationError = new TypeError(
      "Некорректная конфигурация Administration",
    );
    getAdministrationConfigMock.mockImplementation(() => {
      throw configurationError;
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      administration: "unavailable",
      database: "ok",
    });
    expect(queryMock).toHaveBeenCalledWith("SELECT 1");
    expect(logUnexpectedServerErrorMock).toHaveBeenCalledWith(
      "health.administration_unavailable",
      configurationError,
    );
  });

  it("отдельно сообщает об ошибке PostgreSQL", async () => {
    const databaseError = new Error("PostgreSQL недоступен");
    queryMock.mockRejectedValue(databaseError);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      administration: "ok",
      database: "unavailable",
    });
    expect(logUnexpectedServerErrorMock).toHaveBeenCalledWith(
      "health.database_unavailable",
      databaseError,
    );
  });

  it("разрешает локальный запуск без настроенной базы", async () => {
    vi.stubEnv("NODE_ENV", "development");
    hasDatabaseConfigurationMock.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      administration: "ok",
      database: "not-configured",
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("отклоняет production-запуск без настроенной базы", async () => {
    hasDatabaseConfigurationMock.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      administration: "ok",
      database: "unavailable",
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(logUnexpectedServerErrorMock).toHaveBeenCalledWith(
      "health.database_unavailable",
      expect.any(Error),
    );
  });
});
