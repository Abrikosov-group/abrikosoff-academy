import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { IdentityAdministrationRepository } from "@/modules/identity/application/identity-administration-repository";
import type { IdentityUserStatusAdministrationRepository } from "@/modules/identity/application/identity-user-status-administration-repository";
import type {
  AdminCommandInspection,
  AdminCommandReservation,
  AdministrationCommandRepository,
  ChangeUserStatusCommand,
  ChangeUserStatusExecution,
  GrantManualAccessCommand,
  GrantManualAccessExecution,
  InternalAdminCommand,
  RevokeManualAccessCommand,
  RevokeManualAccessExecution,
  RevokeUserSessionsExecution,
} from "../application/administration-command-repository";
import type { ManualAccessAdministrationRepository } from "@/modules/access/application/manual-access-administration-repository";
import { EffectiveAccessService } from "@/modules/access/application/effective-access-service";
import { PostgresEffectiveAccessRepository } from "@/modules/access/infrastructure/postgres-effective-access-repository";
import { PostgresManualAccessAdministrationRepository } from "@/modules/access/infrastructure/postgres-manual-access-administration-repository";
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

async function rejectChangeUserStatusCommand(
  client: PoolClient,
  input: {
    command: ChangeUserStatusCommand;
    reservation: {
      executionId: string;
      attemptCount: number;
    };
    errorCode:
      | "USER_NOT_FOUND"
      | "USER_STATUS_TRANSITION_INVALID"
      | "LAST_AVAILABLE_OWNER";
    resultStatus: 404 | 409;
    beforeState?: Record<string, unknown>;
  },
): Promise<ChangeUserStatusExecution> {
  const rejected = await client.query<{
    id: string;
    completed_at: Date;
  }>(
    `
      UPDATE admin_command_executions
      SET
        status = 'rejected',
        result_status = $4,
        result = '{"completed":false}'::jsonb,
        error_code = $5,
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
      input.reservation.executionId,
      input.command.requestSha256,
      input.reservation.attemptCount,
      input.resultStatus,
      input.errorCode,
    ],
  );
  const rejectedExecution = rejected.rows[0];

  if (!rejectedExecution) {
    throw new AdministrationError(
      "COMMAND_ATTEMPT_SUPERSEDED",
      "Операция уже продолжена другой попыткой.",
      409,
    );
  }

  await insertAuditEvent(client, {
    command: input.command,
    executionId: input.reservation.executionId,
    outcome: "rejected",
    errorCode: input.errorCode,
    beforeState: input.beforeState,
    createdAt: rejectedExecution.completed_at,
  });

  return {
    state: "rejected",
    errorCode: input.errorCode,
    resultStatus: input.resultStatus,
  };
}

export class PostgresAdministrationCommandRepository
  implements AdministrationCommandRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly identityRepository: IdentityAdministrationRepository,
    private readonly identityUserStatusRepository: IdentityUserStatusAdministrationRepository,
    private readonly manualAccessRepository: ManualAccessAdministrationRepository =
      new PostgresManualAccessAdministrationRepository(),
  ) {}

  async inspectInternalCommand(
    command: InternalAdminCommand,
  ): Promise<AdminCommandInspection> {
    const result = await this.pool.query<CommandExecutionRow>(
      `
        SELECT
          id,
          request_sha256,
          status,
          result_status,
          result,
          error_code,
          lease_expires_at > statement_timestamp() AS lease_is_live,
          attempt_count
        FROM admin_command_executions
        WHERE principal_key = $1
          AND action = $2
          AND idempotency_key = $3
      `,
      [command.principalKey, command.action, command.idempotencyKey],
    );
    const existing = result.rows[0];

    if (result.rows.length > 1) {
      return { state: "conflict" };
    }

    if (!existing) {
      return { state: "missing" };
    }

    if (existing.request_sha256 !== command.requestSha256) {
      return { state: "conflict" };
    }

    if (
      existing.status === "succeeded" ||
      existing.status === "rejected" ||
      existing.status === "failed"
    ) {
      if (existing.result_status === null) {
        throw new TypeError(
          "Терминальное исполнение команды не содержит HTTP-статус.",
        );
      }

      return {
        state: "replayed",
        executionId: existing.id,
        status: existing.status,
        resultStatus: existing.result_status,
        result: existing.result,
        errorCode: existing.error_code ?? undefined,
      };
    }

    return existing.lease_is_live
      ? { state: "in_progress" }
      : { state: "recoverable" };
  }

  async reserveInternalCommand(
    command: InternalAdminCommand,
  ): Promise<AdminCommandReservation> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        `
          SELECT pg_advisory_xact_lock(
            hashtextextended($1, 0)
          )
        `,
        [
          JSON.stringify([
            command.principalKey,
            command.action,
            command.idempotencyKey,
          ]),
        ],
      );
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
        existing.rows.length > 1 ||
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

  async executeChangeUserStatus(
    command: ChangeUserStatusCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<ChangeUserStatusExecution> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const execution = await client.query<{ id: string }>(
        `
          SELECT id
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

      if (command.statusAction === "block") {
        const invariantLock = await client.query<{ name: string }>(
          `
            SELECT name
            FROM admin_invariant_locks
            WHERE name = 'active_owner'
            FOR UPDATE
          `,
        );

        if (!invariantLock.rows[0]) {
          throw new TypeError(
            "Защитный lock доступного владельца не найден.",
          );
        }
      }

      const lockedUser =
        await this.identityUserStatusRepository.lockUsersForStatusChange(
          client,
          {
            actorUserId: command.actorUserId,
            userId: command.targetId,
          },
        );

      if (!lockedUser.userExists) {
        const result = await rejectChangeUserStatusCommand(
          client,
          {
            command,
            reservation,
            errorCode: "USER_NOT_FOUND",
            resultStatus: 404,
          },
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return result;
      }

      if (lockedUser.status === "deleted") {
        const result = await rejectChangeUserStatusCommand(
          client,
          {
            command,
            reservation,
            errorCode: "USER_STATUS_TRANSITION_INVALID",
            resultStatus: 409,
            beforeState: {
              status: lockedUser.status,
            },
          },
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return result;
      }

      const previousStatus = lockedUser.status;

      if (
        command.statusAction === "block" &&
        previousStatus === "active"
      ) {
        const ownerState = await client.query<{
          target_is_owner: boolean;
          available_owner_count: number;
        }>(
          `
            SELECT
              EXISTS (
                SELECT 1
                FROM admin_role_assignments target_role
                WHERE target_role.user_id = $1
                  AND target_role.role = 'owner'
                  AND target_role.status = 'active'
              ) AS target_is_owner,
              (
                SELECT count(
                  DISTINCT available_role.user_id
                )::integer
                FROM admin_role_assignments available_role
                JOIN identity_users available_user
                  ON available_user.id =
                    available_role.user_id
                WHERE available_role.role = 'owner'
                  AND available_role.status = 'active'
                  AND available_user.status = 'active'
              ) AS available_owner_count
          `,
          [command.targetId],
        );
        const state = ownerState.rows[0];

        if (!state) {
          throw new TypeError(
            "Не удалось проверить число доступных владельцев.",
          );
        }

        if (
          state.target_is_owner &&
          state.available_owner_count <= 1
        ) {
          const result = await rejectChangeUserStatusCommand(
            client,
            {
              command,
              reservation,
              errorCode: "LAST_AVAILABLE_OWNER",
              resultStatus: 409,
              beforeState: {
                status: previousStatus,
              },
            },
          );
          await client.query("COMMIT");
          transactionOpen = false;
          return result;
        }
      }

      const mutationTime = await client.query<{
        changed_at: Date;
      }>(
        `
          SELECT statement_timestamp() AS changed_at
        `,
      );
      const changedAt = mutationTime.rows[0]?.changed_at;

      if (!changedAt) {
        throw new TypeError(
          "Не удалось зафиксировать время изменения состояния.",
        );
      }

      const identityResult =
        await this.identityUserStatusRepository.applyUserStatusChange(
          client,
          {
            userId: command.targetId,
            previousStatus,
            targetStatus: command.targetStatus,
            changedAt,
            ...(command.statusAction === "block" &&
            command.actorUserId === command.targetId
              ? {
                  trackedSessionId:
                    command.actorSessionId,
                }
              : {}),
          },
        );
      const result = {
        previousStatus,
        currentStatus: command.targetStatus,
        statusChanged: identityResult.statusChanged,
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
          status: previousStatus,
          ...(command.statusAction === "block" ||
          previousStatus === "blocked"
            ? {
                activeSessionCount:
                  identityResult.revokedSessionCount,
              }
            : {}),
        },
        afterState: {
          status: command.targetStatus,
          statusChanged: identityResult.statusChanged,
          ...(command.statusAction === "block" ||
          previousStatus === "blocked"
            ? {
                activeSessionCount: 0,
                revokedSessionCount:
                  identityResult.revokedSessionCount,
              }
            : {}),
        },
        createdAt: completed.rows[0].completed_at,
      });
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        state: "succeeded",
        ...result,
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

  async executeGrantManualAccess(
    command: GrantManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<GrantManualAccessExecution> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 2147483647))",
        [command.customerId],
      );
      const user = await client.query<{ status: string }>(
        `
          SELECT status
          FROM identity_users
          WHERE id = $1
          FOR UPDATE
        `,
        [command.customerId],
      );
      const execution = await client.query<{
        id: string;
        executed_at: Date;
      }>(
        `
          SELECT id, statement_timestamp() AS executed_at
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

      if (!user.rows[0] || user.rows[0].status === "deleted") {
        const rejected = await this.rejectManualAccessCommandInTransaction(
          client,
          command,
          reservation,
          "USER_NOT_FOUND",
          404,
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return rejected as GrantManualAccessExecution;
      }

      const at = activeExecution.executed_at;
      if (new Date(command.periodEnd).getTime() <= at.getTime()) {
        const rejected = await this.rejectManualAccessCommandInTransaction(
          client,
          command,
          reservation,
          "ADMIN_COMMAND_INVALID_REQUEST",
          400,
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return rejected as GrantManualAccessExecution;
      }
      const effectiveAccessService = new EffectiveAccessService(
        new PostgresEffectiveAccessRepository(client),
      );
      const beforeEffectiveAccess =
        await effectiveAccessService.getEffectiveAccess(
          command.customerId,
          at,
        );
      const periodStart = new Date(command.periodStart);
      const periodEnd = new Date(command.periodEnd);
      const overlapCount =
        await this.manualAccessRepository.countOverlaps(client, {
          customerId: command.customerId,
          periodStart,
          periodEnd,
        });
      const grantId = randomUUID();

      await this.manualAccessRepository.insertGrant(client, {
        id: grantId,
        customerId: command.customerId,
        periodStart,
        periodEnd,
        reason: command.reason,
        actorUserId: command.actorUserId,
        grantedAt: at,
        commandExecutionId: reservation.executionId,
      });
      const effectiveAccess =
        await effectiveAccessService.getEffectiveAccess(
          command.customerId,
          at,
        );
      const result = {
        grantId,
        customerId: command.customerId,
        status: "granted" as const,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        grantedAt: at.toISOString(),
        overlapCount,
        effectiveAccess,
      };
      const completed = await client.query<{ completed_at: Date }>(
        `
          UPDATE admin_command_executions
          SET
            status = 'succeeded',
            result_status = 201,
            result = $4::jsonb,
            error_code = NULL,
            lease_expires_at = NULL,
            completed_at = statement_timestamp(),
            updated_at = statement_timestamp()
          WHERE id = $1
            AND request_sha256 = $2
            AND status = 'in_progress'
            AND attempt_count = $3
          RETURNING completed_at
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
        command: {
          ...command,
          targetType: "access_manual_grant",
          targetId: grantId,
        },
        executionId: reservation.executionId,
        outcome: "succeeded",
        beforeState: {
          effectiveAccess: beforeEffectiveAccess,
          overlapCount,
        },
        afterState: {
          status: "granted",
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
          effectiveAccess,
        },
        createdAt: completed.rows[0].completed_at,
      });
      await client.query("COMMIT");
      transactionOpen = false;
      return { state: "succeeded", ...result };
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async executeRevokeManualAccess(
    command: RevokeManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
  ): Promise<RevokeManualAccessExecution> {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 2147483647))",
        [command.customerId],
      );
      const grant = await this.manualAccessRepository.lockGrant(
        client,
        command.grantId,
      );
      const execution = await client.query<{
        id: string;
        executed_at: Date;
      }>(
        `
          SELECT id, statement_timestamp() AS executed_at
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

      if (!grant || grant.customerId !== command.customerId) {
        const rejected = await this.rejectManualAccessCommandInTransaction(
          client,
          command,
          reservation,
          "MANUAL_ACCESS_GRANT_NOT_FOUND",
          404,
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return rejected as RevokeManualAccessExecution;
      }

      if (grant.status === "revoked") {
        const rejected = await this.rejectManualAccessCommandInTransaction(
          client,
          command,
          reservation,
          "MANUAL_ACCESS_GRANT_ALREADY_REVOKED",
          409,
          { status: "revoked" },
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return rejected as RevokeManualAccessExecution;
      }

      const at = activeExecution.executed_at;
      const effectiveAccessService = new EffectiveAccessService(
        new PostgresEffectiveAccessRepository(client),
      );
      const beforeEffectiveAccess =
        await effectiveAccessService.getEffectiveAccess(
          command.customerId,
          at,
        );
      await this.manualAccessRepository.revokeGrant(client, {
        grantId: command.grantId,
        actorUserId: command.actorUserId,
        reason: command.reason,
        revokedAt: at,
      });
      const effectiveAccess =
        await effectiveAccessService.getEffectiveAccess(
          command.customerId,
          at,
        );
      const result = {
        grantId: command.grantId,
        customerId: command.customerId,
        status: "revoked" as const,
        revokedAt: at.toISOString(),
        effectiveAccess,
      };
      const completed = await client.query<{ completed_at: Date }>(
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
          RETURNING completed_at
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
          status: grant.status,
          effectiveAccess: beforeEffectiveAccess,
        },
        afterState: {
          status: "revoked",
          revokedAt: result.revokedAt,
          effectiveAccess,
        },
        createdAt: completed.rows[0].completed_at,
      });
      await client.query("COMMIT");
      transactionOpen = false;
      return { state: "succeeded", ...result };
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectManualAccessGrantingGate(
    command: GrantManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode:
      | "MANUAL_ACCESS_GRANTING_DISABLED"
      | "MANUAL_ACCESS_GRANTING_REQUIRES_V2",
  ) {
    const client = await this.pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const rejected = await this.rejectManualAccessCommandInTransaction(
        client,
        command,
        reservation,
        errorCode,
        409,
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return rejected.state === "rejected";
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async rejectManualAccessCommandInTransaction(
    client: PoolClient,
    command: GrantManualAccessCommand | RevokeManualAccessCommand,
    reservation: {
      executionId: string;
      attemptCount: number;
    },
    errorCode:
      | "USER_NOT_FOUND"
      | "MANUAL_ACCESS_GRANT_NOT_FOUND"
      | "MANUAL_ACCESS_GRANT_ALREADY_REVOKED"
      | "MANUAL_ACCESS_GRANTING_DISABLED"
      | "MANUAL_ACCESS_GRANTING_REQUIRES_V2"
      | "ADMIN_COMMAND_INVALID_REQUEST",
    resultStatus: 400 | 404 | 409,
    beforeState?: Record<string, unknown>,
  ): Promise<
    Extract<
      GrantManualAccessExecution | RevokeManualAccessExecution,
      { state: "rejected" }
    >
  > {
    const rejected = await client.query<{ completed_at: Date }>(
      `
        UPDATE admin_command_executions
        SET
          status = 'rejected',
          result_status = $4,
          result = '{"completed":false}'::jsonb,
          error_code = $5,
          lease_expires_at = NULL,
          completed_at = statement_timestamp(),
          updated_at = statement_timestamp()
        WHERE id = $1
          AND request_sha256 = $2
          AND status = 'in_progress'
          AND attempt_count = $3
        RETURNING completed_at
      `,
      [
        reservation.executionId,
        command.requestSha256,
        reservation.attemptCount,
        resultStatus,
        errorCode,
      ],
    );
    const execution = rejected.rows[0];

    if (!execution) {
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
      errorCode,
      beforeState,
      createdAt: execution.completed_at,
    });

    return {
      state: "rejected",
      errorCode,
      resultStatus,
    } as Extract<
      GrantManualAccessExecution | RevokeManualAccessExecution,
      { state: "rejected" }
    >;
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
