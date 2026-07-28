import { describe, expect, it } from "vitest";
import { normalizeAdminRedirectPath } from "@/modules/administration/domain/admin-redirect";

describe("normalizeAdminRedirectPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/users?page=2", "/admin/users?page=2"],
    ["/dashboard", "/admin"],
    ["/admin/verify", "/admin"],
    ["https://example.com/admin", "/admin"],
    ["//example.com/admin", "/admin"],
  ])("нормализует %s в %s", (value, expected) => {
    expect(normalizeAdminRedirectPath(value)).toBe(expected);
  });
});
