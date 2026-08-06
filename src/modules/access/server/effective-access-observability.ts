import "server-only";

import { logUnexpectedServerError } from "@/lib/safe-server-log";
import type { EffectiveAccessMismatchCode } from "../domain/effective-access";

export function reportEffectiveAccessShadowMismatch(
  code: EffectiveAccessMismatchCode,
) {
  console.info(
    JSON.stringify({
      level: "info",
      event: "access.effective_access_shadow_mismatch",
      metric: "effective_access_shadow_mismatch_total",
      increment: 1,
      code,
    }),
  );
}

export function reportEffectiveAccessShadowEvaluationFailure(
  error: unknown,
) {
  logUnexpectedServerError(
    "access.effective_access_shadow_evaluation_failed",
    error,
  );
}
