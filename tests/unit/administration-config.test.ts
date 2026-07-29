import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";

describe("getAdministrationConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("оставляет Administration выключенной по умолчанию", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "");
    vi.stubEnv("ADMINISTRATION_MODE", "");

    expect(getAdministrationConfig()).toEqual({
      enabled: false,
      mode: "disabled",
    });
  });

  it("разрешает локальную приёмку в полном режиме", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");
    vi.stubEnv("ADMINISTRATION_MODE", "operational");

    expect(getAdministrationConfig()).toEqual({
      enabled: true,
      mode: "operational",
    });
  });

  it.each(["operational", "owner_preview"] as const)(
    "разрешает режим %s на точном dev-origin",
    (mode) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(
        "APP_BASE_URL",
        "https://academy-dev.abrikosoff.com",
      );
      vi.stubEnv("ADMINISTRATION_ENABLED", "true");
      vi.stubEnv("ADMINISTRATION_MODE", mode);

      expect(getAdministrationConfig()).toEqual({
        enabled: true,
        mode,
      });
    },
  );

  it("разрешает на production только явный owner-preview", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy.abrikosoff.com",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");
    vi.stubEnv("ADMINISTRATION_MODE", "owner_preview");

    expect(getAdministrationConfig()).toEqual({
      enabled: true,
      mode: "owner_preview",
    });
  });

  it.each([undefined, "operational"] as const)(
    "не позволяет открыть полный production-режим (%s)",
    (mode) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(
        "APP_BASE_URL",
        "https://academy.abrikosoff.com",
      );
      vi.stubEnv("ADMINISTRATION_ENABLED", "true");

      if (mode) {
        vi.stubEnv("ADMINISTRATION_MODE", mode);
      } else {
        vi.stubEnv("ADMINISTRATION_MODE", "");
      }

      expect(() => getAdministrationConfig()).toThrowError(
        "Режим Administration запрещён для заданного production-origin.",
      );
    },
  );

  it("закрывает owner-preview на неизвестном staging-домене", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy-staging.example.test",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");
    vi.stubEnv("ADMINISTRATION_MODE", "owner_preview");

    expect(() => getAdministrationConfig()).toThrowError(
      "Режим Administration запрещён для заданного production-origin.",
    );
  });

  it("не обходит allowlist сменой протокола production-домена", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "http://academy.abrikosoff.com",
    );
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");
    vi.stubEnv("ADMINISTRATION_MODE", "owner_preview");

    expect(() => getAdministrationConfig()).toThrowError(
      "Режим Administration запрещён для заданного production-origin.",
    );
  });

  it.each([
    ["пустом APP_BASE_URL", ""],
    ["некорректном APP_BASE_URL", "не url"],
    [
      "пути после production-origin",
      "https://academy.abrikosoff.com/admin",
    ],
    [
      "query-параметрах production-origin",
      "https://academy.abrikosoff.com?preview=true",
    ],
    [
      "учётных данных в production-origin",
      "https://user:pass@academy.abrikosoff.com",
    ],
  ])("закрывает Administration при %s", (_caseName, appBaseUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", appBaseUrl);
    vi.stubEnv("ADMINISTRATION_ENABLED", "true");
    vi.stubEnv("ADMINISTRATION_MODE", "owner_preview");

    expect(() => getAdministrationConfig()).toThrowError(
      "Режим Administration запрещён для заданного production-origin.",
    );
  });

  it("отклоняет неизвестное значение release-флага", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "yes");

    expect(() => getAdministrationConfig()).toThrowError(
      "ADMINISTRATION_ENABLED должен быть true или false.",
    );
  });

  it("отклоняет неизвестный режим даже при выключенном гейте", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMINISTRATION_ENABLED", "false");
    vi.stubEnv("ADMINISTRATION_MODE", "preview");

    expect(() => getAdministrationConfig()).toThrowError(
      "ADMINISTRATION_MODE должен быть owner_preview или operational.",
    );
  });
});
