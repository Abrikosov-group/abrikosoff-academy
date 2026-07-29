import { describe, expect, it } from "vitest";
import {
  configuredPermissionsForRole,
  permissionsForRoles,
} from "@/modules/administration/domain/permissions";
import type {
  AdminPermission,
  AdminRole,
} from "@/modules/administration/domain/types";

const expectedPermissions = {
  owner: [
    "admin.enter",
    "dashboard.read",
    "users.read",
    "users.read_payment_context",
    "users.status.write",
    "users.receipt_contact.write",
    "sessions.revoke",
    "access.read",
    "access.read_related",
    "access.manual.grant",
    "access.manual.grant_long",
    "access.manual.revoke",
    "billing.read_related",
    "billing.read",
    "billing.reconcile",
    "billing.refund",
    "courses.read",
    "courses.draft.write",
    "courses.publish",
    "audit.read",
    "roles.read",
    "roles.write",
  ],
  support: [
    "admin.enter",
    "dashboard.read",
    "users.read",
    "users.receipt_contact.write",
    "sessions.revoke",
    "access.read",
    "access.manual.grant",
    "access.manual.revoke",
    "billing.read_related",
  ],
  content_editor: [
    "admin.enter",
    "dashboard.read",
    "courses.read",
    "courses.draft.write",
    "courses.publish",
  ],
  finance: [
    "admin.enter",
    "dashboard.read",
    "users.read_payment_context",
    "access.read_related",
    "billing.read",
    "billing.reconcile",
    "billing.refund",
  ],
} as const satisfies Record<
  AdminRole,
  readonly AdminPermission[]
>;

describe("матрица разрешений Administration", () => {
  it.each(
    Object.entries(expectedPermissions) as [
      AdminRole,
      readonly AdminPermission[],
    ][],
  )("точно соответствует спецификации для роли %s", (role, expected) => {
    expect([...configuredPermissionsForRole(role)]).toEqual(expected);
  });

  it("выдаёт права только включённой роли owner", () => {
    expect([...permissionsForRoles(["owner"])]).toEqual(
      expectedPermissions.owner,
    );

    for (const role of [
      "support",
      "content_editor",
      "finance",
    ] as const) {
      expect([...permissionsForRoles([role])]).toEqual([]);
    }
  });
});
