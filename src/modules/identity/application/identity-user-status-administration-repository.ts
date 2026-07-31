import type { PoolClient } from "pg";
import type { IdentityUserStatus } from "../domain/types";

export type LockedIdentityUserStatus =
  | {
      userExists: false;
    }
  | {
      userExists: true;
      status: IdentityUserStatus;
    };

export type ApplyIdentityUserStatusResult = {
  statusChanged: boolean;
  revokedSessionCount: number;
  revokedTrackedSessionId?: string;
};

export interface IdentityUserStatusAdministrationRepository {
  lockUsersForStatusChange(
    client: PoolClient,
    input: {
      actorUserId: string;
      userId: string;
    },
  ): Promise<LockedIdentityUserStatus>;

  applyUserStatusChange(
    client: PoolClient,
    input: {
      userId: string;
      previousStatus: IdentityUserStatus;
      targetStatus: Extract<
        IdentityUserStatus,
        "active" | "blocked"
      >;
      changedAt: Date;
      trackedSessionId?: string;
    },
  ): Promise<ApplyIdentityUserStatusResult>;
}
