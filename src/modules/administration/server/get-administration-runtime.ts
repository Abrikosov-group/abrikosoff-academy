import "server-only";

import { getDatabasePool } from "@/lib/database";
import { PostgresManualAccessAdministrationRepository } from "@/modules/access/infrastructure/postgres-manual-access-administration-repository";
import { getAccessConfig } from "@/modules/access/server/access-config";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";
import { PostgresIdentityAdministrationRepository } from "@/modules/identity/infrastructure/postgres-identity-administration-repository";
import { AdministrationDashboardReadService } from "../application/administration-dashboard-read-service";
import { AdministrationAccessReadService } from "../application/administration-access-read-service";
import { ChangeUserStatusService } from "../application/change-user-status-service";
import {
  GrantManualAccessService,
  RevokeManualAccessService,
} from "../application/manual-access-service";
import { RevokeUserSessionsService } from "../application/revoke-user-sessions-service";
import { AdministrationService } from "../application/administration-service";
import { AdministrationStudentReadService } from "../application/administration-student-read-service";
import { PostgresAdministrationDashboardReadRepository } from "../infrastructure/postgres-administration-dashboard-read-repository";
import { PostgresAdministrationAccessReadRepository } from "../infrastructure/postgres-administration-access-read-repository";
import { PostgresAdministrationCommandRepository } from "../infrastructure/postgres-administration-command-repository";
import { PostgresAdministrationRepository } from "../infrastructure/postgres-administration-repository";
import { PostgresAdministrationStudentReadRepository } from "../infrastructure/postgres-administration-student-read-repository";
import { getAdministrationConfig } from "./administration-config";

export function getAdministrationRuntime() {
  const config = getAdministrationConfig();
  const identityConfig = getIdentityConfig();
  const pool = getDatabasePool();
  const repository = new PostgresAdministrationRepository(pool);
  const accessConfig = getAccessConfig();
  const manualAccessRepository =
    new PostgresManualAccessAdministrationRepository();
  const identityAdministrationRepository =
    new PostgresIdentityAdministrationRepository();
  const commandRepository =
    new PostgresAdministrationCommandRepository(
      pool,
      identityAdministrationRepository,
      identityAdministrationRepository,
      manualAccessRepository,
    );
  const dashboardReadRepository =
    new PostgresAdministrationDashboardReadRepository(pool);
  const accessReadRepository =
    new PostgresAdministrationAccessReadRepository(pool);
  const studentReadRepository =
    new PostgresAdministrationStudentReadRepository(pool);

  return {
    accessReadRepository,
    accessReadService: new AdministrationAccessReadService(
      accessReadRepository,
    ),
    config,
    changeUserStatusService: new ChangeUserStatusService(
      commandRepository,
    ),
    commandRepository,
    dashboardReadRepository,
    dashboardReadService: new AdministrationDashboardReadService(
      dashboardReadRepository,
    ),
    grantManualAccessService: new GrantManualAccessService(
      commandRepository,
      accessConfig,
    ),
    repository,
    revokeUserSessionsService: new RevokeUserSessionsService(
      commandRepository,
    ),
    revokeManualAccessService: new RevokeManualAccessService(
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
