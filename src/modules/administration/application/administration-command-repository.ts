import type { AdminRole } from "../domain/types";
import type { UserStatusCommandAction } from "../domain/user-status-command";
import type { IdentityUserStatus } from "@/modules/identity/domain/types";
import type { EffectiveAccessDecision } from "@/modules/access/domain/effective-access";

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

export type AdminCommandInspection =
  | Exclude<AdminCommandReservation, { state: "reserved" }>
  | { state: "missing" }
  | { state: "recoverable" };

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

export type ChangeUserStatusCommand = InternalAdminCommand & {
  statusAction: UserStatusCommandAction;
  targetStatus: Extract<
    IdentityUserStatus,
    "active" | "blocked"
  >;
};

export type ChangeUserStatusExecution =
  | {
      state: "succeeded";
      previousStatus: Extract<
        IdentityUserStatus,
        "active" | "blocked"
      >;
      currentStatus: Extract<
        IdentityUserStatus,
        "active" | "blocked"
      >;
      statusChanged: boolean;
      revokedSessionCount: number;
      revokedActorSessionId?: string;
    }
  | {
      state: "rejected";
      errorCode:
        | "USER_NOT_FOUND"
        | "USER_STATUS_TRANSITION_INVALID"
        | "LAST_AVAILABLE_OWNER";
      resultStatus: 404 | 409;
    };

export type GrantManualAccessCommand = InternalAdminCommand & {
  customerId: string;
  periodStart: string;
  periodEnd: string;
};

export type RevokeManualAccessCommand = InternalAdminCommand & {
  customerId: string;
  grantId: string;
};

export type GrantManualAccessExecution =
  | {
      state: "succeeded";
      grantId: string;
      customerId: string;
      status: "granted";
      periodStart: string;
      periodEnd: string;
      grantedAt: string;
      overlapCount: number;
      effectiveAccess: EffectiveAccessDecision;
    }
  | {
      state: "rejected";
      errorCode: "USER_NOT_FOUND";
      resultStatus: 404;
    };

export type RevokeManualAccessExecution =
  | {
      state: "succeeded";
      grantId: string;
      customerId: string;
      status: "revoked";
      revokedAt: string;
      effectiveAccess: EffectiveAccessDecision;
    }
  | {
      state: "rejected";
      errorCode:
        | "MANUAL_ACCESS_GRANT_NOT_FOUND"
        | "MANUAL_ACCESS_GRANT_ALREADY_REVOKED";
      resultStatus: 404 | 409;
    };

export interface AdministrationCommandLifecycleRepository {
  reserveInternalCommand(
    command: InternalAdminCommand,
  ): Promise<AdminCommandReservation>;

  recordFailedInternalCommand(
    command: InternalAdminCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode: string,
  ): Promise<boolean>;
}

export interface AdministrationManualAccessCommandRepository
  extends AdministrationCommandLifecycleRepository {
  inspectInternalCommand(
    command: InternalAdminCommand,
  ): Promise<AdminCommandInspection>;

  executeGrantManualAccess(
    command: GrantManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<GrantManualAccessExecution>;

  executeRevokeManualAccess(
    command: RevokeManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<RevokeManualAccessExecution>;

  rejectManualAccessGrantingGate(
    command: GrantManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode:
      | "MANUAL_ACCESS_GRANTING_DISABLED"
      | "MANUAL_ACCESS_GRANTING_REQUIRES_V2",
  ): Promise<boolean>;
}

export interface AdministrationSessionCommandRepository
  extends AdministrationCommandLifecycleRepository {
  executeRevokeUserSessions(
    command: InternalAdminCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<RevokeUserSessionsExecution>;
}

export interface AdministrationUserStatusCommandRepository
  extends AdministrationCommandLifecycleRepository {
  executeChangeUserStatus(
    command: ChangeUserStatusCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<ChangeUserStatusExecution>;
}

export interface AdministrationCommandRepository
  extends
    AdministrationSessionCommandRepository,
    AdministrationUserStatusCommandRepository,
    AdministrationManualAccessCommandRepository {}
