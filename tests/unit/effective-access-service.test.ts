import { describe, expect, it, vi } from "vitest";
import type { EffectiveAccessRepository } from "@/modules/access/application/effective-access-repository";
import { EffectiveAccessService } from "@/modules/access/application/effective-access-service";
import { AccessConfigurationError } from "@/modules/access/domain/errors";
import type { EffectiveAccessBasis } from "@/modules/access/domain/effective-access";

const at = new Date("2040-08-30T12:00:00.000Z");
const basis: EffectiveAccessBasis = {
  id: "20000000-0000-4000-8000-000000000001",
  source: "manual",
  periodStart: "2040-08-01T00:00:00.000Z",
  periodEnd: "2040-09-01T00:00:00.000Z",
};

function createService(input: {
  bases?: readonly EffectiveAccessBasis[];
  hasManualGrantHistory?: boolean;
  hasManualGrantHistoryError?: unknown;
  listActiveBasesError?: unknown;
} = {}) {
  const listActiveBases = vi.fn(async () => {
    if ("listActiveBasesError" in input) {
      throw input.listActiveBasesError;
    }

    return input.bases ?? [];
  });
  const hasManualGrantHistory = vi.fn(async () => {
    if ("hasManualGrantHistoryError" in input) {
      throw input.hasManualGrantHistoryError;
    }

    return input.hasManualGrantHistory ?? false;
  });
  const repository = {
    listActiveBases,
    hasManualGrantHistory,
  } satisfies EffectiveAccessRepository;

  return {
    hasManualGrantHistory,
    listActiveBases,
    service: new EffectiveAccessService(repository),
  };
}

