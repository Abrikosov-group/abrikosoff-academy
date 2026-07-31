import type {
  AuthenticatedUser,
  IdentityMethodType,
  PrivacyConsent,
  SessionAdminVerificationMethod,
  SessionClientContext,
  SessionAuthenticationMethod,
} from "../domain/types";

export type UpsertIdentityInput = {
  methodType: IdentityMethodType;
  identifier: string;
  displayName: string;
  receiptEmail?: string;
  metadata: Record<string, unknown>;
  consent: PrivacyConsent;
};

export type CreateLoginChallengeInput = {
  methodType: "email" | "phone";
  identifier: string;
  tokenSha256: string;
  displayName: string;
  redirectPath: string;
  consent: PrivacyConsent;
  expiresAt: Date;
};

export type ConsumedLoginChallenge = {
  methodType: "email" | "phone";
  identifier: string;
  displayName: string;
  redirectPath: string;
  consent: PrivacyConsent;
};

export interface IdentityRepository {
  upsertIdentity(input: UpsertIdentityInput): Promise<AuthenticatedUser>;

  createSession(input: {
    userId: string;
    tokenSha256: string;
    expiresAt: Date;
    authenticatedAt: Date;
    authenticationMethod: SessionAuthenticationMethod;
    authenticationMethodId: string;
    adminVerificationMethod?: SessionAdminVerificationMethod;
    clientContext?: SessionClientContext;
  }): Promise<boolean>;

  findUserBySessionTokenSha256(
    tokenSha256: string,
  ): Promise<AuthenticatedUser | null>;

  revokeSession(tokenSha256: string): Promise<void>;

  createLoginChallenge(input: CreateLoginChallengeInput): Promise<void>;

  consumeLoginChallenge(
    tokenSha256: string,
  ): Promise<ConsumedLoginChallenge | null>;
}
