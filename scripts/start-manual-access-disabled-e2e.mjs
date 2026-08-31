import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const database = new Client({
  connectionString: databaseUrl,
  application_name: "academy-manual-access-disabled-e2e-seed",
});
const actorId = randomUUID();
const customerId = randomUUID();
const methodId = randomUUID();
const sessionId = randomUUID();
const grantId = randomUUID();
const executionId = randomUUID();
const rawToken = `${randomUUID()}${randomUUID()}`;
const now = new Date();
const periodStart = new Date(now.getTime() - 86_400_000);
const periodEnd = new Date(now.getTime() + 20 * 86_400_000);

await database.connect();
try {
  await database.query("BEGIN");
  await database.query(
    `
      INSERT INTO identity_users (id, display_name, status)
      VALUES ($1, 'Владелец E2E выключенной выдачи', 'active'),
             ($2, 'Ученик E2E выключенной выдачи', 'active')
    `,
    [actorId, customerId],
  );
  await database.query(
    `
      INSERT INTO identity_methods (
        id, user_id, method_type, identifier, verified_at, metadata
      ) VALUES ($1, $2, 'telegram', $3, now(), '{}'::jsonb)
    `,
    [methodId, actorId, `disabled-owner-${actorId}`],
  );
  await database.query(
    `
      INSERT INTO identity_sessions (
        id, user_id, token_sha256, expires_at, authenticated_at,
        authentication_method, authentication_method_id,
        admin_verified_at, admin_verification_method
      ) VALUES (
        $1, $2, $3, now() + interval '1 day', now(),
        'telegram_oidc', $4, now(), 'telegram_oidc'
      )
    `,
    [
      sessionId,
      actorId,
      createHash("sha256").update(rawToken).digest("hex"),
      methodId,
    ],
  );
  await database.query(
    `
      INSERT INTO admin_role_assignments (
        id, user_id, role, status, granted_by_kind, grant_reason
      ) VALUES (
        $1, $2, 'owner', 'active', 'system',
        'Подготовка E2E выключенной ручной выдачи'
      )
    `,
    [randomUUID(), actorId],
  );
  await database.query(
    `
      INSERT INTO admin_command_executions (
        id, principal_key, actor_user_id, action, idempotency_key,
        request_sha256, target_type, target_id, execution_kind,
        status, result_status, result, completed_at
      ) VALUES (
        $1, $2, $3, 'access.manual.grant', $4,
        $5, 'identity_user', $6, 'internal',
        'succeeded', 201, '{"fixture":true}'::jsonb, now()
      )
    `,
    [
      executionId,
      `user:${actorId}`,
      actorId,
      `fixture_${randomUUID().replaceAll("-", "")}`,
      "f".repeat(64),
      customerId,
    ],
  );
  await database.query(
    `
      INSERT INTO access_manual_grants (
        id, customer_id, status, period_start, period_end,
        grant_reason, granted_by_user_id, granted_at,
        command_execution_id
      ) VALUES (
        $1, $2, 'granted', $3, $4,
        'Заранее созданный E2E ручной доступ', $5, $6, $7
      )
    `,
    [
      grantId,
      customerId,
      periodStart,
      periodEnd,
      actorId,
      now,
      executionId,
    ],
  );
  await database.query("COMMIT");
} catch (error) {
  await database.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await database.end();
}

await mkdir(".tmp", { recursive: true });
await writeFile(
  ".tmp/manual-access-disabled-fixture.json",
  JSON.stringify({ actorId, customerId, grantId, rawToken }),
  "utf8",
);

const child = spawn(
  "npm",
  ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3201"],
  { env: process.env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code) => process.exit(code ?? 0));
