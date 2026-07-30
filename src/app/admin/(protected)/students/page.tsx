import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import {
  adminAccessStateLabel,
  adminStudentStatusLabel,
  formatAdminDate,
  formatAdminDateTime,
} from "@/modules/administration/domain/student-presentation";
import {
  encodeAdminStudentCursor,
  parseAdminStudentListQuery,
  type AdminStudentListSearchParams,
} from "@/modules/administration/domain/student-list-query";
import type {
  AdminStudentAccessState,
  AdminStudentListFilters,
  AdminStudentStatus,
} from "@/modules/administration/domain/student-read-model";
import {
  getAdminDisplayTimeZone,
} from "@/modules/administration/server/administration-config";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";

export const metadata: Metadata = {
  title: "Ученики — Администрирование",
};

function appendFilterParams(
  params: URLSearchParams,
  filters: AdminStudentListFilters,
) {
  if (filters.query) params.set("q", filters.query);
  if (filters.status) params.set("status", filters.status);
  if (filters.access) params.set("access", filters.access);
  if (filters.source) params.set("source", filters.source);
  if (filters.plan) params.set("plan", filters.plan);
  if (filters.registeredFrom) {
    params.set("from", filters.registeredFrom);
  }
  if (filters.registeredTo) {
    params.set("to", filters.registeredTo);
  }
  if (filters.limit !== 50) {
    params.set("limit", String(filters.limit));
  }
}

function studentsPageHref(
  filters: AdminStudentListFilters,
  cursor?: string,
) {
  const params = new URLSearchParams();

  appendFilterParams(params, filters);
  if (cursor) params.set("cursor", cursor);

  const query = params.toString();
  return query ? `/admin/students?${query}` : "/admin/students";
}

function studentDetailHref(
  userId: string,
  returnTo: string,
) {
  const params = new URLSearchParams({ returnTo });

  return `/admin/students/${userId}?${params.toString()}`;
}

function statusBadgeClass(status: AdminStudentStatus) {
  return status === "active"
    ? "badge-success"
    : status === "blocked"
      ? "badge-error"
      : "badge-neutral";
}

function accessBadgeClass(state: AdminStudentAccessState) {
  return state === "active"
    ? "badge-success"
    : state === "scheduled"
      ? "badge-warning"
      : state === "revoked"
        ? "badge-error"
        : "badge-neutral";
}

