import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { IdentityAdministrationRepository } from "@/modules/identity/application/identity-administration-repository";
import type {
  AdminCommandReservation,
  AdministrationCommandRepository,
  InternalAdminCommand,
  RevokeUserSessionsExecution,
} from "../application/administration-command-repository";
import { AdministrationError } from "../domain/errors";

type CommandExecutionRow = {
  id: string;
  request_sha256: string;
  status:
    | "in_progress"
    | "waiting_external"
    | "succeeded"
    | "rejected"
    | "failed";
  result_status: number | null;
  result: unknown;
  error_code: string | null;
  lease_is_live: boolean;
  attempt_count: number;
};

async function selectCommandForUpdate(
  client: PoolClient,
  command: InternalAdminCommand,
) {
  return client.query<CommandExecutionRow>(
    `
      SELECT
        id,
        request_sha256,
        status,
        result_status,
        result,
        error_code,
        lease_expires_at > statement_timestamp()
          AS lease_is_live,
        attempt_count
      FROM admin_command_executions
      WHERE principal_key = $1
        AND action = $2
        AND idempotency_key = $3
      FOR UPDATE
    `,
    [
      command.principalKey,
      command.action,
      command.idempotencyKey,
    ],
  );
}

async function insertAuditEvent(
  client: PoolClient,
  input: {
    command: InternalAdminCommand;
    executionId: string;
    outcome: "succeeded" | "rejected" | "failed";
    errorCode?: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    createdAt?: Date;
  },
) {
  await client.query(
    `
      INSERT INTO admin_audit_events (
        id,
        request_id,
        command_execution_id,
        actor_kind,
        actor_user_id,
        actor_roles,
        action,
        target_type,
        target_id,
        reason,
        before_state,
        after_state,
        outcome,
        error_code,
        user_agent_family,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'user',
        $4,
        $5::text[],
        $6,
        $7,
        $8,
        $9,
        $10::jsonb,
        $11::jsonb,
        $12,
        $13,
        $14,
        COALESCE($15, now())
      )
    `,
    [
      randomUUID(),
      input.command.requestId,
      input.executionId,
      input.command.actorUserId,
      [...input.command.actorRoles],
      input.command.action,
      input.command.targetType,
      input.command.targetId,
      input.command.reason,
      JSON.stringify(input.beforeState ?? {}),
      JSON.stringify(input.afterState ?? {}),
      input.outcome,
      input.errorCode ?? null,
      input.command.userAgentFamily ?? null,
      input.createdAt ?? null,
    ],
  );
}

