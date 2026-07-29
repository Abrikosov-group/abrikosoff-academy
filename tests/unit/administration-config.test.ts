import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";

describe("getAdministrationConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("оставляет Administration выключенной по умолчанию", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "");

    expect(getAdministrationConfig()).toEqual({ enabled: false });
  });

  it("разрешает локальную приёмку защитного фундамента", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");

    expect(getAdministrationConfig()).toEqual({ enabled: true });
  });

  it("разрешает production-подобную приёмку на точном dev-origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy-dev.abrikosoff.com",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");

    expect(getAdministrationConfig()).toEqual({ enabled: true });
  });

  it("не позволяет открыть production до следующего этапа", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy.abrikosoff.com",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");

    expect(() => getAdministrationConfig()).toThrowError(
      "Production-доступ к Administration откроется после приёмки этапа 2.",
    );
  });

  it("закрывает Administration на неизвестном staging-домене", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy-staging.example.test",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");

    expect(() => getAdministrationConfig()).toThrowError(
      "Production-доступ к Administration откроется после приёмки этапа 2.",
    );
  });

  it("не обходит allowlist сменой протокола dev-домена", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "http://academy-dev.abrikosoff.com",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");

    expect(() => getAdministrationConfig()).toThrowError(
      "Production-доступ к Administration откроется после приёмки этапа 2.",
    );
  });

  it.each([
    ["пустом APP_BASE_URL", ""],
    ["некорректном APP_BASE_URL", "не url"],
  ])("закрывает Administration при %s", (_caseName, appBaseUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", appBaseUrl);
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");

    expect(() => getAdministrationConfig()).toThrowError(
      "Production-доступ к Administration откроется после приёмки этапа 2.",
    );
  });

  it("отклоняет неизвестное значение release-флага", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "yes");

    expect(() => getAdministrationConfig()).toThrowError(
      "ADMINISTRATION_ENABLED должен быть true или false.",
    );
  });
});
