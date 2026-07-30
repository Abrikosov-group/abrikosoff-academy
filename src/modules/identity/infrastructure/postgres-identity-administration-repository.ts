import "server-only";

import type { PoolClient } from "pg";
import type {
  IdentityAdministrationRepository,
  RevokeActiveIdentitySessionsResult,
} from "../application/identity-administration-repository";

export class PostgresIdentityAdministrationRepository
  implements IdentityAdministrationRepository
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
    const userIds = [
      ...new Set(
        [input.actorUserId, targetUserId].map((userId) =>
          userId.toLowerCase(),
        ),
      ),
    ].sort();
    let targetUserExists = false;

    for (const userId of userIds) {
      const user = await client.query<{ id: string }>(
        `
          SELECT id
          FROM identity_users
          WHERE id = $1
          FOR UPDATE
        `,
        [userId],
      );

      if (userId === targetUserId && user.rows[0]) {
        targetUserExists = true;
      }
    }

    if (!targetUserExists) {
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
}
