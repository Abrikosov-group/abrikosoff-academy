import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminDashboard } from "@/components/academy/admin-dashboard";
import type { AdministrationDashboardReadRepository } from "@/modules/administration/application/administration-dashboard-read-repository";
import { AdministrationDashboardReadService } from "@/modules/administration/application/administration-dashboard-read-service";
import type { AdminDashboardMetrics } from "@/modules/administration/domain/dashboard-read-model";
import { AdministrationError } from "@/modules/administration/domain/errors";
import type { AdminPermission } from "@/modules/administration/domain/types";

const at = new Date("2026-07-30T12:00:00.000Z");
const metrics: AdminDashboardMetrics = {
  generatedAt: at.toISOString(),
  displayTimeZone: "Europe/Moscow",
  periods: {
    last7DaysFrom: "2026-07-24",
    last30DaysFrom: "2026-07-01",
    through: "2026-07-30",
  },
  students: {
    activeStudents: 10,
    newStudentsLast7Days: 3,
    newStudentsLast30Days: 8,
  },
  access: {
    activePaidAccessStudents: 4,
  },
  billing: {
    stalePendingPayments: 1,
    failedWebhookEvents: 0,
  },
};

function createService() {
  const getDashboardMetrics = vi.fn(
    async () => metrics,
  );
  const repository = {
    getDashboardMetrics,
  } satisfies AdministrationDashboardReadRepository;

  return {
    getDashboardMetrics,
    service: new AdministrationDashboardReadService(repository),
  };
}

describe("read-only дашборд Administration", () => {
  it("отклоняет чтение без dashboard.read до обращения к БД", async () => {
    const { getDashboardMetrics, service } = createService();

    expect(() =>
      service.getDashboardMetrics({
        at,
        displayTimeZone: "Europe/Moscow",
        permissions: new Set<AdminPermission>([
          "users.read",
          "access.read",
          "billing.read",
        ]),
      }),
    ).toThrowError(AdministrationError);
    expect(getDashboardMetrics).not.toHaveBeenCalled();
  });

  it("открывает только группы метрик с предметными разрешениями", async () => {
    const { getDashboardMetrics, service } = createService();

    await expect(
      service.getDashboardMetrics({
        at,
        displayTimeZone: "Europe/Moscow",
        permissions: new Set<AdminPermission>([
          "dashboard.read",
          "users.read",
          "access.read",
        ]),
      }),
    ).resolves.toBe(metrics);
    expect(getDashboardMetrics).toHaveBeenCalledWith({
      at,
      displayTimeZone: "Europe/Moscow",
      scope: {
        students: true,
        paidAccess: true,
        billing: false,
      },
    });
  });

  it("не считает глобальный Billing по связанному разрешению", async () => {
    const { getDashboardMetrics, service } = createService();

    await service.getDashboardMetrics({
      at,
      displayTimeZone: "Europe/Moscow",
      permissions: new Set<AdminPermission>([
        "dashboard.read",
        "billing.read_related",
        "access.read_related",
      ]),
    });

    expect(getDashboardMetrics).toHaveBeenCalledWith({
      at,
      displayTimeZone: "Europe/Moscow",
      scope: {
        students: false,
        paidAccess: false,
        billing: false,
      },
    });
  });

  it("не показывает переходы в недоступный список учеников", () => {
    const html = renderToStaticMarkup(
      createElement(AdminDashboard, {
        canOpenStudentList: false,
        metrics,
      }),
    );

    expect(html).not.toContain("/admin/students?");
  });
});
