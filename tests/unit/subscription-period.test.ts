import { describe, expect, it } from "vitest";
import { addSubscriptionPeriod } from "@/modules/billing/domain/subscription-period";

describe("addSubscriptionPeriod", () => {
  it("переносит месячную подписку на последний день короткого месяца", () => {
    const result = addSubscriptionPeriod(
      new Date("2025-01-31T09:45:12.123Z"),
      "monthly",
    );

    expect(result.toISOString()).toBe("2025-02-28T09:45:12.123Z");
  });

  it("учитывает високосный февраль", () => {
    const result = addSubscriptionPeriod(
      new Date("2024-01-31T00:00:00.000Z"),
      "monthly",
    );

    expect(result.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("корректно переносит годовую подписку с 29 февраля", () => {
    const result = addSubscriptionPeriod(
      new Date("2024-02-29T18:30:00.000Z"),
      "annual",
    );

    expect(result.toISOString()).toBe("2025-02-28T18:30:00.000Z");
  });
});
