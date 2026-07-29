import {
  getDatabasePool,
  hasDatabaseConfiguration,
} from "@/lib/database";
import { logUnexpectedServerError } from "@/lib/safe-server-log";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const hasDatabase = hasDatabaseConfiguration();
  let administration: "ok" | "unavailable" = "ok";
  let database: "ok" | "not-configured" | "unavailable" = hasDatabase
    ? "ok"
    : "not-configured";

  try {
    getAdministrationConfig();
  } catch (error) {
    administration = "unavailable";
    logUnexpectedServerError("health.administration_unavailable", error);
  }

  try {
    if (hasDatabase) {
      await getDatabasePool().query("SELECT 1");
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL не задан");
    }
  } catch (error) {
    database = "unavailable";
    logUnexpectedServerError("health.database_unavailable", error);
  }

  const isAvailable =
    administration === "ok" && database !== "unavailable";

  return Response.json(
    {
      status: isAvailable ? "ok" : "unavailable",
      service: "abrikosoff-academy",
      version: process.env.APP_VERSION ?? "development",
      administration,
      database,
      timestamp: new Date().toISOString(),
    },
    {
      status: isAvailable ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
