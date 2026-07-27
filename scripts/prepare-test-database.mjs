import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const defaultTestDatabaseUrl =
  "postgresql://academy:academy-local-only@127.0.0.1:5432/academy_test";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL?.trim() || defaultTestDatabaseUrl;
const parsedUrl = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

if (!/^[a-z0-9_]+_test$/i.test(databaseName)) {
  throw new Error(
    "TEST_DATABASE_URL должен указывать на отдельную базу с суффиксом _test",
  );
}

if (
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL === testDatabaseUrl
) {
  throw new Error(
    "TEST_DATABASE_URL не должен совпадать с основной DATABASE_URL",
  );
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureTestDatabase() {
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Client({
    connectionString: adminUrl.toString(),
    application_name: "academy-test-database-setup",
  });

  await admin.connect();

  try {
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );

    if (!existing.rowCount) {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await admin.end();
  }
}

async function resetTestDatabase() {
  const client = new Client({
    connectionString: testDatabaseUrl,
    application_name: "academy-test-database-reset",
  });

  await client.connect();

  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

function runMigrations() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `Миграции тестовой базы остановлены сигналом ${signal}`
            : `Миграции тестовой базы завершились с кодом ${code}`,
        ),
      );
    });
  });
}

await ensureTestDatabase();
await resetTestDatabase();
await runMigrations();

console.log(`Тестовая база ${databaseName} подготовлена`);
