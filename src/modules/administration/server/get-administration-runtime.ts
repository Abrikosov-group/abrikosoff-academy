import "server-only";

import { getDatabasePool } from "@/lib/database";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";
import { AdministrationDashboardReadService } from "../application/administration-dashboard-read-service";
import { AdministrationService } from "../application/administration-service";
import { AdministrationStudentReadService } from "../application/administration-student-read-service";
import { PostgresAdministrationDashboardReadRepository } from "../infrastructure/postgres-administration-dashboard-read-repository";
import { PostgresAdministrationRepository } from "../infrastructure/postgres-administration-repository";
import { PostgresAdministrationStudentReadRepository } from "../infrastructure/postgres-administration-student-read-repository";
import { getAdministrationConfig } from "./administration-config";

export function getAdministrationRuntime() {
  const config = getAdministrationConfig();
  const identityConfig = getIdentityConfig();
  const pool = getDatabasePool();
  const repository = new PostgresAdministrationRepository(pool);
  const dashboardReadRepository =
    new PostgresAdministrationDashboardReadRepository(pool);
  const studentReadRepository =
    new PostgresAdministrationStudentReadRepository(pool);

  return {
    config,
    dashboardReadRepository,
    dashboardReadService: new AdministrationDashboardReadService(
      dashboardReadRepository,
    ),
    repository,
    studentReadRepository,
    service: new AdministrationService(repository, {
      mode: config.mode,
      sessionTtlDays: identityConfig.sessionTtlDays,
    }),
    studentReadService: new AdministrationStudentReadService(
      studentReadRepository,
    ),
  };
}