describe("EffectiveAccessService", () => {
  it("вычисляет решение на одном переданном моменте времени", async () => {
    const { listActiveBases, service } = createService({
      bases: [basis],
    });

    await expect(
      service.getEffectiveAccess("student-id", at),
    ).resolves.toMatchObject({
      evaluatedAt: at.toISOString(),
      canReadCourses: true,
      activeBases: [basis],
    });
    expect(listActiveBases).toHaveBeenCalledWith(
      "student-id",
      at,
    );
  });

  it("отклоняет некорректный момент до обращения к БД", async () => {
    const { listActiveBases, service } = createService();

    await expect(
      service.getEffectiveAccess(
        "student-id",
        new Date("invalid"),
      ),
    ).rejects.toThrowError(
      "Момент вычисления доступа должен быть корректной датой.",
    );
    expect(listActiveBases).not.toHaveBeenCalled();
  });

  it("в shadow применяет legacy на том же моменте и сообщает несовпадение", async () => {
    const { hasManualGrantHistory, listActiveBases, service } =
      createService({ bases: [basis] });
    const reportMismatch = vi.fn();

    await expect(
      service.resolveCourseAccess({
        userId: "student-id",
        at,
        legacyCanReadCourses: false,
        config: {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        },
        observation: { reportMismatch },
      }),
    ).resolves.toBe(false);
    expect(hasManualGrantHistory).toHaveBeenCalledTimes(1);
    expect(listActiveBases).toHaveBeenCalledWith(
      "student-id",
      at,
    );
    expect(reportMismatch).toHaveBeenCalledWith(
      "EFFECTIVE_ACCESS_V2_ONLY",
    );
  });

  it("в shadow сохраняет legacy при сбое нового чтения", async () => {
    const evaluationError = new Error(
      "Ошибка нового чтения с private-user@example.test",
    );
    const { service } = createService({
      listActiveBasesError: evaluationError,
    });
    const reportEvaluationFailure = vi.fn(() => {
      throw new Error("Сбой необязательной диагностики");
    });

    await expect(
      service.resolveCourseAccess({
        userId: "student-id",
        at,
        legacyCanReadCourses: true,
        config: {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        },
        observation: { reportEvaluationFailure },
      }),
    ).resolves.toBe(true);
    expect(reportEvaluationFailure).toHaveBeenCalledWith(
      evaluationError,
    );
  });

  it("в shadow сохраняет legacy при инфраструктурном сбое rollout-guard", async () => {
    const guardError = new Error("MANUAL_HISTORY_READ_FAILED");
    const { listActiveBases, service } = createService({
      hasManualGrantHistoryError: guardError,
    });
    const reportEvaluationFailure = vi.fn();

    await expect(
      service.resolveCourseAccess({
        userId: "student-id",
        at,
        legacyCanReadCourses: true,
        config: {
          effectiveAccessMode: "shadow",
          manualAccessGrantingEnabled: false,
        },
        observation: { reportEvaluationFailure },
      }),
    ).resolves.toBe(true);
    expect(listActiveBases).not.toHaveBeenCalled();
    expect(reportEvaluationFailure).toHaveBeenCalledWith(
      guardError,
    );
  });

  it("не маскирует rollout-запрет shadow как сбой наблюдаемости", async () => {
    const { listActiveBases, service } = createService({
      hasManualGrantHistory: true,
    });
    const reportEvaluationFailure = vi.fn();

    const result = service.resolveCourseAccess({
      userId: "student-id",
      at,
      legacyCanReadCourses: true,
      config: {
        effectiveAccessMode: "shadow",
        manualAccessGrantingEnabled: false,
      },
      observation: { reportEvaluationFailure },
    });

    await expect(result).rejects.toThrowError(
      "Режим legacy или shadow запрещён после появления ручного гранта.",
    );
    await expect(result).rejects.toMatchObject({
      name: "AccessConfigurationError",
      code: "LEGACY_ACCESS_MODE_FORBIDDEN",
    });
    expect(listActiveBases).not.toHaveBeenCalled();
    expect(reportEvaluationFailure).not.toHaveBeenCalled();
  });

  it("в применяемом v2 не подменяет сбой новым legacy-решением", async () => {
    const evaluationError = new Error("Сбой нового чтения");
    const { hasManualGrantHistory, service } = createService({
      listActiveBasesError: evaluationError,
    });
    const reportEvaluationFailure = vi.fn();

    await expect(
      service.resolveCourseAccess({
        userId: "student-id",
        at,
        legacyCanReadCourses: true,
        config: {
          effectiveAccessMode: "v2",
          manualAccessGrantingEnabled: false,
        },
        observation: { reportEvaluationFailure },
      }),
    ).rejects.toBe(evaluationError);
    expect(hasManualGrantHistory).not.toHaveBeenCalled();
    expect(reportEvaluationFailure).not.toHaveBeenCalled();
  });

  it("в legacy не выполняет новое чтение", async () => {
    const { listActiveBases, service } = createService();

    await expect(
      service.resolveCourseAccess({
        userId: "student-id",
        at,
        legacyCanReadCourses: true,
        config: {
          effectiveAccessMode: "legacy",
          manualAccessGrantingEnabled: false,
        },
      }),
    ).resolves.toBe(true);
    expect(listActiveBases).not.toHaveBeenCalled();
  });

  it.each(["legacy", "shadow"] as const)(
    "запрещает режим %s после первого ручного гранта",
    async (effectiveAccessMode) => {
      const { service } = createService({
        hasManualGrantHistory: true,
      });

      await expect(
        service.assertRolloutConfiguration({
          effectiveAccessMode,
          manualAccessGrantingEnabled: false,
        }),
      ).rejects.toThrowError(
        "Режим legacy или shadow запрещён после появления ручного гранта.",
      );
    },
  );

  it.each(["v2", "legacy_paid_plus_manual"] as const)(
    "сохраняет ручную историю в режиме %s",
    async (effectiveAccessMode) => {
      const { service } = createService({
        hasManualGrantHistory: true,
      });

      await expect(
        service.assertRolloutConfiguration({
          effectiveAccessMode,
          manualAccessGrantingEnabled: false,
        }),
      ).resolves.toBeUndefined();
    },
  );

  it("разрешает выдачу только после перехода в v2", async () => {
    const { hasManualGrantHistory, service } = createService();

    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "legacy_paid_plus_manual",
        manualAccessGrantingEnabled: true,
      }),
    ).rejects.toThrowError(
      "Выдача ручного доступа разрешена только в режиме v2.",
    );
    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "shadow",
        manualAccessGrantingEnabled: true,
      }),
    ).rejects.toBeInstanceOf(AccessConfigurationError);
    expect(hasManualGrantHistory).not.toHaveBeenCalled();

    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "v2",
        manualAccessGrantingEnabled: true,
      }),
    ).resolves.toBeUndefined();
  });
});
