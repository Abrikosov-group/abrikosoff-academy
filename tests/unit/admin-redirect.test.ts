import { describe, expect, it } from "vitest";
import {
  isAdminRedirectPath,
  normalizeAdminRedirectPath,
  resolveAdminRedirectPath,
} from "@/modules/administration/domain/admin-redirect";

describe("normalizeAdminRedirectPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/users?page=2", "/admin/users?page=2"],
    ["/dashboard", "/admin"],
    ["/admin/verify", "/admin"],
    ["/admin/%76erify", "/admin"],
    ["/admin/%2576erify", "/admin"],
    ["/admin/../dashboard", "/admin"],
    ["/admin/%2e%2e/dashboard", "/admin"],
    ["/admin/%252e%252e/dashboard", "/admin"],
    [
      "/admin/reports/../users?page=2#selected",
      "/admin/users?page=2#selected",
    ],
    ["https://example.com/admin", "/admin"],
    ["//example.com/admin", "/admin"],
  ])("нормализует %s в %s", (value, expected) => {
    expect(normalizeAdminRedirectPath(value)).toBe(expected);
  });

  it.each([
    ["/admin", true],
    ["/admin/students?q=active", true],
    ["/admin/%73tudents", true],
    ["/admin/verify", false],
    ["/admin/%76erify", false],
    ["/dashboard", false],
    ["https://example.com/admin", false],
  ])(
    "определяет административный маршрут %s как %s",
    (value, expected) => {
      expect(isAdminRedirectPath(value)).toBe(expected);
    },
  );

  it("возвращает канонический маршрут для первоначального административного входа", () => {
    expect(
      resolveAdminRedirectPath(
        "/admin/reports/../%73tudents?q=active",
      ),
    ).toBe("/admin/students?q=active");
    expect(resolveAdminRedirectPath("/dashboard")).toBeNull();
  });
});
