import { describe, expect, it } from "vitest";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";

const now = new Date("2026-07-28T12:00:00.000Z");

describe("hasCurrentSubscriptionAccess", () => {
  it("разрешает доступ только внутри оплаченного периода", () => {
    expect(
      hasCurrentSubscriptionAccess(
        {
          status: "active",
          currentPeriodEnd: "2026-08-28T11:59:59.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("закрывает доступ по истечении периода даже при статусе active", () => {
    expect(
      hasCurrentSubscriptionAccess(
        {
          status: "active",
          currentPeriodEnd: "2026-07-28T12:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("не открывает доступ без конечной даты", () => {
    expect(
      hasCurrentSubscriptionAccess({ status: "active" }, now),
    ).toBe(false);
  });
});
