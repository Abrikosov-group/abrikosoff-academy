import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withDatabaseReadSnapshot } from "@/lib/database";

const { logUnexpectedServerErrorMock } = vi.hoisted(() => ({
  logUnexpectedServerErrorMock: vi.fn(),
}));

vi.mock("@/lib/safe-server-log", () => ({
  logUnexpectedServerError: logUnexpectedServerErrorMock,
}));

const evaluatedAt = new Date("2026-07-31T17:00:00.000Z");

function createPool(options?: {
  rollbackError?: Error;
}) {
  const query = vi.fn(async (statement: string) => {
    if (statement === "SELECT clock_timestamp() AS evaluated_at") {
      return { rows: [{ evaluated_at: evaluatedAt }] };
    }

    if (statement === "ROLLBACK" && options?.rollbackError) {
      throw options.rollbackError;
    }

    return { rows: [] };
  });
  const release = vi.fn();
  const client = {
    query,
    release,
  } as unknown as PoolClient;
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;

  return { client, pool, query, release };
}

describe("withDatabaseReadSnapshot", () => {
  beforeEach(() => {
    logUnexpectedServerErrorMock.mockReset();
  });

  it("фиксирует один момент чтения и возвращает исправное соединение в пул", async () => {
    const { client, pool, query, release } = createPool();
    const operation = vi.fn().mockResolvedValue("готово");

    await expect(
      withDatabaseReadSnapshot(pool, operation),
    ).resolves.toBe("готово");

    expect(operation).toHaveBeenCalledWith(client, evaluatedAt);
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT clock_timestamp() AS evaluated_at",
      "COMMIT",
    ]);
    expect(release).toHaveBeenCalledWith(false);
    expect(logUnexpectedServerErrorMock).not.toHaveBeenCalled();
  });

  it("откатывает неуспешную операцию и сохраняет исходную ошибку", async () => {
    const { pool, query, release } = createPool();
    const operationError = new Error("операция чтения не выполнена");

    await expect(
      withDatabaseReadSnapshot(pool, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT clock_timestamp() AS evaluated_at",
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledWith(false);
    expect(logUnexpectedServerErrorMock).not.toHaveBeenCalled();
  });

  it("уничтожает соединение, если откат не выполнен", async () => {
    const rollbackError = new Error("соединение потеряно");
    const operationError = new Error("операция чтения не выполнена");
    const { pool, release } = createPool({ rollbackError });

    await expect(
      withDatabaseReadSnapshot(pool, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(logUnexpectedServerErrorMock).toHaveBeenCalledWith(
      "database.read_snapshot_rollback_error",
      rollbackError,
    );
    expect(release).toHaveBeenCalledWith(true);
  });
});
