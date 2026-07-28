import { createHash, randomBytes } from "node:crypto";
import { IdentityError } from "../domain/errors";
import type {
  LoginSession,
  PrivacyConsent,
} from "../domain/types";
import type {
  IdentityRepository,
  UpsertIdentityInput,
} from "./identity-repository";

const loginChallengeTtlMinutes = 15;

export function hashIdentityToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly sessionTtlDays: number,
  ) {}

  async authenticateIdentity(
    input: UpsertIdentityInput,
  ): Promise<LoginSession> {
    const user = await this.repository.upsertIdentity(input);
    const token = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1_000,
    );

    await this.repository.createSession({
      userId: user.id,
      tokenSha256: hashIdentityToken(token),
      expiresAt,
    });

    return {
      token,
      expiresAt,
      user,
    };
  }

  async requestEmailLogin(input: {
    email: string;
    displayName: string;
    redirectPath: string;
    consent: PrivacyConsent;
  }) {
    const token = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + loginChallengeTtlMinutes * 60 * 1_000,
    );

    await this.repository.createLoginChallenge({
      methodType: "email",
      identifier: input.email,
      tokenSha256: hashIdentityToken(token),
      displayName: input.displayName,
      redirectPath: input.redirectPath,
      consent: input.consent,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async verifyEmailLogin(token: string) {
    const challenge = await this.repository.consumeLoginChallenge(
      hashIdentityToken(token),
    );

    if (!challenge || challenge.methodType !== "email") {
      throw new IdentityError(
        "LOGIN_EXPIRED",
        "Ссылка для входа недействительна или уже использована.",
        400,
      );
    }

    const session = await this.authenticateIdentity({
      methodType: "email",
      identifier: challenge.identifier,
      displayName: challenge.displayName,
      receiptEmail: challenge.identifier,
      metadata: {},
      consent: challenge.consent,
    });

    return {
      session,
      redirectPath: challenge.redirectPath,
    };
  }
}
