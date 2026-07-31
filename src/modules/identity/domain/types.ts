export type IdentityMethodType = "telegram" | "email" | "phone";

export type IdentityUserStatus =
  | "active"
  | "blocked"
  | "deleted";

export type SessionAuthenticationMethod =
  | "telegram_oidc"
  | "email_magic_link"
  | "demo";

export type SessionAdminVerificationMethod = Exclude<
  SessionAuthenticationMethod,
  "demo"
>;

export type SessionDeviceType =
  | "desktop"
  | "mobile"
  | "tablet"
  | "bot"
  | "other";

export type SessionClientContext = {
  ipAddress?: string;
  countryCode?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  timezone?: string;
  userAgentFamily?: string;
  browserVersion?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  deviceType?: SessionDeviceType;
  deviceVendor?: string;
  deviceModel?: string;
  architecture?: string;
  bitness?: string;
  preferredLanguage?: string;
  rawUserAgent?: string;
  cloudflareRayId?: string;
};

export type IdentityMethod = {
  id: string;
  type: IdentityMethodType;
  identifier: string;
  metadata: Record<string, unknown>;
};

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  receiptEmail?: string;
  avatarUrl?: string;
  primaryMethod: IdentityMethod;
};

export type PrivacyConsent = {
  acceptedAt: string;
  documentVersion: string;
  source: string;
};

export type LoginSession = {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
};
