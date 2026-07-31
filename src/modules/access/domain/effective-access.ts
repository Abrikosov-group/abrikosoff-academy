export const effectiveAccessModes = [
  "legacy",
  "shadow",
  "v2",
  "legacy_paid_plus_manual",
] as const;

export type EffectiveAccessMode =
  (typeof effectiveAccessModes)[number];

type AccessBasisCommon = {
  id: string;
  periodStart: string;
  periodEnd: string;
};

export type PaidAccessBasis = AccessBasisCommon & {
  source: "paid";
  planId: "monthly" | "annual";
};

export type ManualAccessBasis = AccessBasisCommon & {
  source: "manual";
};

export type EffectiveAccessBasis =
  | PaidAccessBasis
  | ManualAccessBasis;

export type EffectiveAccessDecision = {
  evaluatedAt: string;
  canReadCourses: boolean;
  activePeriod: {
    start: string;
    end: string;
  } | null;
  activeBases: readonly EffectiveAccessBasis[];
};

export type EffectiveAccessMismatchCode =
  | "EFFECTIVE_ACCESS_LEGACY_ONLY"
  | "EFFECTIVE_ACCESS_V2_ONLY";

function compareBases(
  left: EffectiveAccessBasis,
  right: EffectiveAccessBasis,
) {
  return (
    Date.parse(left.periodEnd) - Date.parse(right.periodEnd) ||
    Date.parse(left.periodStart) - Date.parse(right.periodStart) ||
    left.source.localeCompare(right.source) ||
    left.id.localeCompare(right.id)
  );
}

export function createEffectiveAccessDecision(
  at: Date,
  bases: readonly EffectiveAccessBasis[],
): EffectiveAccessDecision {
  const activeBases = [...bases].sort(compareBases);
  const starts = activeBases.map((basis) => basis.periodStart);
  const ends = activeBases.map((basis) => basis.periodEnd);

  return {
    evaluatedAt: at.toISOString(),
    canReadCourses: activeBases.length > 0,
    activePeriod:
      activeBases.length === 0
        ? null
        : {
            start: starts.reduce((earliest, current) =>
              Date.parse(current) < Date.parse(earliest)
                ? current
                : earliest,
            ),
            end: ends.reduce((latest, current) =>
              Date.parse(current) > Date.parse(latest)
                ? current
                : latest,
            ),
          },
    activeBases,
  };
}

export function resolveCanReadCourses(input: {
  mode: EffectiveAccessMode;
  legacyCanReadCourses: boolean;
  effectiveAccess: EffectiveAccessDecision;
  reportMismatch?: (
    code: EffectiveAccessMismatchCode,
  ) => void | Promise<void>;
}) {
  const manualAccess = input.effectiveAccess.activeBases.some(
    (basis) => basis.source === "manual",
  );

  if (input.mode === "legacy") {
    return input.legacyCanReadCourses;
  }

  if (input.mode === "shadow") {
    if (
      input.legacyCanReadCourses !==
      input.effectiveAccess.canReadCourses
    ) {
      try {
        const report = input.reportMismatch?.(
          input.legacyCanReadCourses
            ? "EFFECTIVE_ACCESS_LEGACY_ONLY"
            : "EFFECTIVE_ACCESS_V2_ONLY",
        );
        if (report) {
          // Shadow-диагностика не должна создавать необработанное отклонение.
          void report.catch(() => undefined);
        }
      } catch {
        // Shadow-диагностика не должна изменять применяемое legacy-решение.
      }
    }

    return input.legacyCanReadCourses;
  }

  if (input.mode === "legacy_paid_plus_manual") {
    return input.legacyCanReadCourses || manualAccess;
  }

  return input.effectiveAccess.canReadCourses;
}
