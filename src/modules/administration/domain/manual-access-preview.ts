import { dateTimeLocalToUtcIso } from "./admin-date-time";

export type ManualAccessPreviewPeriod = {
  status: "granted" | "revoked";
  periodStart: string;
  periodEnd: string;
};

export function calculateManualAccessPreview(input: {
  periodStart: string;
  periodEnd: string;
  displayTimeZone: string;
  existingGrants: readonly ManualAccessPreviewPeriod[];
}) {
  const periodStartUtc = dateTimeLocalToUtcIso(
    input.periodStart,
    input.displayTimeZone,
  );
  const periodEndUtc = dateTimeLocalToUtcIso(
    input.periodEnd,
    input.displayTimeZone,
  );
  const startTime = Date.parse(periodStartUtc);
  const endTime = Date.parse(periodEndUtc);

  return {
    periodStartUtc,
    periodEndUtc,
    durationMilliseconds: endTime - startTime,
    overlapCount: input.existingGrants.filter(
      (grant) =>
        grant.status === "granted" &&
        Date.parse(grant.periodStart) < endTime &&
        Date.parse(grant.periodEnd) > startTime,
    ).length,
  };
}
