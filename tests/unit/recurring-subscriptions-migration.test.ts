import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readMigration(name: string) {
  return readFileSync(
    new URL(`../../db/migrations/${name}`, import.meta.url),
    "utf8",
  );
}

describe("миграции восстановления рекуррентных подписок", () => {
  it("сохраняет применённую миграцию 0015 неизменной", () => {
    const migration = readMigration("0015_recurring_subscriptions.sql");
    const checksum = createHash("sha256").update(migration).digest("hex");

    expect(checksum).toBe(
      "60b3c6df25e1405ed7dd9e35ad566b906f1c4f13d7d2aa3631b392c9c18bf601",
    );
  });

  it("добавляет восстановление отдельной последующей миграцией", () => {
    const migration = readMigration(
      "0016_recurring_subscription_recovery.sql",
    );

    expect(migration).toContain("ADD COLUMN transport_retry_count");
    expect(migration).toContain("reconciliation_required");
    expect(migration).toContain(
      "billing_access_grace_periods_period_key",
    );
    expect(migration).toContain(
      "billing_access_grace_periods_one_active_idx",
    );
  });
});
