import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AdministrationRepository } from "../application/administration-repository";
import { isAdminRole } from "../domain/permissions";
import type {
  AdminSessionRecord,
  AdminVerificationMethod,
} from "../domain/types";
import type {
  IdentityMethodType,
  SessionAuthenticationMethod,
} from "@/modules/identity/domain/types";

type AdminSessionRow = {
  session_id: string;
  user_id: string;
  display_name: string;
  receipt_email: string | null;
  primary_method_id: string;
  primary_method_type: IdentityMethodType;
  primary_identifier: string;
  primary_metadata: Record<string, unknown>;
  authenticated_at: Date | null;
  authentication_method: SessionAuthenticationMethod | null;
  authentication_method_id: string | null;
  authentication_method_matches: boolean;
  admin_verified_at: Date | null;
  admin_verification_method: AdminVerificationMethod | null;
  admin_break_glass_expires_at: Date | null;
  roles: string[];
};

function mapAdminSessionRow(
  row: AdminSessionRow,
): AdminSessionRecord {
  return {
    actor: {
      id: row.user_id,
      displayName: row.display_name,
      receiptEmail: row.receipt_email ?? undefined,
      primaryMethod: {
        id: row.primary_method_id,
        type: row.primary_method_type,
        identifier: row.primary_identifier,
        metadata: row.primary_metadata,
      },
    },
    sessionId: row.session_id,
    authenticatedAt: row.authenticated_at,
    authenticationMethod: row.authentication_method,
    authenticationMethodId: row.authentication_method_id,
    authenticationMethodMatches:
      row.authentication_method_matches,
    adminVerifiedAt: row.admin_verified_at,
    adminVerificationMethod: row.admin_verification_method,
    adminBreakGlassExpiresAt:
      row.admin_break_glass_expires_at,
    roles: row.roles.filter(isAdminRole),
  };
}

type TelegramIdentityRow = {
  method_id: string;
  user_id: string;
  display_name: string;
  receipt_email: string | null;
  method_type: "telegram";
  identifier: string;
  metadata: Record<string, unknown>;
};

