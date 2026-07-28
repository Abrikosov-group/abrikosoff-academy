export type IdentityMethodType = "telegram" | "email" | "phone";

export type IdentityMethod = {
  type: IdentityMethodType;
  identifier: string;
  metadata: Record<string, unknown>;
};

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  receiptEmail?: string;
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
