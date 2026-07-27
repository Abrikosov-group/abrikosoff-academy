import "server-only";

import { Pool } from "pg";
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
