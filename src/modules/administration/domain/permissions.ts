import type {
  AdminPermission,
  AdminRole,
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
    "admin:enter",
    "dashboard:read",
    "users:read",
    "users:write",
    "sessions:revoke",
    "receipt_email:write",
    "access:read",
    "manual_access:grant",
    "manual_access:revoke",
    "billing:read",
    "billing:reconcile",
    "billing:refund",
    "courses:write",
    "courses:publish",
    "audit:read",
    "roles:write",
  ],
  support: [
    "admin:enter",
    "dashboard:read",
    "users:read",
    "sessions:revoke",
    "receipt_email:write",
    "access:read",
    "manual_access:grant",
    "manual_access:revoke",
    "billing:read",
  ],
  content_editor: [
    "admin:enter",
    "dashboard:read",
    "courses:write",
    "courses:publish",
  ],
  finance: [
    "admin:enter",
    "dashboard:read",
    "users:read",
    "access:read",
    "billing:read",
    "billing:reconcile",
    "billing:refund",
  ],
} as const satisfies Record<
  AdminRole,
  readonly AdminPermission[]
>;

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
