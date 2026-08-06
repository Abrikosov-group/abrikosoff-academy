import type { EffectiveAccessRepository } from "./effective-access-repository";
import { AccessConfigurationError } from "../domain/errors";
import {
  createEffectiveAccessDecision,
  resolveCanReadCourses,
  type EffectiveAccessMismatchCode,
  type EffectiveAccessMode,
} from "../domain/effective-access";

export type AccessRolloutConfig = {
  effectiveAccessMode: EffectiveAccessMode;
  manualAccessGrantingEnabled: boolean;
};

type ShadowObservation = {
  reportEvaluationFailure?: (
    error: unknown,
  ) => void | Promise<void>;
  reportMismatch?: (
    code: EffectiveAccessMismatchCode,
  ) => void | Promise<void>;
};

function reportShadowEvaluationFailure(
  reporter: ShadowObservation["reportEvaluationFailure"],
  error: unknown,
) {
  try {
    const report = reporter?.(error);

    if (report) {
      void report.catch(() => undefined);
    }
  } catch {
    // Наблюдаемость shadow не меняет применяемое legacy-решение.
  }
}

export class EffectiveAccessService {
  constructor(
    private readonly repository: EffectiveAccessRepository,
  ) {}

  async getEffectiveAccess(
    userId: string,
    at: Date = new Date(),
  ) {
    if (!Number.isFinite(at.getTime())) {
      throw new TypeError(
        "Момент вычисления доступа должен быть корректной датой.",
      );
    }

    const bases = await this.repository.listActiveBases(userId, at);

    return createEffectiveAccessDecision(at, bases);
  }

  async resolveCourseAccess(input: {
    userId: string;
    at: Date;
    legacyCanReadCourses: boolean;
    config: AccessRolloutConfig;
    observation?: ShadowObservation;
  }) {
    let effectiveAccess;

    try {
      await this.assertRolloutConfiguration(input.config);

      if (input.config.effectiveAccessMode === "legacy") {
        return input.legacyCanReadCourses;
      }

      effectiveAccess = await this.getEffectiveAccess(
        input.userId,
        input.at,
      );
    } catch (error) {
      if (
        input.config.effectiveAccessMode !== "shadow" ||
        error instanceof AccessConfigurationError
      ) {
        throw error;
      }

      reportShadowEvaluationFailure(
        input.observation?.reportEvaluationFailure,
        error,
      );

      return input.legacyCanReadCourses;
    }

    return resolveCanReadCourses({
      mode: input.config.effectiveAccessMode,
      legacyCanReadCourses: input.legacyCanReadCourses,
      effectiveAccess,
      reportMismatch: input.observation?.reportMismatch,
    });
  }

  async assertRolloutConfiguration(config: AccessRolloutConfig) {
    if (
      config.manualAccessGrantingEnabled &&
      config.effectiveAccessMode !== "v2"
    ) {
      throw new AccessConfigurationError(
        "MANUAL_ACCESS_GRANTING_REQUIRES_V2",
        "Выдача ручного доступа разрешена только в режиме v2.",
      );
    }

    if (
      config.effectiveAccessMode !== "legacy" &&
      config.effectiveAccessMode !== "shadow"
    ) {
      return;
    }

    if (await this.repository.hasManualGrantHistory()) {
      throw new AccessConfigurationError(
        "LEGACY_ACCESS_MODE_FORBIDDEN",
        "Режим legacy или shadow запрещён после появления ручного гранта.",
      );
    }
  }
}
