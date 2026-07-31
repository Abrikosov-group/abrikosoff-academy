import "server-only";

import type { PoolClient } from "pg";
import type {
  IdentityAdministrationRepository,
  RevokeActiveIdentitySessionsResult,
} from "../application/identity-administration-repository";
import type {
  ApplyIdentityUserStatusResult,
  IdentityUserStatusAdministrationRepository,
  LockedIdentityUserStatus,
} from "../application/identity-user-status-administration-repository";
import type { IdentityUserStatus } from "../domain/types";

async function lockIdentityUsers(
  client: PoolClient,
  actorUserId: string,
  targetUserId: string,
) {
  const userIds = [
    ...new Set(
      [actorUserId, targetUserId].map((userId) =>
        userId.toLowerCase(),
      ),
    ),
  ].sort();
  const statuses = new Map<string, IdentityUserStatus>();

  for (const userId of userIds) {
    const user = await client.query<{
      id: string;
      status: IdentityUserStatus;
    }>(
      `
        SELECT id, status
        FROM identity_users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId],
    );
    const row = user.rows[0];

    if (row) {
      statuses.set(userId, row.status);
    }
  }

  return statuses;
}

export class PostgresIdentityAdministrationRepository
  implements
    IdentityAdministrationRepository,
    IdentityUserStatusAdministrationRepository
{
  async revokeActiveSessions(
    client: PoolClient,
    input: {
      actorUserId: string;
      userId: string;
      revokedAt: Date;
      trackedSessionId?: string;
    },
  ): Promise<RevokeActiveIdentitySessionsResult> {
    const targetUserId = input.userId.toLowerCase();
    // Взаимные команды A→B и B→A блокируют актёра и цель одинаково.
    const users = await lockIdentityUsers(
      client,
      input.actorUserId,
      targetUserId,
    );

    if (!users.has(targetUserId)) {
      return { userExists: false };
    }

    const revoked = await client.query<{ id: string }>(
      `
        UPDATE identity_sessions
        SET revoked_at = $2
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > $2
        RETURNING id
      `,
      [targetUserId, input.revokedAt],
    );
    const trackedSessionWasRevoked =
      input.trackedSessionId !== undefined &&
      revoked.rows.some(
        (session) => session.id === input.trackedSessionId,
      );
    const trackedSession =
      input.trackedSessionId === undefined ||
      trackedSessionWasRevoked
      ? undefined
      : await client.query<{ id: string }>(
          `
            SELECT id
            FROM identity_sessions
            WHERE id = $1
              AND user_id = $2
              AND revoked_at IS NOT NULL
            LIMIT 1
          `,
          [input.trackedSessionId, targetUserId],
        );
    const revokedTrackedSessionId =
      input.trackedSessionId !== undefined &&
      (trackedSessionWasRevoked || trackedSession?.rows[0])
        ? input.trackedSessionId
        : undefined;

    return {
      userExists: true,
      revokedSessionCount: revoked.rows.length,
      revokedTrackedSessionId,
    };
  }

  async lockUsersForStatusChange(
    client: PoolClient,
    input: {
      actorUserId: string;
      userId: string;
    },
  ): Promise<LockedIdentityUserStatus> {
    const targetUserId = input.userId.toLowerCase();
    const users = await lockIdentityUsers(
      client,
      input.actorUserId,
      targetUserId,
    );
    const status = users.get(targetUserId);

    return status
      ? {
          userExists: true,
          status,
        }
      : { userExists: false };
  }

  async applyUserStatusChange(
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
  ): Promise<ApplyIdentityUserStatusResult> {
    const targetUserId = input.userId.toLowerCase();
    let statusChanged = false;

    if (input.previousStatus !== input.targetStatus) {
      const updated = await client.query<{ id: string }>(
        `
          UPDATE identity_users
          SET
            status = $2,
            updated_at = $3
          WHERE id = $1
            AND status = $4
          RETURNING id
        `,
        [
          targetUserId,
          input.targetStatus,
          input.changedAt,
          input.previousStatus,
        ],
      );

      if (!updated.rows[0]) {
        throw new TypeError(
          "Состояние пользователя изменилось без удержания lock.",
        );
      }

      statusChanged = true;
    }

    const shouldRevokeSessions =
      input.targetStatus === "blocked" ||
      (input.previousStatus === "blocked" &&
        input.targetStatus === "active");

    if (!shouldRevokeSessions) {
      return {
        statusChanged,
        revokedSessionCount: 0,
      };
    }

    const revoked = await client.query<{ id: string }>(
      `
        UPDATE identity_sessions
        SET revoked_at = $2
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > $2
        RETURNING id
      `,
      [targetUserId, input.changedAt],
    );
    const trackedSessionWasRevoked =
      input.trackedSessionId !== undefined &&
      revoked.rows.some(
        (session) => session.id === input.trackedSessionId,
      );
    const trackedSession =
      input.trackedSessionId === undefined ||
      trackedSessionWasRevoked
        ? undefined
        : await client.query<{ id: string }>(
            `
              SELECT id
              FROM identity_sessions
              WHERE id = $1
                AND user_id = $2
              LIMIT 1
            `,
            [input.trackedSessionId, targetUserId],
          );
    const revokedTrackedSessionId =
      input.trackedSessionId !== undefined &&
      (trackedSessionWasRevoked || trackedSession?.rows[0])
        ? input.trackedSessionId
        : undefined;

    return {
      statusChanged,
      revokedSessionCount: revoked.rows.length,
      revokedTrackedSessionId,
    };
  }
}
