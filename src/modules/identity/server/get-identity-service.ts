import "server-only";

import { IdentityService } from "../application/identity-service";
import { PostgresIdentityRepository } from "../infrastructure/postgres-identity-repository";
import { getDatabasePool } from "@/lib/database";
import { getIdentityConfig } from "./identity-config";

export function getIdentityRuntime() {
  const config = getIdentityConfig();
  const repository = new PostgresIdentityRepository(getDatabasePool());

  return {
    config,
    repository,
    service: new IdentityService(repository, config.sessionTtlDays),
  };
}
