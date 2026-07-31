import { createHash, randomBytes } from "node:crypto";
import { IdentityError } from "../domain/errors";
import type {
  LoginSession,
  PrivacyConsent,
  SessionClientContext,
  SessionAuthenticationMethod,
} from "../domain/types";
import type {
  IdentityRepository,
  UpsertIdentityInput,
} from "./identity-repository";

const loginChallengeTtlMinutes = 15;

export function hashIdentityToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueIdentityToken() {
  return randomBytes(32).toString("base64url");
}

export type AuthenticateIdentityInput = UpsertIdentityInput & {
  authenticationMethod: SessionAuthenticationMethod;
  /**
   * Только серверное доказательство из проверенного browser-bound intent.
   * Оно записывает свежесть, но не выдаёт роль или permission.
   */
  administrativeAuthentication?: boolean;
  clientContext?: SessionClientContext;
};

export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly sessionTtlDays: number,
  ) {}

  async authenticateIdentity(
    input: AuthenticateIdentityInput,
  ): Promise<LoginSession> {
    if (
      input.administrativeAuthentication &&
      input.authenticationMethod === "demo"
    ) {
      throw new IdentityError(
        "INVALID_REQUEST",
        "Тестовый вход не может подтвердить административную сессию.",
        400,
      );
    }
    const adminVerificationMethod =
      input.administrativeAuthentication &&
      input.authenticationMethod !== "demo"
        ? input.authenticationMethod
        : undefined;

    const user = await this.repository.upsertIdentity(input);
    const token = createOpaqueIdentityToken();
    const authenticatedAt = new Date();
    const expiresAt = new Date(
      authenticatedAt.getTime() +
        this.sessionTtlDays * 24 * 60 * 60 * 1_000,
    );

    const sessionCreated = await this.repository.createSession({
      userId: user.id,
      tokenSha256: hashIdentityToken(token),
      expiresAt,
      authenticatedAt,
      authenticationMethod: input.authenticationMethod,
      authenticationMethodId: user.primaryMethod.id,
      adminVerificationMethod,
      clientContext: input.clientContext,
    });

    if (!sessionCreated) {
      throw new IdentityError(
        "INVALID_LOGIN",
        "Не удалось выполнить вход в эту учётную запись.",
        403,
      );
    }

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
    const token = createOpaqueIdentityToken();
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

  async verifyEmailLogin(
    token: string,
    input: { clientContext?: SessionClientContext } = {},
  ) {
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
      authenticationMethod: "email_magic_link",
      methodType: "email",
      identifier: challenge.identifier,
      displayName: challenge.displayName,
      receiptEmail: challenge.identifier,
      metadata: {},
      consent: challenge.consent,
      clientContext: input.clientContext,
    });

    return {
      session,
      redirectPath: challenge.redirectPath,
    };
  }
}
