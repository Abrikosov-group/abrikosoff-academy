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
      userId: string;
      revokedAt: Date;
      trackedSessionId: string;
    },
  ): Promise<RevokeActiveIdentitySessionsResult> {
    const user = await client.query<{ id: string }>(
      `
        SELECT id
        FROM identity_users
        WHERE id = $1
        FOR SHARE
      `,
      [input.userId],
    );

    if (!user.rows[0]) {
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
      [input.userId, input.revokedAt],
    );
    const trackedSessionWasRevoked = revoked.rows.some(
      (session) => session.id === input.trackedSessionId,
    );
    const trackedSession = trackedSessionWasRevoked
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
          [input.trackedSessionId, input.userId],
        );
    const revokedTrackedSessionId =
      trackedSessionWasRevoked || trackedSession?.rows[0]
        ? input.trackedSessionId
        : undefined;

    return {
      userExists: true,
      revokedSessionCount: revoked.rows.length,
      revokedTrackedSessionId,
    };
  }
}
