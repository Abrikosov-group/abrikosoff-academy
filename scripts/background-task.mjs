#!/usr/bin/env node

import pg from "pg";
import { purgeIdentitySessionTechnicalData } from "./lib/identity-session-retention.mjs";

const { Client } = pg;
const taskName = "purge-identity-session-technical-data";
const startedAt = Date.now();
const requestedTask = process.argv[2];
let client;

function writeResult(payload) {
  process.stdout.write(
    `${JSON.stringify({
      event: "background_task.completed",
      task: taskName,
      durationMs: Date.now() - startedAt,
      ...payload,
    })}\n`,
  );
}

try {
  if (process.argv.length !== 3 || requestedTask !== taskName) {
    throw new Error("BACKGROUND_TASK_NOT_ALLOWED");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("BACKGROUND_TASK_DATABASE_NOT_CONFIGURED");
  }

  client = new Client({
    connectionString: databaseUrl,
    application_name: `academy-background-${taskName}`,
  });
  await client.connect();

  const lock = await client.query(
    `
      SELECT pg_try_advisory_lock(
        hashtext('abrikosoff-academy'),
        hashtext($1)
      ) AS acquired
    `,
    [taskName],
  );

  if (!lock.rows[0]?.acquired) {
    writeResult({ processed: 0, skipped: "lock_busy" });
  } else {
    const processed =
      await purgeIdentitySessionTechnicalData(client);
    writeResult({ processed });
  }
} catch {
  process.stderr.write(
    `${JSON.stringify({
      event: "background_task.failed",
      task:
        requestedTask === taskName
          ? taskName
          : "unknown",
      durationMs: Date.now() - startedAt,
      errorCode: "BACKGROUND_TASK_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => undefined);
}
