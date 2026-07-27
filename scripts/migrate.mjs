import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL не задан");
}

const migrationsDirectory = path.join(
  process.cwd(),
  "db",
  "migrations",
);
const client = new Client({
  connectionString: databaseUrl,
  application_name: "academy-migrations",
});

await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum_sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    "SELECT pg_advisory_lock(hashtext('abrikosoff-academy-migrations'))",
  );

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  for (const name of migrationNames) {
    const sql = await readFile(
      path.join(migrationsDirectory, name),
      "utf8",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "SELECT checksum_sha256 FROM schema_migrations WHERE name = $1",
      [name],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) {
        throw new Error(
          `Миграция ${name} уже применена с другой контрольной суммой`,
        );
      }

      console.log(`Пропуск ${name}: уже применена`);
      continue;
    }

    await client.query("BEGIN");

    try {
      await client.query(sql);
      await client.query(
        `
          INSERT INTO schema_migrations (name, checksum_sha256)
          VALUES ($1, $2)
        `,
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`Применена ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client
    .query(
      "SELECT pg_advisory_unlock(hashtext('abrikosoff-academy-migrations'))",
    )
    .catch(() => undefined);
  await client.end();
}
