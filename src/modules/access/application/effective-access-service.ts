import type { EffectiveAccessRepository } from "./effective-access-repository";
import {
  createEffectiveAccessDecision,
  type EffectiveAccessMode,
} from "../domain/effective-access";

export type AccessRolloutConfig = {
  effectiveAccessMode: EffectiveAccessMode;
  manualAccessGrantingEnabled: boolean;
};

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

  async assertRolloutConfiguration(config: AccessRolloutConfig) {
    if (
      config.manualAccessGrantingEnabled &&
      config.effectiveAccessMode !== "v2"
    ) {
      throw new TypeError(
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
      throw new TypeError(
        "Режим legacy или shadow запрещён после появления ручного гранта.",
      );
    }
  }
}