function planLabel(plan: "monthly" | "annual" | undefined) {
  return plan === "monthly"
    ? "Месячный"
    : plan === "annual"
      ? "Годовой"
      : "—";
}

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<AdminStudentListSearchParams>;
}) {
  const context = await requireAdminContext(
    "users.read",
    "/admin/students",
  );

  if (!context.permissions.has("access.read")) {
    forbidden();
  }

  const resolvedSearchParams = await searchParams;
  const { filters, cursor } = parseAdminStudentListQuery(
    resolvedSearchParams,
  );
  const displayTimeZone = getAdminDisplayTimeZone();
  const { studentReadService } = getAdministrationRuntime();
  const result = await studentReadService.listStudents({
    filters,
    cursor,
    displayTimeZone,
    permissions: context.permissions,
  });
  const currentListHref = studentsPageHref(
    filters,
    cursor ? encodeAdminStudentCursor(cursor) : undefined,
  );

  return (
    <>
      <header className="admin-page-heading admin-page-heading-wide">
        <p className="overline">Поддержка учеников</p>
        <h1>Ученики</h1>
        <p>
          Поиск по учётным данным и просмотр фактического
          оплаченного доступа. Изменяющие команды пока не
          подключены.
        </p>
      </header>

      <form
        aria-label="Поиск и фильтры учеников"
        className="admin-student-filters"
        method="get"
      >
        <div className="admin-filter-search">
          <label htmlFor="student-query">Найти ученика</label>
          <input
            defaultValue={filters.query}
            id="student-query"
            maxLength={120}
            name="q"
            placeholder="UUID, Telegram ID/username, email, телефон или имя"
            type="search"
          />
        </div>
        <div>
          <label htmlFor="student-status">Статус</label>
          <select
            defaultValue={filters.status ?? ""}
            id="student-status"
            name="status"
          >
            <option value="">Любой</option>
            <option value="not_deleted">
              Активен или заблокирован
            </option>
            <option value="active">Активен</option>
            <option value="blocked">Заблокирован</option>
            <option value="deleted">Удалён</option>
          </select>
        </div>
        <div>
          <label htmlFor="student-access">Доступ</label>
          <select
            defaultValue={filters.access ?? ""}
            id="student-access"
            name="access"
          >
            <option value="">Любой</option>
            <option value="active">Активен</option>
            <option value="scheduled">Ожидает начала</option>
            <option value="expired">Завершён</option>
            <option value="revoked">Отозван</option>
            <option value="none">Отсутствует</option>
          </select>
        </div>
        <div>
          <label htmlFor="student-source">Источник</label>
          <select
            defaultValue={filters.source ?? ""}
            id="student-source"
            name="source"
          >
            <option value="">Любой</option>
            <option value="paid">Оплаченный</option>
          </select>
        </div>
        <div>
          <label htmlFor="student-plan">Последний тариф</label>
          <select
            defaultValue={filters.plan ?? ""}
            id="student-plan"
            name="plan"
          >
            <option value="">Любой</option>
            <option value="monthly">Месячный</option>
            <option value="annual">Годовой</option>
          </select>
        </div>
        <div>
          <label htmlFor="student-from">Регистрация с</label>
          <input
            defaultValue={filters.registeredFrom}
            id="student-from"
            name="from"
            type="date"
          />
        </div>
        <div>
          <label htmlFor="student-to">Регистрация по</label>
          <input
            defaultValue={filters.registeredTo}
            id="student-to"
            name="to"
            type="date"
          />
        </div>
        <div>
          <label htmlFor="student-limit">На странице</label>
          <select
            defaultValue={String(filters.limit)}
            id="student-limit"
            name="limit"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <div className="admin-filter-actions">
          <button className="button button-primary" type="submit">
            Применить
          </button>
          <Link
            className="button button-secondary"
            href="/admin/students"
          >
            Сбросить
          </Link>
        </div>
      </form>

      <section
        aria-labelledby="student-results-heading"
        className="admin-student-results"
      >
        <div className="admin-results-heading">
          <div>
            <h2 id="student-results-heading">Результаты</h2>
            <p>
              Показано: {result.items.length}. Часовой пояс:{" "}
              {displayTimeZone}.
            </p>
          </div>
          {filters.query ? (
            <span className="admin-query-summary">
              Запрос: «{filters.query}»
            </span>
          ) : null}
        </div>

        {result.items.length === 0 ? (
          <div className="admin-empty-state">
            <h3>Ученики не найдены</h3>
            <p>
              Измените запрос или сбросьте один из фильтров.
            </p>
          </div>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th scope="col">Ученик</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Доступ</th>
                  <th scope="col">Последний тариф</th>
                  <th scope="col">Регистрация</th>
                  <th scope="col">Сессия создана</th>
                  <th scope="col">Платежи</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <Link
                        className="admin-student-link"
                        href={studentDetailHref(
                          student.id,
                          currentListHref,
                        )}
                      >
                        <strong>{student.displayName}</strong>
                        <span>{student.primaryMethod.label}</span>
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`badge ${statusBadgeClass(
                          student.status,
                        )}`}
                      >
                        {adminStudentStatusLabel(student.status)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${accessBadgeClass(
                          student.accessState,
                        )}`}
                      >
                        {adminAccessStateLabel(
                          student.accessState,
                        )}
                      </span>
                      {student.accessUntil ? (
                        <small>
                          до{" "}
                          {formatAdminDate(
                            student.accessUntil,
                            displayTimeZone,
                          )}
                        </small>
                      ) : student.scheduledFrom ? (
                        <small>
                          с{" "}
                          {formatAdminDate(
                            student.scheduledFrom,
                            displayTimeZone,
                          )}
                        </small>
                      ) : null}
                    </td>
                    <td>{planLabel(student.latestPaidPlan)}</td>
                    <td>
                      <time dateTime={student.registeredAt}>
                        {formatAdminDateTime(
                          student.registeredAt,
                          displayTimeZone,
                        )}
                      </time>
                    </td>
                    <td>
                      {student.lastSessionCreatedAt ? (
                        <time
                          dateTime={student.lastSessionCreatedAt}
                        >
                          {formatAdminDateTime(
                            student.lastSessionCreatedAt,
                            displayTimeZone,
                          )}
                        </time>
                      ) : (
                        "Нет сессий"
                      )}
                    </td>
                    <td>
                      {student.hasPayments ? "Есть" : "Нет"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result.nextCursor ? (
          <div className="admin-pagination">
            <Link
              className="button button-secondary"
              href={studentsPageHref(
                filters,
                result.nextCursor,
              )}
              rel="next"
            >
              Следующая страница
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}
