import { describe, expect, it } from "vitest";
import { normalizeAdminRedirectPath } from "@/modules/administration/domain/admin-redirect";

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
});
