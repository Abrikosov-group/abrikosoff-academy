import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDatabasePoolMock,
  requireBillingRequestOriginMock,
  requireCurrentUserMock,
  setSubscriptionRenewalMock,
} = vi.hoisted(() => ({
  getDatabasePoolMock: vi.fn(),
  requireBillingRequestOriginMock: vi.fn(),
  requireCurrentUserMock: vi.fn(),
  setSubscriptionRenewalMock: vi.fn(),
}));

vi.mock("@/lib/database", () => ({
  getDatabasePool: getDatabasePoolMock,
}));

vi.mock(
  "@/modules/billing/infrastructure/postgres-payment-repository",
  () => ({ setSubscriptionRenewal: setSubscriptionRenewalMock }),
);

vi.mock("@/modules/billing/server/request-origin", () => ({
  requireBillingRequestOrigin: requireBillingRequestOriginMock,
}));

vi.mock("@/modules/identity/server/session", () => ({
  requireCurrentUser: requireCurrentUserMock,
}));

import { POST } from "@/app/api/subscriptions/renewal/route";

describe("POST /api/subscriptions/renewal", () => {
  beforeEach(() => {
    getDatabasePoolMock.mockReturnValue({});
    requireCurrentUserMock.mockResolvedValue({ id: "student-001" });
  });

  it("отклоняет тело запроса больше четырёх килобайт", async () => {
    const response = await POST(
      new Request("https://academy.example/api/subscriptions/renewal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, padding: "x".repeat(4096) }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Размер данных управления подпиской превышает допустимый.",
      },
    });
    expect(setSubscriptionRenewalMock).not.toHaveBeenCalled();
  });
});
