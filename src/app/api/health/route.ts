import {
  getDatabasePool,
  hasDatabaseConfiguration,
} from "@/lib/database";
import { logUnexpectedServerError } from "@/lib/safe-server-log";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    getAdministrationConfig();

    if (hasDatabaseConfiguration()) {
      await getDatabasePool().query("SELECT 1");
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL не задан");
    }

    return Response.json(
      {
        status: "ok",
        service: "abrikosoff-academy",
        version: process.env.APP_VERSION ?? "development",
        database: hasDatabaseConfiguration() ? "ok" : "not-configured",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logUnexpectedServerError("health.dependencies_unavailable", error);

    return Response.json(
      {
        status: "unavailable",
        service: "abrikosoff-academy",
        version: process.env.APP_VERSION ?? "development",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
