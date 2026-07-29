import type { LoginSession } from "@/modules/identity/domain/types";
import type {
  AdminRole,
  AdminSessionRecord,
} from "../domain/types";

export interface AdministrationRepository {
  findActiveRolesByUserId(
    userId: string,
  ): Promise<readonly AdminRole[]>;

  findAdminSessionByTokenSha256(
    tokenSha256: string,
  ): Promise<AdminSessionRecord | null>;

  rotateSessionForTelegramAdmin(input: {
    currentTokenSha256: string;
    expectedSessionId: string;
    expectedUserId: string;
    telegramIdentifier: string;
    newTokenSha256: string;
    authenticatedAt: Date;
    expiresAt: Date;
    userAgentFamily?: string;
  }): Promise<Omit<LoginSession, "token" | "expiresAt"> | null>;
}
