import { describe, expect, it, vi } from "vitest";
import {
  createEffectiveAccessDecision,
  resolveCanReadCourses,
  type EffectiveAccessBasis,
} from "@/modules/access/domain/effective-access";

const at = new Date("2040-08-30T12:00:00.000Z");
const paidBasis: EffectiveAccessBasis = {
  id: "10000000-0000-4000-8000-000000000001",
  source: "paid",
  planId: "monthly",
  periodStart: "2040-08-01T00:00:00.000Z",
  periodEnd: "2040-09-01T00:00:00.000Z",
};
const manualBasis: EffectiveAccessBasis = {
  id: "10000000-0000-4000-8000-000000000002",
  source: "manual",
  periodStart: "2040-08-15T00:00:00.000Z",
  periodEnd: "2040-10-01T00:00:00.000Z",
};

describe("решение эффективного доступа", () => {
  it("возвращает действующие основания и общий непрерывный период", () => {
    expect(
      createEffectiveAccessDecision(at, [manualBasis, paidBasis]),
    ).toEqual({
      evaluatedAt: at.toISOString(),
      canReadCourses: true,
      activePeriod: {
        start: paidBasis.periodStart,
        end: manualBasis.periodEnd,
      },
      activeBases: [paidBasis, manualBasis],
    });
  });

  it("возвращает закрытое решение без оснований", () => {
    expect(createEffectiveAccessDecision(at, [])).toEqual({
      evaluatedAt: at.toISOString(),
      canReadCourses: false,
      activePeriod: null,
      activeBases: [],
    });
  });

  it("в shadow применяет прежнее решение и сообщает только безопасный код", () => {
    const reportMismatch = vi.fn();
    const effectiveAccess = createEffectiveAccessDecision(at, [
      manualBasis,
    ]);

    expect(
      resolveCanReadCourses({
        mode: "shadow",
        legacyCanReadCourses: false,
        effectiveAccess,
        reportMismatch,
      }),
    ).toBe(false);
    expect(reportMismatch).toHaveBeenCalledWith(
      "EFFECTIVE_ACCESS_V2_ONLY",
    );
    expect(reportMismatch).toHaveBeenCalledTimes(1);
  });

  it("не создаёт shadow-сигнал при совпадающих решениях", () => {
    const reportMismatch = vi.fn();

    expect(
      resolveCanReadCourses({
        mode: "shadow",
        legacyCanReadCourses: true,
        effectiveAccess: createEffectiveAccessDecision(at, [
          paidBasis,
        ]),
        reportMismatch,
      }),
    ).toBe(true);
    expect(reportMismatch).not.toHaveBeenCalled();
  });

  it("различает безопасным кодом legacy-only несовпадение", () => {
    const reportMismatch = vi.fn();

    expect(
      resolveCanReadCourses({
        mode: "shadow",
        legacyCanReadCourses: true,
        effectiveAccess: createEffectiveAccessDecision(at, []),
        reportMismatch,
      }),
    ).toBe(true);
    expect(reportMismatch).toHaveBeenCalledWith(
      "EFFECTIVE_ACCESS_LEGACY_ONLY",
    );
  });

  it("в shadow сохраняет прежнее решение при ошибке необязательного отчёта", () => {
    const reportMismatch = vi.fn(() => {
      throw new Error("Сбой отправки shadow-метрики");
    });

    expect(
      resolveCanReadCourses({
        mode: "shadow",
        legacyCanReadCourses: true,
        effectiveAccess: createEffectiveAccessDecision(at, []),
        reportMismatch,
      }),
    ).toBe(true);
    expect(reportMismatch).toHaveBeenCalledWith(
      "EFFECTIVE_ACCESS_LEGACY_ONLY",
    );
    expect(reportMismatch).toHaveBeenCalledTimes(1);
  });

  it("в аварийном режиме добавляет только ручное основание к прежнему paid", () => {
    expect(
      resolveCanReadCourses({
        mode: "legacy_paid_plus_manual",
        legacyCanReadCourses: false,
        effectiveAccess: createEffectiveAccessDecision(at, [
          paidBasis,
        ]),
      }),
    ).toBe(false);
    expect(
      resolveCanReadCourses({
        mode: "legacy_paid_plus_manual",
        legacyCanReadCourses: false,
        effectiveAccess: createEffectiveAccessDecision(at, [
          manualBasis,
        ]),
      }),
    ).toBe(true);
  });

  it("разделяет legacy и v2 без неявного смешивания", () => {
    const effectiveAccess = createEffectiveAccessDecision(at, []);

    expect(
      resolveCanReadCourses({
        mode: "legacy",
        legacyCanReadCourses: true,
        effectiveAccess,
      }),
    ).toBe(true);
    expect(
      resolveCanReadCourses({
        mode: "v2",
        legacyCanReadCourses: true,
        effectiveAccess,
      }),
    ).toBe(false);
  });
});
