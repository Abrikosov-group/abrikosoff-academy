import "server-only";

import { getDatabasePool } from "@/lib/database";
import { EffectiveAccessService } from "../application/effective-access-service";
import { PostgresEffectiveAccessRepository } from "../infrastructure/postgres-effective-access-repository";
import { getAccessConfig } from "./access-config";

export function getEffectiveAccessRuntime() {
  const config = getAccessConfig();
  const repository = new PostgresEffectiveAccessRepository(
    getDatabasePool(),
  );

  return {
    config,
    repository,
    service: new EffectiveAccessService(repository),
  };
}

export async function getEffectiveAccess(
  userId: string,
  at: Date = new Date(),
) {
  const runtime = getEffectiveAccessRuntime();

  await runtime.service.assertRolloutConfiguration(runtime.config);

  return runtime.service.getEffectiveAccess(userId, at);
}

export async function validateEffectiveAccessConfiguration() {
  const runtime = getEffectiveAccessRuntime();

  await runtime.service.assertRolloutConfiguration(runtime.config);
}
