import "server-only";

import { getDatabasePool } from "@/lib/database";
import { EffectiveAccessService } from "../application/effective-access-service";
import { PostgresEffectiveAccessRepository } from "../infrastructure/postgres-effective-access-repository";
import { getAccessConfig } from "./access-config";
import {
  reportEffectiveAccessShadowEvaluationFailure,
  reportEffectiveAccessShadowMismatch,
} from "./effective-access-observability";

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

export async function resolveStudentCourseAccess(input: {
  userId: string;
  at: Date;
  legacyCanReadCourses: boolean;
}) {
  const runtime = getEffectiveAccessRuntime();

  return runtime.service.resolveCourseAccess({
    ...input,
    config: runtime.config,
    observation: {
      reportEvaluationFailure:
        reportEffectiveAccessShadowEvaluationFailure,
      reportMismatch: reportEffectiveAccessShadowMismatch,
    },
  });
}

export async function validateEffectiveAccessConfiguration() {
  const runtime = getEffectiveAccessRuntime();

  await runtime.service.assertRolloutConfiguration(runtime.config);
}
