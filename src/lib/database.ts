import "server-only";

import { Pool, type PoolClient } from "pg";
import { logUnexpectedServerError } from "./safe-server-log";

let databasePool: Pool | null = null;

export function hasDatabaseConfiguration() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDatabasePool() {
  if (databasePool) {
    return databasePool;
  }

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL не задан");
  }

  databasePool = new Pool({
    connectionString,
    application_name: "abrikosoff-academy",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  databasePool.on("error", (error) => {
    logUnexpectedServerError("database.pool_error", error);
  });

  return databasePool;
}

export async function withDatabaseReadSnapshot<T>(
  pool: Pool,
  operation: (
    client: PoolClient,
    evaluatedAt: Date,
  ) => Promise<T>,
) {
  const client = await pool.connect();
  let transactionStarted = false;
  let connectionBroken = false;

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionStarted = true;

    const timestamp = await client.query<{
      evaluated_at: Date;
    }>("SELECT clock_timestamp() AS evaluated_at");
    const evaluatedAt = timestamp.rows[0]?.evaluated_at;

    if (!(evaluatedAt instanceof Date)) {
      throw new Error(
        "PostgreSQL не вернул время снимка данных.",
      );
    }

    const result = await operation(client, evaluatedAt);

    await client.query("COMMIT");
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        connectionBroken = true;
        logUnexpectedServerError(
          "database.read_snapshot_rollback_error",
          rollbackError,
        );
      }
    }

    throw error;
  } finally {
    client.release(connectionBroken);
  }
}
