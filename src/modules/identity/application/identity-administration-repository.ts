import type { PoolClient } from "pg";

export type RevokeActiveIdentitySessionsResult =
  | {
      userExists: false;
    }
  | {
      userExists: true;
      revokedSessionCount: number;
      revokedTrackedSessionId?: string;
    };

export interface IdentityAdministrationRepository {
  revokeActiveSessions(
    client: PoolClient,
    input: {
      actorUserId: string;
      userId: string;
      revokedAt: Date;
      trackedSessionId?: string;
    },
  ): Promise<RevokeActiveIdentitySessionsResult>;
}
