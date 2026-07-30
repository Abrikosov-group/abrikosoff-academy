import "server-only";

import { getDatabasePool } from "@/lib/database";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";
import { PostgresIdentityAdministrationRepository } from "@/modules/identity/infrastructure/postgres-identity-administration-repository";
import { AdministrationDashboardReadService } from "../application/administration-dashboard-read-service";
import { RevokeUserSessionsService } from "../application/revoke-user-sessions-service";
import { AdministrationService } from "../application/administration-service";
import { AdministrationStudentReadService } from "../application/administration-student-read-service";
import { PostgresAdministrationDashboardReadRepository } from "../infrastructure/postgres-administration-dashboard-read-repository";
import { PostgresAdministrationCommandRepository } from "../infrastructure/postgres-administration-command-repository";
import { PostgresAdministrationRepository } from "../infrastructure/postgres-administration-repository";
import { PostgresAdministrationStudentReadRepository } from "../infrastructure/postgres-administration-student-read-repository";
import { getAdministrationConfig } from "./administration-config";

export function getAdministrationRuntime() {
  const config = getAdministrationConfig();
  const identityConfig = getIdentityConfig();
  const pool = getDatabasePool();
  const repository = new PostgresAdministrationRepository(pool);
  const identityAdministrationRepository =
    new PostgresIdentityAdministrationRepository();
  const commandRepository =
    new PostgresAdministrationCommandRepository(
      pool,
      identityAdministrationRepository,
    );
  const dashboardReadRepository =
    new PostgresAdministrationDashboardReadRepository(pool);
  const studentReadRepository =
    new PostgresAdministrationStudentReadRepository(pool);

  return {
    config,
    commandRepository,
    dashboardReadRepository,
    dashboardReadService: new AdministrationDashboardReadService(
      dashboardReadRepository,
    ),
    repository,
    revokeUserSessionsService: new RevokeUserSessionsService(
      commandRepository,
    ),
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