export class PostgresAdministrationRepository
  implements AdministrationRepository
{
  constructor(private readonly pool: Pool) {}

  async findAdminSessionByTokenSha256(tokenSha256: string) {
    const result = await this.pool.query<AdminSessionRow>(
      `
        SELECT
          sessions.id AS session_id,
          users.id AS user_id,
          users.display_name,
          users.receipt_email,
          primary_method.id AS primary_method_id,
          primary_method.method_type AS primary_method_type,
          primary_method.identifier AS primary_identifier,
          primary_method.metadata AS primary_metadata,
          sessions.authenticated_at,
          sessions.authentication_method,
          sessions.authentication_method_id,
          (
            authenticated_method.id IS NOT NULL
            AND authenticated_method.user_id = sessions.user_id
            AND (
              (
                sessions.authentication_method = 'telegram_oidc'
                AND authenticated_method.method_type = 'telegram'
              )
              OR (
                sessions.authentication_method = 'email_magic_link'
                AND authenticated_method.method_type = 'email'
              )
              OR sessions.authentication_method = 'demo'
            )
          ) AS authentication_method_matches,
          sessions.admin_verified_at,
          sessions.admin_verification_method,
          sessions.admin_break_glass_expires_at,
          COALESCE(
            array_agg(DISTINCT assignments.role)
              FILTER (WHERE assignments.role IS NOT NULL),
            ARRAY[]::text[]
          ) AS roles
        FROM identity_sessions sessions
        JOIN identity_users users
          ON users.id = sessions.user_id
        JOIN LATERAL (
          SELECT
            methods.id,
            methods.method_type,
            methods.identifier,
            methods.metadata
          FROM identity_methods methods
          WHERE methods.user_id = users.id
          ORDER BY
            methods.verified_at DESC NULLS LAST,
            methods.created_at DESC,
            methods.id DESC
          LIMIT 1
        ) primary_method ON true
        LEFT JOIN identity_methods authenticated_method
          ON authenticated_method.id =
            sessions.authentication_method_id
        LEFT JOIN admin_role_assignments assignments
          ON assignments.user_id = users.id
          AND assignments.status = 'active'
        WHERE sessions.token_sha256 = $1
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > now()
          AND users.status = 'active'
        GROUP BY
          sessions.id,
          users.id,
          primary_method.id,
          primary_method.method_type,
          primary_method.identifier,
          primary_method.metadata,
          authenticated_method.id,
          authenticated_method.user_id,
          authenticated_method.method_type
        LIMIT 1
      `,
      [tokenSha256],
    );

    return result.rows[0]
      ? mapAdminSessionRow(result.rows[0])
      : null;
  }

  async rotateSessionForTelegramAdmin(input: {
    currentTokenSha256: string;
    expectedSessionId: string;
    expectedUserId: string;
    telegramIdentifier: string;
    newTokenSha256: string;
    authenticatedAt: Date;
    expiresAt: Date;
    userAgentFamily?: string;
  }) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const session = await client.query<{ id: string }>(
        `
          SELECT sessions.id
          FROM identity_sessions sessions
          JOIN identity_users users
            ON users.id = sessions.user_id
          JOIN identity_methods authenticated_method
            ON authenticated_method.id =
              sessions.authentication_method_id
            AND authenticated_method.user_id = sessions.user_id
          WHERE sessions.token_sha256 = $1
            AND sessions.id = $2
            AND sessions.user_id = $3
            AND sessions.revoked_at IS NULL
            AND sessions.expires_at > $4
            AND sessions.authenticated_at IS NOT NULL
            AND (
              (
                sessions.authentication_method = 'telegram_oidc'
                AND authenticated_method.method_type = 'telegram'
              )
              OR (
                sessions.authentication_method = 'email_magic_link'
                AND authenticated_method.method_type = 'email'
              )
            )
            AND users.status = 'active'
          FOR UPDATE OF sessions
        `,
        [
          input.currentTokenSha256,
          input.expectedSessionId,
          input.expectedUserId,
          input.authenticatedAt,
        ],
      );

      if (!session.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const role = await client.query<{ id: string }>(
        `
          SELECT id
          FROM admin_role_assignments
          WHERE user_id = $1
            AND role = 'owner'
            AND status = 'active'
          LIMIT 1
          FOR SHARE
        `,
        [input.expectedUserId],
      );

      if (!role.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const telegramMethod =
        await client.query<TelegramIdentityRow>(
          `
            SELECT
              methods.id AS method_id,
              users.id AS user_id,
              users.display_name,
              users.receipt_email,
              methods.method_type,
              methods.identifier,
              methods.metadata
            FROM identity_methods methods
            JOIN identity_users users
              ON users.id = methods.user_id
            WHERE methods.user_id = $1
              AND methods.method_type = 'telegram'
              AND methods.identifier = $2
              AND users.status = 'active'
            LIMIT 1
            FOR SHARE OF methods, users
          `,
          [
            input.expectedUserId,
            input.telegramIdentifier,
          ],
        );
      const method = telegramMethod.rows[0];

      if (!method) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `
          UPDATE identity_sessions
          SET revoked_at = $2
          WHERE id = $1
            AND revoked_at IS NULL
        `,
        [input.expectedSessionId, input.authenticatedAt],
      );
      await client.query(
        `
          INSERT INTO identity_sessions (
            id,
            user_id,
            token_sha256,
            expires_at,
            authenticated_at,
            authentication_method,
            authentication_method_id,
            admin_verified_at,
            admin_verification_method,
            admin_break_glass_expires_at,
            user_agent_family
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            'telegram_oidc',
            $6,
            $5,
            'telegram_oidc',
            NULL,
            $7
          )
        `,
        [
          randomUUID(),
          input.expectedUserId,
          input.newTokenSha256,
          input.expiresAt,
          input.authenticatedAt,
          method.method_id,
          input.userAgentFamily ?? null,
        ],
      );
      await client.query("COMMIT");

      return {
        user: {
          id: method.user_id,
          displayName: method.display_name,
          receiptEmail: method.receipt_email ?? undefined,
          primaryMethod: {
            id: method.method_id,
            type: method.method_type,
            identifier: method.identifier,
            metadata: method.metadata,
          },
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