export class PostgresAdministrationCommandRepository
  implements AdministrationCommandRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly identityRepository: IdentityAdministrationRepository,
  ) {}

  async reserveInternalCommand(
    command: InternalAdminCommand,
  ): Promise<AdminCommandReservation> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      let existing = await selectCommandForUpdate(client, command);

      if (!existing.rows[0]) {
        const executionId = randomUUID();
        const inserted = await client.query<{
          id: string;
          attempt_count: number;
        }>(
          `
            INSERT INTO admin_command_executions (
              id,
              principal_key,
              actor_user_id,
              action,
              idempotency_key,
              request_sha256,
              target_type,
              target_id,
              execution_kind,
              status,
              lease_expires_at,
              attempt_count
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              'internal',
              'in_progress',
              now() + interval '5 minutes',
              1
            )
            ON CONFLICT (principal_key, action, idempotency_key)
            DO NOTHING
            RETURNING id, attempt_count
          `,
          [
            executionId,
            command.principalKey,
            command.actorUserId,
            command.action,
            command.idempotencyKey,
            command.requestSha256,
            command.targetType,
            command.targetId,
          ],
        );
        const reservation = inserted.rows[0];

        if (reservation) {
          await client.query("COMMIT");
          transactionOpen = false;

          return {
            state: "reserved",
            executionId: reservation.id,
            attemptCount: reservation.attempt_count,
          };
        }

        existing = await selectCommandForUpdate(client, command);
      }

      const previous = existing.rows[0];

      if (
        !previous ||
        previous.request_sha256 !== command.requestSha256
      ) {
        await client.query("COMMIT");
        transactionOpen = false;
        return { state: "conflict" };
      }

      if (
        previous.status === "succeeded" ||
        previous.status === "rejected" ||
        previous.status === "failed"
      ) {
        if (previous.result_status === null) {
          throw new TypeError(
            "Терминальное исполнение команды не содержит HTTP-статус.",
          );
        }

        await client.query("COMMIT");
        transactionOpen = false;

        return {
          state: "replayed",
          executionId: previous.id,
          status: previous.status,
          resultStatus: previous.result_status,
          result: previous.result,
          errorCode: previous.error_code ?? undefined,
        };
      }

      if (previous.lease_is_live) {
        await client.query("COMMIT");
        transactionOpen = false;
        return { state: "in_progress" };
      }

      const recovered = await client.query<{
        id: string;
        attempt_count: number;
      }>(
        `
          UPDATE admin_command_executions
          SET
            status = 'in_progress',
            lease_expires_at = now() + interval '5 minutes',
            attempt_count = attempt_count + 1,
            updated_at = now()
          WHERE id = $1
            AND status IN ('in_progress', 'waiting_external')
            AND lease_expires_at <= statement_timestamp()
          RETURNING id, attempt_count
        `,
        [previous.id],
      );
      const reservation = recovered.rows[0];

      if (!reservation) {
        throw new AdministrationError(
          "COMMAND_ATTEMPT_SUPERSEDED",
          "Операция уже продолжена другой попыткой.",
          409,
        );
      }

      await client.query("COMMIT");
      transactionOpen = false;

      return {
        state: "reserved",
        executionId: reservation.id,
        attemptCount: reservation.attempt_count,
      };
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async executeRevokeUserSessions(
    command: InternalAdminCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<RevokeUserSessionsExecution> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const execution = await client.query<{
        id: string;
        executed_at: Date;
      }>(
        `
          SELECT
            id,
            statement_timestamp() AS executed_at
          FROM admin_command_executions
          WHERE id = $1
            AND request_sha256 = $2
            AND status = 'in_progress'
            AND attempt_count = $3
            AND lease_expires_at > statement_timestamp()
          FOR UPDATE
        `,
        [
          reservation.executionId,
          command.requestSha256,
          reservation.attemptCount,
        ],
      );
      const activeExecution = execution.rows[0];

      if (!activeExecution) {
        throw new AdministrationError(
          "COMMAND_ATTEMPT_SUPERSEDED",
          "Операция уже продолжена другой попыткой.",
          409,
        );
      }

      const identityResult =
        await this.identityRepository.revokeActiveSessions(
          client,
          {
            actorUserId: command.actorUserId,
            userId: command.targetId,
            revokedAt: activeExecution.executed_at,
            ...(command.actorUserId === command.targetId
              ? {
                  trackedSessionId:
                    command.actorSessionId,
                }
              : {}),
          },
        );

      if (!identityResult.userExists) {
        const result = {
          activeSessionCount: 0,
          revokedSessionCount: 0,
        };
        const rejected = await client.query<{
          id: string;
          completed_at: Date;
        }>(
          `
            UPDATE admin_command_executions
            SET
              status = 'rejected',
              result_status = 404,
              result = $4::jsonb,
              error_code = 'USER_NOT_FOUND',
              lease_expires_at = NULL,
              completed_at = statement_timestamp(),
              updated_at = statement_timestamp()
            WHERE id = $1
              AND request_sha256 = $2
              AND status = 'in_progress'
              AND attempt_count = $3
            RETURNING id, completed_at
          `,
          [
            reservation.executionId,
            command.requestSha256,
            reservation.attemptCount,
            JSON.stringify(result),
          ],
        );

        if (!rejected.rows[0]) {
          throw new AdministrationError(
            "COMMAND_ATTEMPT_SUPERSEDED",
            "Операция уже продолжена другой попыткой.",
            409,
          );
        }

        await insertAuditEvent(client, {
          command,
          executionId: reservation.executionId,
          outcome: "rejected",
          errorCode: "USER_NOT_FOUND",
          createdAt: rejected.rows[0].completed_at,
        });
        await client.query("COMMIT");
        transactionOpen = false;

        return {
          state: "rejected",
          errorCode: "USER_NOT_FOUND",
          resultStatus: 404,
        };
      }

      const result = {
        activeSessionCount: 0,
        revokedSessionCount:
          identityResult.revokedSessionCount,
        ...(identityResult.revokedTrackedSessionId
          ? {
              revokedActorSessionId:
                identityResult.revokedTrackedSessionId,
            }
          : {}),
      };
      const completed = await client.query<{
        id: string;
        completed_at: Date;
      }>(
        `
          UPDATE admin_command_executions
          SET
            status = 'succeeded',
            result_status = 200,
            result = $4::jsonb,
            error_code = NULL,
            lease_expires_at = NULL,
            completed_at = statement_timestamp(),
            updated_at = statement_timestamp()
          WHERE id = $1
            AND request_sha256 = $2
            AND status = 'in_progress'
            AND attempt_count = $3
          RETURNING id, completed_at
        `,
        [
          reservation.executionId,
          command.requestSha256,
          reservation.attemptCount,
          JSON.stringify(result),
        ],
      );

      if (!completed.rows[0]) {
        throw new AdministrationError(
          "COMMAND_ATTEMPT_SUPERSEDED",
          "Операция уже продолжена другой попыткой.",
          409,
        );
      }

      await insertAuditEvent(client, {
        command,
        executionId: reservation.executionId,
        outcome: "succeeded",
        beforeState: {
          activeSessionCount:
            identityResult.revokedSessionCount,
        },
        afterState: {
          activeSessionCount: 0,
          revokedSessionCount:
            identityResult.revokedSessionCount,
        },
        createdAt: completed.rows[0].completed_at,
      });
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        state: "succeeded",
        revokedSessionCount:
          identityResult.revokedSessionCount,
        revokedActorSessionId:
          identityResult.revokedTrackedSessionId,
      };
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async recordFailedInternalCommand(
    command: InternalAdminCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode: string,
  ) {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const failed = await client.query<{
        id: string;
        completed_at: Date;
      }>(
        `
          UPDATE admin_command_executions
          SET
            status = 'failed',
            result_status = 500,
            result = '{"completed":false}'::jsonb,
            error_code = $4,
            lease_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
          WHERE id = $1
            AND request_sha256 = $2
            AND status = 'in_progress'
            AND attempt_count = $3
          RETURNING id, completed_at
        `,
        [
          reservation.executionId,
          command.requestSha256,
          reservation.attemptCount,
          errorCode,
        ],
      );
      const failedExecution = failed.rows[0];

      if (failedExecution) {
        await insertAuditEvent(client, {
          command,
          executionId: reservation.executionId,
          outcome: "failed",
          errorCode,
          createdAt: failedExecution.completed_at,
        });
      }

      await client.query("COMMIT");
      transactionOpen = false;
      return Boolean(failedExecution);
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
