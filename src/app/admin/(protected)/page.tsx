import { requireAdminContext } from "@/modules/administration/server/require-admin-context";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";

export default async function AdminPage() {
  const { mode } = getAdministrationConfig();

  await requireAdminContext(
    mode === "owner_preview" ? "admin.preview" : "dashboard.read",
  );

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
          платежная диагностика. Сейчас экран намеренно не показывает
          демонстрационные показатели.
        </p>
      </section>
    </>
  );
}
