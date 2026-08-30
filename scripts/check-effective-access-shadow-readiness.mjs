import pg from "pg";
import {
  EffectiveAccessShadowReadinessError,
  inspectEffectiveAccessShadowReadiness,
  readEffectiveAccessShadowConfiguration,
} from "./lib/effective-access-shadow-readiness.mjs";

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new EffectiveAccessShadowReadinessError(
      "DATABASE_URL_REQUIRED",
      "DATABASE_URL не задан.",
    );
  }

  const configuration = readEffectiveAccessShadowConfiguration(
    process.env,
  );
  const pool = new Pool({
    connectionString,
    application_name: "academy-effective-access-shadow-readiness",
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  let client;

  try {
    client = await pool.connect();
    const report = await inspectEffectiveAccessShadowReadiness(
      client,
      configuration,
    );

    process.stdout.write(`${JSON.stringify(report)}\n`);

    if (report.status !== "ready") {
      process.exitCode = 1;
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      code:
        error instanceof EffectiveAccessShadowReadinessError
          ? error.code
          : "SHADOW_READINESS_CHECK_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
