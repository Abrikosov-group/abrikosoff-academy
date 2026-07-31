import { describe, expect, it, vi } from "vitest";
import type { EffectiveAccessRepository } from "@/modules/access/application/effective-access-repository";
import { EffectiveAccessService } from "@/modules/access/application/effective-access-service";
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
} = {}) {
  const listActiveBases = vi.fn(async () => input.bases ?? []);
  const hasManualGrantHistory = vi.fn(
    async () => input.hasManualGrantHistory ?? false,
  );
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
    expect(hasManualGrantHistory).not.toHaveBeenCalled();

    await expect(
      service.assertRolloutConfiguration({
        effectiveAccessMode: "v2",
        manualAccessGrantingEnabled: true,
      }),
    ).resolves.toBeUndefined();
  });
});
