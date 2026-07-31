import type { EffectiveAccessBasis } from "../domain/effective-access";

export interface EffectiveAccessRepository {
  listActiveBases(
    userId: string,
    at: Date,
  ): Promise<readonly EffectiveAccessBasis[]>;
  hasManualGrantHistory(): Promise<boolean>;
}
