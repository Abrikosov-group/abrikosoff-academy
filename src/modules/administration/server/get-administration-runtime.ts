import "server-only";

import { getDatabasePool } from "@/lib/database";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";
import { AdministrationService } from "../application/administration-service";
import { PostgresAdministrationRepository } from "../infrastructure/postgres-administration-repository";
import { getAdministrationConfig } from "./administration-config";

export function getAdministrationRuntime() {
  const config = getAdministrationConfig();
  const identityConfig = getIdentityConfig();
  const repository = new PostgresAdministrationRepository(
    getDatabasePool(),
  );

  return {
    config,
    repository,
    service: new AdministrationService(repository, {
      mode: config.mode,
      sessionTtlDays: identityConfig.sessionTtlDays,
    }),
  };
}
