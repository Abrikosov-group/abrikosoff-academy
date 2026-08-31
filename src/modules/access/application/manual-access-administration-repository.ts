import type { PoolClient } from "pg";

export type LockedManualAccessGrant = {
  id: string;
  customerId: string;
  status: "granted" | "revoked";
  periodStart: Date;
  periodEnd: Date;
  grantedAt: Date;
  revokedAt?: Date;
};

export interface ManualAccessAdministrationRepository {
  countOverlaps(
    client: PoolClient,
    input: {
      customerId: string;
      periodStart: Date;
      periodEnd: Date;
    },
  ): Promise<number>;

  insertGrant(
    client: PoolClient,
    input: {
      id: string;
      customerId: string;
      periodStart: Date;
      periodEnd: Date;
      reason: string;
      actorUserId: string;
      grantedAt: Date;
      commandExecutionId: string;
    },
  ): Promise<void>;

  lockGrant(
    client: PoolClient,
    grantId: string,
  ): Promise<LockedManualAccessGrant | null>;

  revokeGrant(
    client: PoolClient,
    input: {
      grantId: string;
      actorUserId: string;
      reason: string;
      revokedAt: Date;
    },
  ): Promise<void>;
}
