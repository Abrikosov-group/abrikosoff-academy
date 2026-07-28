import type { AuthenticatedUser } from "@/modules/identity/domain/types";

export type AdminRole =
  | "owner"
  | "support"
  | "content_editor"
  | "finance";

export type AdminPermission =
  | "admin:enter"
  | "dashboard:read"
  | "users:read"
  | "users:write"
  | "sessions:revoke"
  | "receipt_email:write"
  | "access:read"
  | "manual_access:grant"
  | "manual_access:revoke"
  | "billing:read"
  | "billing:reconcile"
  | "billing:refund"
  | "courses:write"
  | "courses:publish"
  | "audit:read"
  | "roles:write";

export type AdminVerificationMethod =
  | "telegram_oidc"
  | "email_magic_link"
  | "break_glass";

export type AdminContext = {
  actor: AuthenticatedUser;
  sessionId: string;
  roles: readonly AdminRole[];
  permissions: ReadonlySet<AdminPermission>;
  adminVerifiedAt: Date;
  adminVerificationMethod: AdminVerificationMethod;
  requestId: string;
};

export type AdminSessionRecord = {
  actor: AuthenticatedUser;
  sessionId: string;
  authenticatedAt: Date | null;
  authenticationMethod:
    | "telegram_oidc"
    | "email_magic_link"
    | "demo"
    | null;
  authenticationMethodId: string | null;
  authenticationMethodMatches: boolean;
  adminVerifiedAt: Date | null;
  adminVerificationMethod: AdminVerificationMethod | null;
  adminBreakGlassExpiresAt: Date | null;
  roles: readonly AdminRole[];
};

export type AdminVerificationStart = {
  userId: string;
  sessionId: string;
  alreadyVerified: boolean;
};
