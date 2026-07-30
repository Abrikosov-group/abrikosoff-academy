import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ConsumedLoginChallenge,
  CreateLoginChallengeInput,
  IdentityRepository,
  UpsertIdentityInput,
} from "../application/identity-repository";
import type {
  AuthenticatedUser,
  IdentityMethodType,
  SessionClientContext,
  SessionAuthenticationMethod,
} from "../domain/types";
import {
  getAvatarUrlFromMetadata,
  normalizeUserAvatarUrl,
} from "../domain/user-presentation";

type IdentityRow = {
  user_id: string;
  display_name: string;
  receipt_email: string | null;
  avatar_url: string | null;
  method_id: string;
  method_type: IdentityMethodType;
  identifier: string;
  metadata: Record<string, unknown>;
};

function mapIdentityRow(row: IdentityRow): AuthenticatedUser {
  return {
    id: row.user_id,
    displayName: row.display_name,
    receiptEmail: row.receipt_email ?? undefined,
    avatarUrl: normalizeUserAvatarUrl(row.avatar_url),
    primaryMethod: {
      id: row.method_id,
      type: row.method_type,
      identifier: row.identifier,
      metadata: row.metadata,
    },
  };
}

async function findIdentity(
  client: Pool | PoolClient,
  methodType: IdentityMethodType,
  identifier: string,
) {
  const result = await client.query<IdentityRow>(
    `
      SELECT
        users.id AS user_id,
        users.display_name,
        users.receipt_email,
        (
          SELECT telegram_methods.metadata ->> 'photoUrl'
          FROM identity_methods telegram_methods
          WHERE telegram_methods.user_id = users.id
            AND telegram_methods.method_type = 'telegram'
          ORDER BY
            telegram_methods.verified_at DESC NULLS LAST,
            telegram_methods.created_at DESC,
            telegram_methods.id DESC
          LIMIT 1
        ) AS avatar_url,
        methods.id AS method_id,
        methods.method_type,
        methods.identifier,
        methods.metadata
      FROM identity_methods methods
      JOIN identity_users users ON users.id = methods.user_id
      WHERE methods.method_type = $1
        AND methods.identifier = $2
        AND users.status = 'active'
      LIMIT 1
    `,
    [methodType, identifier],
  );

  return result.rows[0] ? mapIdentityRow(result.rows[0]) : null;
}

async function recordPrivacyConsent(
  client: Pool | PoolClient,
  userId: string,
  consent: UpsertIdentityInput["consent"],
) {
  await client.query(
    `
      INSERT INTO identity_consents (
        id,
        user_id,
        document_type,
        document_version,
        accepted_at,
        source
      )
      VALUES ($1, $2, 'privacy', $3, $4, $5)
      ON CONFLICT (user_id, document_type, document_version)
      DO NOTHING
    `,
    [
      randomUUID(),
      userId,
      consent.documentVersion,
      consent.acceptedAt,
      consent.source,
    ],
  );
}

