import type {
  AdminPermission,
  AdminRole,
  AdministrationMode,
} from "./types";

export const adminRoles = [
  "owner",
  "support",
  "content_editor",
  "finance",
] as const satisfies readonly AdminRole[];

export const enabledAdminRoles = [
  "owner",
] as const satisfies readonly AdminRole[];

const rolePermissions = {
  owner: [
    "admin.enter",
    "admin.preview",
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

const ownerPreviewPermissions = new Set<AdminPermission>([
  "admin.enter",
  "admin.preview",
]);

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === "string" &&
    adminRoles.includes(value as AdminRole)
  );
}

export function isEnabledAdminRole(
  role: AdminRole,
): role is (typeof enabledAdminRoles)[number] {
  return enabledAdminRoles.includes(
    role as (typeof enabledAdminRoles)[number],
  );
}

export function permissionsForRoles(
  roles: readonly AdminRole[],
): ReadonlySet<AdminPermission> {
  const permissions = new Set<AdminPermission>();

  for (const role of roles) {
    if (!isEnabledAdminRole(role)) {
      continue;
    }

    for (const permission of rolePermissions[role]) {
      permissions.add(permission);
    }
  }

  return permissions;
}

export function effectivePermissionsForRoles(
  roles: readonly AdminRole[],
  mode: AdministrationMode,
): ReadonlySet<AdminPermission> {
  if (mode === "disabled") {
    return new Set<AdminPermission>();
  }

  const configuredPermissions = permissionsForRoles(roles);

  if (mode === "operational") {
    return configuredPermissions;
  }

  return new Set(
    [...configuredPermissions].filter((permission) =>
      ownerPreviewPermissions.has(permission),
    ),
  );
}

export function configuredPermissionsForRole(
  role: AdminRole,
): ReadonlySet<AdminPermission> {
  return new Set(rolePermissions[role]);
}
