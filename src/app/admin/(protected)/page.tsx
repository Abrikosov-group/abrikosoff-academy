import Link from "next/link";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";
import { getAdministrationConfig } from "@/modules/administration/server/administration-config";

export default async function AdminPage() {
  const { mode } = getAdministrationConfig();

  const context = await requireAdminContext(
    mode === "owner_preview" ? "admin.preview" : "dashboard.read",
  );
  const studentsAvailable =
    context.permissions.has("users.read") &&
    context.permissions.has("access.read");

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
        <h2>
          {studentsAvailable
            ? "Первый рабочий раздел подключён"
            : "Основа готова к следующим разделам"}
        </h2>
        <p>
          {studentsAvailable
            ? "В локальном операционном режиме уже доступны поиск, карточка ученика и просмотр оплаченного доступа. Достоверная статистика и изменяющие команды будут добавлены отдельными пакетами."
            : "Здесь появятся достоверная статистика, ученики, доступы и платежная диагностика. Сейчас экран намеренно не показывает демонстрационные показатели."}
        </p>
        {studentsAvailable ? (
          <Link
            className="button button-primary button-inline"
            href="/admin/students"
          >
            Открыть учеников
          </Link>
        ) : null}
      </section>
    </>
  );
}
