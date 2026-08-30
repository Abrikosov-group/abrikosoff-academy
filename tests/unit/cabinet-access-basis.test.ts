import { describe, expect, it } from "vitest";
import { summarizeCabinetAccessBases } from "@/app/dashboard/_lib/cabinet-access-basis";

describe("основания доступа в кабинете", () => {
  it("сохраняет отдельный максимальный срок каждого применённого источника", () => {
    expect(
      summarizeCabinetAccessBases({
        evaluatedAt: "2040-08-30T12:00:00.000Z",
        canReadCourses: true,
        activePeriod: {
          start: "2040-07-01T00:00:00.000Z",
          end: "2040-11-01T00:00:00.000Z",
        },
        activeBases: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            source: "manual",
            periodStart: "2040-08-01T00:00:00.000Z",
            periodEnd: "2040-09-01T00:00:00.000Z",
          },
          {
            id: "20000000-0000-4000-8000-000000000002",
            source: "manual",
            periodStart: "2040-08-15T00:00:00.000Z",
            periodEnd: "2040-10-01T00:00:00.000Z",
          },
          {
            id: "20000000-0000-4000-8000-000000000003",
            source: "paid",
            planId: "annual",
            periodStart: "2040-07-01T00:00:00.000Z",
            periodEnd: "2040-11-01T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual({
      manualPeriodEnd: "2040-10-01T00:00:00.000Z",
      paidPeriodEnd: "2040-11-01T00:00:00.000Z",
    });
  });

  it("не придумывает источник для legacy или shadow-решения", () => {
    expect(summarizeCabinetAccessBases(null)).toEqual({
      manualPeriodEnd: null,
      paidPeriodEnd: null,
    });
  });
});
