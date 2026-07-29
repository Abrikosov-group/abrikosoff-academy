import {
  createOpaqueIdentityToken,
  hashIdentityToken,
} from "@/modules/identity/application/identity-service";
import type { LoginSession } from "@/modules/identity/domain/types";
import type { AdministrationRepository } from "./administration-repository";
import { AdministrationError } from "../domain/errors";
import {
  effectivePermissionsForRoles,
  isEnabledAdminRole,
} from "../domain/permissions";
import type {
  AdminContext,
  AdminPermission,
  AdminSessionRecord,
  AdminVerificationStart,
  AdministrationMode,
} from "../domain/types";

const adminVerificationTtlMs = 12 * 60 * 60 * 1_000;

function authenticationMetadataIsValid(
  session: AdminSessionRecord,
) {
  return Boolean(
    session.authenticatedAt &&
      session.authenticationMethod &&
      session.authenticationMethodId &&
      session.authenticationMethodMatches &&
      session.authenticationMethod !== "demo",
  );
}

function enabledRoles(session: AdminSessionRecord) {
  return session.roles.filter(isEnabledAdminRole);
}

function verificationIsFresh(
  session: AdminSessionRecord,
  now: Date,
) {
  if (
    !session.adminVerifiedAt ||
    !session.adminVerificationMethod
  ) {
    return false;
  }

  const age = now.getTime() - session.adminVerifiedAt.getTime();

  if (age < -60_000 || age > adminVerificationTtlMs) {
    return false;
  }

  if (session.adminVerificationMethod !== "break_glass") {
    return session.adminBreakGlassExpiresAt === null;
  }

  return Boolean(
    session.adminBreakGlassExpiresAt &&
      session.adminBreakGlassExpiresAt > now,
  );
}

export class AdministrationService {
  constructor(
    private readonly repository: AdministrationRepository,
    private readonly options: {
      mode: AdministrationMode;
      sessionTtlDays: number;
    },
  ) {}

  private requireEnabled() {
    if (this.options.mode === "disabled") {
      throw new AdministrationError(
        "ADMINISTRATION_DISABLED",
        "Административная панель пока не включена.",
        404,
      );
    }
  }

  async canEnterAdministration(userId: string) {
    if (this.options.mode === "disabled") {
      return false;
    }

    const roles =
      await this.repository.findActiveRolesByUserId(userId);

    return effectivePermissionsForRoles(
      roles,
      this.options.mode,
    ).has("admin.enter");
  }

  private async requireBaseSession(
    tokenSha256: string | undefined,
  ) {
    this.requireEnabled();

    if (!tokenSha256) {
      throw new AdministrationError(
        "ADMIN_AUTH_REQUIRED",
        "Сначала войдите в Академию.",
        401,
      );
    }

    const session =
      await this.repository.findAdminSessionByTokenSha256(
        tokenSha256,
      );

    if (!session) {
      throw new AdministrationError(
        "ADMIN_AUTH_REQUIRED",
        "Сессия входа недействительна.",
        401,
      );
    }

    if (!authenticationMetadataIsValid(session)) {
      throw new AdministrationError(
        "ADMIN_LOGIN_REQUIRED",
        "Для входа в панель требуется новая штатная сессия.",
        401,
      );
    }

    const roles = enabledRoles(session);

    if (roles.length === 0) {
      throw new AdministrationError(
        "ADMIN_ROLE_REQUIRED",
        "У этой учётной записи нет доступа к панели.",
        403,
      );
    }

    return { roles, session };
  }

  async getContext(input: {
    tokenSha256?: string;
    permission: AdminPermission;
    requestId: string;
    now?: Date;
  }): Promise<AdminContext> {
    const now = input.now ?? new Date();
    const { roles, session } = await this.requireBaseSession(
      input.tokenSha256,
    );

    if (!verificationIsFresh(session, now)) {
      throw new AdministrationError(
        "ADMIN_REAUTH_REQUIRED",
        "Подтвердите административный вход.",
        401,
      );
    }

    const permissions = effectivePermissionsForRoles(
      roles,
      this.options.mode,
    );

    if (!permissions.has(input.permission)) {
      throw new AdministrationError(
        "ADMIN_PERMISSION_DENIED",
        "Недостаточно прав для этой операции.",
        403,
      );
    }

    return {
      actor: session.actor,
      sessionId: session.sessionId,
      roles,
      permissions,
      adminVerifiedAt: session.adminVerifiedAt!,
      adminVerificationMethod:
        session.adminVerificationMethod!,
      requestId: input.requestId,
    };
  }

  async prepareTelegramVerification(input: {
    tokenSha256?: string;
    now?: Date;
  }): Promise<AdminVerificationStart> {
    const now = input.now ?? new Date();
    const { session } = await this.requireBaseSession(
      input.tokenSha256,
    );

    return {
      userId: session.actor.id,
      sessionId: session.sessionId,
      alreadyVerified: verificationIsFresh(session, now),
    };
  }

  async confirmTelegramVerification(input: {
    currentTokenSha256?: string;
    expectedSessionId: string;
    expectedUserId: string;
    telegramIdentifier: string;
    userAgentFamily?: string;
    now?: Date;
  }): Promise<LoginSession> {
    this.requireEnabled();

    if (!input.currentTokenSha256) {
      throw new AdministrationError(
        "ADMIN_VERIFICATION_REJECTED",
        "Исходная сессия подтверждения недействительна.",
        401,
      );
    }

    const authenticatedAt = input.now ?? new Date();
    const expiresAt = new Date(
      authenticatedAt.getTime() +
        this.options.sessionTtlDays * 24 * 60 * 60 * 1_000,
    );
    const token = createOpaqueIdentityToken();
    const confirmed =
      await this.repository.rotateSessionForTelegramAdmin({
        currentTokenSha256: input.currentTokenSha256,
        expectedSessionId: input.expectedSessionId,
        expectedUserId: input.expectedUserId,
        telegramIdentifier: input.telegramIdentifier,
        newTokenSha256: hashIdentityToken(token),
        authenticatedAt,
        expiresAt,
        userAgentFamily: input.userAgentFamily,
      });

    if (!confirmed) {
      throw new AdministrationError(
        "ADMIN_VERIFICATION_REJECTED",
        "Не удалось подтвердить административный вход.",
        401,
      );
    }

    return {
      token,
      expiresAt,
      user: confirmed.user,
    };
  }
}
