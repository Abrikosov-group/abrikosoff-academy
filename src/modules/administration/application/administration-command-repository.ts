import type { AdminRole } from "../domain/types";

export type InternalAdminCommand = {
  principalKey: string;
  actorUserId: string;
  actorSessionId: string;
  actorRoles: readonly AdminRole[];
  action: string;
  idempotencyKey: string;
  requestSha256: string;
  requestId: string;
  targetType: string;
  targetId: string;
  reason: string;
  userAgentFamily?: string;
};

export type AdminCommandReservation =
  | {
      state: "reserved";
      executionId: string;
      attemptCount: number;
    }
  | {
      state: "replayed";
      executionId: string;
      status: "succeeded" | "rejected" | "failed";
      resultStatus: number;
      result: unknown;
      errorCode?: string;
    }
  | {
      state: "conflict";
    }
  | {
      state: "in_progress";
    };

export type RevokeUserSessionsExecution =
  | {
      state: "succeeded";
      revokedSessionCount: number;
      revokedActorSessionId?: string;
    }
  | {
      state: "rejected";
      errorCode: "USER_NOT_FOUND";
      resultStatus: 404;
    };

export interface AdministrationCommandRepository {
  reserveInternalCommand(
    command: InternalAdminCommand,
  ): Promise<AdminCommandReservation>;

  executeRevokeUserSessions(
    command: InternalAdminCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<RevokeUserSessionsExecution>;

  recordFailedInternalCommand(
    command: InternalAdminCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode: string,
  ): Promise<boolean>;
}