async function updateExistingIdentity(
  client: PoolClient,
  existing: AuthenticatedUser,
  input: UpsertIdentityInput,
) {
  await client.query(
    `
      UPDATE identity_users
      SET
        display_name = $2,
        receipt_email = COALESCE($3, receipt_email),
        updated_at = now()
      WHERE id = $1
    `,
    [existing.id, input.displayName, input.receiptEmail ?? null],
  );
  await client.query(
    `
      UPDATE identity_methods
      SET metadata = $3::jsonb, verified_at = now(), updated_at = now()
      WHERE method_type = $1 AND identifier = $2
    `,
    [
      input.methodType,
      input.identifier,
      JSON.stringify(input.metadata),
    ],
  );
  await recordPrivacyConsent(client, existing.id, input.consent);

  return {
    ...existing,
    displayName: input.displayName,
    receiptEmail: input.receiptEmail ?? existing.receiptEmail,
    avatarUrl:
      input.methodType === "telegram"
        ? getAvatarUrlFromMetadata(input.metadata)
        : existing.avatarUrl,
    primaryMethod: {
      id: existing.primaryMethod.id,
      type: input.methodType,
      identifier: input.identifier,
      metadata: input.metadata,
    },
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: Pool) {}

  async upsertIdentity(
    input: UpsertIdentityInput,
  ): Promise<AuthenticatedUser> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const existing = await findIdentity(
        client,
        input.methodType,
        input.identifier,
      );

      if (existing) {
        const updated = await updateExistingIdentity(
          client,
          existing,
          input,
        );
        await client.query("COMMIT");
        return updated;
      }

      const userId = randomUUID();
      const methodId = randomUUID();

      await client.query(
        `
          INSERT INTO identity_users (
            id,
            display_name,
            receipt_email,
            status
          )
          VALUES ($1, $2, $3, 'active')
        `,
        [userId, input.displayName, input.receiptEmail ?? null],
      );
      await client.query(
        `
          INSERT INTO identity_methods (
            id,
            user_id,
            method_type,
            identifier,
            verified_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, now(), $5::jsonb)
        `,
        [
          methodId,
          userId,
          input.methodType,
          input.identifier,
          JSON.stringify(input.metadata),
        ],
      );
      await recordPrivacyConsent(client, userId, input.consent);
      await client.query("COMMIT");

      return {
        id: userId,
        displayName: input.displayName,
        receiptEmail: input.receiptEmail,
        avatarUrl: getAvatarUrlFromMetadata(input.metadata),
        primaryMethod: {
          id: methodId,
          type: input.methodType,
          identifier: input.identifier,
          metadata: input.metadata,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");

      if (isUniqueViolation(error)) {
        try {
          await client.query("BEGIN");
          const racedIdentity = await findIdentity(
            client,
            input.methodType,
            input.identifier,
          );

          if (!racedIdentity) {
            throw error;
          }

          const updated = await updateExistingIdentity(
            client,
            racedIdentity,
            input,
          );
          await client.query("COMMIT");
          return updated;
        } catch (retryError) {
          await client.query("ROLLBACK");
          throw retryError;
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(input: {
    userId: string;
    tokenSha256: string;
    expiresAt: Date;
    authenticatedAt: Date;
    authenticationMethod: SessionAuthenticationMethod;
    authenticationMethodId: string;
    clientContext?: SessionClientContext;
  }) {
    const clientContext = input.clientContext;

    await this.pool.query(
      `
        INSERT INTO identity_sessions (
          id,
          user_id,
          token_sha256,
          expires_at,
          authenticated_at,
          authentication_method,
          authentication_method_id,
          user_agent_family,
          client_ip,
          country_code,
          region,
          region_code,
          city,
          client_timezone,
          browser_version,
          operating_system,
          operating_system_version,
          device_type,
          device_vendor,
          device_model,
          client_architecture,
          client_bitness,
          preferred_language,
          raw_user_agent,
          cloudflare_ray_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25
        )
      `,
      [
        randomUUID(),
        input.userId,
        input.tokenSha256,
        input.expiresAt,
        input.authenticatedAt,
        input.authenticationMethod,
        input.authenticationMethodId,
        clientContext?.userAgentFamily ?? null,
        clientContext?.ipAddress ?? null,
        clientContext?.countryCode ?? null,
        clientContext?.region ?? null,
        clientContext?.regionCode ?? null,
        clientContext?.city ?? null,
        clientContext?.timezone ?? null,
        clientContext?.browserVersion ?? null,
        clientContext?.operatingSystem ?? null,
        clientContext?.operatingSystemVersion ?? null,
        clientContext?.deviceType ?? null,
        clientContext?.deviceVendor ?? null,
        clientContext?.deviceModel ?? null,
        clientContext?.architecture ?? null,
        clientContext?.bitness ?? null,
        clientContext?.preferredLanguage ?? null,
        clientContext?.rawUserAgent ?? null,
        clientContext?.cloudflareRayId ?? null,
      ],
    );
  }

  async findUserBySessionTokenSha256(tokenSha256: string) {
    const result = await this.pool.query<IdentityRow>(
      `
        SELECT
          users.id AS user_id,
          users.display_name,
          users.receipt_email,
          (
            SELECT telegram_methods.metadata ->> 'photoUrl'
            FROM identity_methods telegram_methods
            WHERE telegram_methods.user_id = users.id
              AND telegram_methods.method_type = 'telegram'
            ORDER BY
              telegram_methods.verified_at DESC NULLS LAST,
              telegram_methods.created_at DESC,
              telegram_methods.id DESC
            LIMIT 1
          ) AS avatar_url,
          methods.id AS method_id,
          methods.method_type,
          methods.identifier,
          methods.metadata
        FROM identity_sessions sessions
        JOIN identity_users users ON users.id = sessions.user_id
        JOIN LATERAL (
          SELECT id, method_type, identifier, metadata
          FROM identity_methods
          WHERE user_id = users.id
          ORDER BY
            verified_at DESC NULLS LAST,
            created_at DESC
          LIMIT 1
        ) methods ON true
        WHERE sessions.token_sha256 = $1
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > now()
          AND users.status = 'active'
        LIMIT 1
      `,
      [tokenSha256],
    );

    return result.rows[0] ? mapIdentityRow(result.rows[0]) : null;
  }

  async revokeSession(tokenSha256: string) {
    await this.pool.query(
      `
        UPDATE identity_sessions
        SET revoked_at = now()
        WHERE token_sha256 = $1 AND revoked_at IS NULL
      `,
      [tokenSha256],
    );
  }

  async createLoginChallenge(input: CreateLoginChallengeInput) {
    await this.pool.query(
      `
        INSERT INTO identity_login_challenges (
          id,
          method_type,
          identifier,
          token_sha256,
          display_name,
          redirect_path,
          consent_accepted_at,
          consent_document_version,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        input.methodType,
        input.identifier,
        input.tokenSha256,
        input.displayName,
        input.redirectPath,
        input.consent.acceptedAt,
        input.consent.documentVersion,
        input.expiresAt,
      ],
    );
  }

  async consumeLoginChallenge(
    tokenSha256: string,
  ): Promise<ConsumedLoginChallenge | null> {
    const result = await this.pool.query<{
      method_type: "email" | "phone";
      identifier: string;
      display_name: string;
      redirect_path: string;
      consent_accepted_at: Date;
      consent_document_version: string;
    }>(
      `
        UPDATE identity_login_challenges
        SET consumed_at = now()
        WHERE token_sha256 = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING
          method_type,
          identifier,
          display_name,
          redirect_path,
          consent_accepted_at,
          consent_document_version
      `,
      [tokenSha256],
    );
    const challenge = result.rows[0];

    if (!challenge) {
      return null;
    }

    return {
      methodType: challenge.method_type,
      identifier: challenge.identifier,
      displayName: challenge.display_name,
      redirectPath: challenge.redirect_path,
      consent: {
        acceptedAt: challenge.consent_accepted_at.toISOString(),
        documentVersion: challenge.consent_document_version,
        source: "email-magic-link",
      },
    };
  }
}
