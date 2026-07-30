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
      userId: string;
      revokedAt: Date;
      trackedSessionId: string;
    },
  ): Promise<RevokeActiveIdentitySessionsResult>;
}
