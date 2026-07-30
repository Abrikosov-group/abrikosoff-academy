import { AdminDashboard } from "@/components/academy/admin-dashboard";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";
import {
  getAdminDisplayTimeZone,
  getAdministrationConfig,
} from "@/modules/administration/server/administration-config";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";

export default async function AdminPage() {
  const { mode } = getAdministrationConfig();

  if (mode === "operational") {
    const context = await requireAdminContext("dashboard.read");
    const displayTimeZone = getAdminDisplayTimeZone();
    const { dashboardReadService } = getAdministrationRuntime();
    const metrics = await dashboardReadService.getDashboardMetrics({
      displayTimeZone,
      permissions: context.permissions,
    });

    return (
      <AdminDashboard
        canOpenStudentList={
          context.permissions.has("users.read") &&
          context.permissions.has("access.read")
        }
        metrics={metrics}
      />
    );
  }

  await requireAdminContext("admin.preview");

  return (
    <>
      <header className="admin-page-heading">
        <p className="overline">Защитный фундамент</p>
        <h1>Администрирование</h1>
        <p>
          Панель подключена к отдельному контуру ролей,
          административных сессий и аудита.
        </p>
      </header>
      <section className="admin-foundation-card">
        <span className="badge badge-success">Контур защищён</span>
        <h2>Основа готова к следующим разделам</h2>
        <p>
          Здесь появятся достоверная статистика, ученики, доступы и
          платежная диагностика. Сейчас экран намеренно не
          показывает демонстрационные показатели.
        </p>
      </section>
    </>
  );
}
