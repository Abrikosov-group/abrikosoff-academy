import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStudentCourseAccess } from "@/modules/access/server/read-student-course-access";

const {
  getSubscriptionSummaryMock,
  hasCurrentSubscriptionAccessMock,
  logUnexpectedServerErrorMock,
  resolveStudentCourseAccessMock,
  validateEffectiveAccessConfigurationMock,
} = vi.hoisted(() => ({
  getSubscriptionSummaryMock: vi.fn(),
  hasCurrentSubscriptionAccessMock: vi.fn(),
  logUnexpectedServerErrorMock: vi.fn(),
  resolveStudentCourseAccessMock: vi.fn(),
  validateEffectiveAccessConfigurationMock: vi.fn(),
}));

vi.mock(
  "@/modules/billing/infrastructure/postgres-payment-repository",
  () => ({
    getSubscriptionSummary: getSubscriptionSummaryMock,
  }),
);
vi.mock("@/modules/billing/domain/subscription-access", () => ({
  hasCurrentSubscriptionAccess:
    hasCurrentSubscriptionAccessMock,
}));
vi.mock("@/modules/access/server/get-effective-access", () => ({
  resolveStudentCourseAccess: resolveStudentCourseAccessMock,
  validateEffectiveAccessConfiguration:
    validateEffectiveAccessConfigurationMock,
}));
vi.mock("@/lib/safe-server-log", () => ({
  logUnexpectedServerError: logUnexpectedServerErrorMock,
}));

function createClient(input: {
  evaluatedAt: Date;
  commitError?: Error;
  rollbackError?: Error;
}) {
  const query = vi.fn(async (statement: string) => {
    if (statement === "SELECT clock_timestamp() AS evaluated_at") {
      return { rows: [{ evaluated_at: input.evaluatedAt }] };
    }

    if (statement === "COMMIT" && input.commitError) {
      throw input.commitError;
    }

    if (statement === "ROLLBACK" && input.rollbackError) {
      throw input.rollbackError;
    }

    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;

  return { client, query, release };
}

describe("readStudentCourseAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("повторяет только legacy-чтение, если соединение оборвалось после shadow-fallback", async () => {
    const firstEvaluatedAt = new Date(
      "2042-08-30T12:00:00.000Z",
    );
    const retryEvaluatedAt = new Date(
      "2042-08-30T12:00:01.000Z",
    );
    const commitError = new Error("соединение потеряно");
    const rollbackError = new Error("откат недоступен");
    const first = createClient({
      evaluatedAt: firstEvaluatedAt,
      commitError,
      rollbackError,
    });
    const retry = createClient({ evaluatedAt: retryEvaluatedAt });
    const pool = {
      connect: vi
        .fn()
        .mockResolvedValueOnce(first.client)
        .mockResolvedValueOnce(retry.client),
    } as unknown as Pool;
    const subscription = {
      currentPeriodEnd: "2042-09-30T12:00:00.000Z",
    };

    getSubscriptionSummaryMock.mockResolvedValue(subscription);
    hasCurrentSubscriptionAccessMock.mockReturnValue(true);
    validateEffectiveAccessConfigurationMock.mockResolvedValue(
      undefined,
    );
    resolveStudentCourseAccessMock.mockImplementation(
      async (input: {
        onShadowFallbackApplied?: () => void;
      }) => {
        input.onShadowFallbackApplied?.();

        return {
          canReadCourses: true,
          appliedEffectiveAccess: null,
        };
      },
    );

    await expect(
      readStudentCourseAccess(pool, "student-id"),
    ).resolves.toEqual({
      evaluatedAt: retryEvaluatedAt,
      subscription,
      subscriptionActive: true,
      subscriptionEnded: false,
      canReadCourses: true,
      appliedEffectiveAccess: null,
    });

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(getSubscriptionSummaryMock).toHaveBeenCalledTimes(2);
    expect(resolveStudentCourseAccessMock).toHaveBeenCalledTimes(1);
    expect(
      validateEffectiveAccessConfigurationMock,
    ).toHaveBeenCalledWith(retry.client);
    expect(first.release).toHaveBeenCalledWith(true);
    expect(retry.release).toHaveBeenCalledWith(false);
    expect(logUnexpectedServerErrorMock).toHaveBeenCalledWith(
      "database.read_snapshot_rollback_error",
      rollbackError,
    );
  });

  it("не маскирует ошибку завершения снимка без shadow-fallback", async () => {
    const evaluatedAt = new Date("2042-08-30T12:00:00.000Z");
    const commitError = new Error("COMMIT не выполнен");
    const snapshot = createClient({ evaluatedAt, commitError });
    const pool = {
      connect: vi.fn().mockResolvedValue(snapshot.client),
    } as unknown as Pool;

    getSubscriptionSummaryMock.mockResolvedValue(null);
    hasCurrentSubscriptionAccessMock.mockReturnValue(false);
    resolveStudentCourseAccessMock.mockResolvedValue({
      canReadCourses: false,
      appliedEffectiveAccess: null,
    });

    await expect(
      readStudentCourseAccess(pool, "student-id"),
    ).rejects.toBe(commitError);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(resolveStudentCourseAccessMock).toHaveBeenCalledTimes(1);
    expect(
      validateEffectiveAccessConfigurationMock,
    ).not.toHaveBeenCalled();
    expect(snapshot.release).toHaveBeenCalledWith(false);
  });

  it("не возвращает legacy после появления ручного гранта между снимками", async () => {
    const first = createClient({
      evaluatedAt: new Date("2042-08-30T12:00:00.000Z"),
      commitError: new Error("соединение потеряно"),
      rollbackError: new Error("откат недоступен"),
    });
    const retry = createClient({
      evaluatedAt: new Date("2042-08-30T12:00:01.000Z"),
    });
    const pool = {
      connect: vi
        .fn()
        .mockResolvedValueOnce(first.client)
        .mockResolvedValueOnce(retry.client),
    } as unknown as Pool;
    const rolloutError = new Error(
      "LEGACY_ACCESS_MODE_FORBIDDEN",
    );

    getSubscriptionSummaryMock.mockResolvedValue(null);
    hasCurrentSubscriptionAccessMock.mockReturnValue(false);
    resolveStudentCourseAccessMock.mockImplementation(
      async (input: {
        onShadowFallbackApplied?: () => void;
      }) => {
        input.onShadowFallbackApplied?.();

        return {
          canReadCourses: false,
          appliedEffectiveAccess: null,
        };
      },
    );
    validateEffectiveAccessConfigurationMock.mockRejectedValue(
      rolloutError,
    );

    await expect(
      readStudentCourseAccess(pool, "student-id"),
    ).rejects.toBe(rolloutError);

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(
      validateEffectiveAccessConfigurationMock,
    ).toHaveBeenCalledWith(retry.client);
    expect(retry.release).toHaveBeenCalledWith(false);
  });
});
