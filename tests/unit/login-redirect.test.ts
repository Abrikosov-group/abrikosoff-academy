import { describe, expect, it } from "vitest";
import {
  checkoutRedirectPath,
  defaultLoginRedirectPath,
  loginPathFor,
  normalizeLoginRedirectPath,
} from "@/modules/identity/domain/login-redirect";

describe("маршрут после входа", () => {
  it("оставляет безопасный внутренний маршрут", () => {
    expect(
      normalizeLoginRedirectPath(
        "/courses/healthy-habits/lessons/1?from=catalog#lesson",
      ),
    ).toBe(
      "/courses/healthy-habits/lessons/1?from=catalog#lesson",
    );
  });

  it.each([
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/api/auth/logout",
    "/login",
    "",
    undefined,
  ])("заменяет небезопасный маршрут %s кабинетом", (value) => {
    expect(normalizeLoginRedirectPath(value)).toBe(
      defaultLoginRedirectPath,
    );
  });

  it("строит явный маршрут покупки для выбранного тарифа", () => {
    expect(checkoutRedirectPath("monthly")).toBe(
      "/checkout?plan=monthly",
    );
    expect(checkoutRedirectPath("annual")).toBe(
      "/checkout?plan=annual",
    );
  });

  it("безопасно передаёт исходный защищённый маршрут на страницу входа", () => {
    expect(loginPathFor("/courses/healthy-habits/lessons/1")).toBe(
      "/login?next=%2Fcourses%2Fhealthy-habits%2Flessons%2F1",
    );
  });
});
