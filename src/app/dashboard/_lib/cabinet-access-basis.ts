import type {
  EffectiveAccessBasis,
  EffectiveAccessDecision,
} from "@/modules/access/domain/effective-access";

function latestPeriodEnd(
  access: EffectiveAccessDecision | null,
  source: EffectiveAccessBasis["source"],
) {
  return (
    access?.activeBases
      .filter((basis) => basis.source === source)
      .map((basis) => basis.periodEnd)
      .reduce<string | null>(
        (latest, current) =>
          !latest || Date.parse(current) > Date.parse(latest)
            ? current
            : latest,
        null,
      ) ?? null
  );
}

export function summarizeCabinetAccessBases(
  access: EffectiveAccessDecision | null,
) {
  return {
    manualPeriodEnd: latestPeriodEnd(access, "manual"),
    paidPeriodEnd: latestPeriodEnd(access, "paid"),
  };
}
