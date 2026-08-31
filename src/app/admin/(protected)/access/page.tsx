import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { AdminManualAccessGrantForm } from "@/components/academy/admin-manual-access-controls";
import { AdminManualAccessRevokeForm } from "@/components/academy/admin-manual-access-controls";
import { formatAdminDateTime } from "@/modules/administration/domain/student-presentation";
import {
  adminAccessSources,
  adminAccessStates,
  decodeAdminAccessCursor,
  type AdminAccessSource,
  type AdminAccessState,
} from "@/modules/administration/domain/access-read-model";
import type { AdminStudentManualGrant } from "@/modules/administration/domain/student-read-model";
import {
  getAdminDisplayTimeZone,
} from "@/modules/administration/server/administration-config";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";
import { getAccessConfig } from "@/modules/access/server/access-config";

export const metadata: Metadata = {
  title: "Доступ — Администрирование",
};

type SearchParams = {
  q?: string | string[];
  source?: string | string[];
  state?: string | string[];
  cursor?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function sourceFrom(value: string | undefined) {
  return adminAccessSources.includes(value as AdminAccessSource)
    ? (value as AdminAccessSource)
    : undefined;
}

function stateFrom(value: string | undefined) {
  return adminAccessStates.includes(value as AdminAccessState)
    ? (value as AdminAccessState)
    : undefined;
}

function sourceLabel(source: AdminAccessSource) {
  return { paid: "Оплата", manual: "Ручной доступ", grace: "Льготный период" }[
    source
  ];
}

function stateLabel(state: AdminAccessState) {
  return {
    active: "Действует",
    scheduled: "Ожидает начала",
    expired: "Завершён",
    revoked: "Отозван",
  }[state];
}

export default async function AdminAccessPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireAdminContext("access.read", "/admin/access");
  if (!context.permissions.has("access.read")) forbidden();
  const resolved = await searchParams;
  const query = first(resolved.q)?.trim() ?? "";
  const source = sourceFrom(first(resolved.source));
  const state = stateFrom(first(resolved.state));
  const cursor = decodeAdminAccessCursor(first(resolved.cursor));
  const { accessReadService, studentReadService } = getAdministrationRuntime();
  const isSelectedStudent = /^[0-9a-f-]{36}$/iu.test(query);
  const [page, selectedStudent, studentMatches] = await Promise.all([
    accessReadService.listAccess({
      query,
      source,
      state,
      cursor,
      permissions: context.permissions,
    }),
    isSelectedStudent
      ? studentReadService.findStudentDetail({
          userId: query,
          permissions: context.permissions,
        })
      : null,
    query && !isSelectedStudent
      ? studentReadService.listStudents({
          filters: { query, limit: 25 },
          displayTimeZone: getAdminDisplayTimeZone(),
          permissions: context.permissions,
        })
      : null,
  ]);
  const accessConfig = getAccessConfig();
  const canGrant =
    context.permissions.has("access.manual.grant") &&
    accessConfig.manualAccessGrantingEnabled &&
    accessConfig.effectiveAccessMode === "v2";
  const disabledReason = !context.permissions.has("access.manual.grant")
    ? "У вашей роли нет права выдавать ручной доступ."
    : !accessConfig.manualAccessGrantingEnabled
      ? "Новая выдача ручного доступа временно выключена."
      : accessConfig.effectiveAccessMode !== "v2"
        ? "Выдача ручного доступа доступна после включения режима v2."
        : undefined;
  const displayTimeZone = getAdminDisplayTimeZone();

  return (
    <>
      <header className="admin-page-heading admin-page-heading-wide">
        <p className="overline">Управление доступом</p>
        <h1>Доступ</h1>
        <p>Оплаченные, ручные и льготные основания показаны отдельно.</p>
      </header>

      <form className="admin-filter-form" method="get">
        <label>
          Найти ученика
          <input
            defaultValue={query}
            name="q"
            placeholder="UUID, имя или учётные данные"
          />
        </label>
        <label>
          Источник
          <select defaultValue={source ?? ""} name="source">
            <option value="">Все</option>
            <option value="paid">Оплата</option>
            <option value="manual">Ручной доступ</option>
            <option value="grace">Льготный период</option>
          </select>
        </label>
        <label>
          Состояние
          <select defaultValue={state ?? ""} name="state">
            <option value="">Все</option>
            <option value="active">Действует</option>
            <option value="scheduled">Ожидает начала</option>
            <option value="expired">Завершён</option>
            <option value="revoked">Отозван</option>
          </select>
        </label>
        <button className="button button-primary" type="submit">
          Применить
        </button>
      </form>

      {selectedStudent ? (
        <AdminManualAccessGrantForm
          canGrant={canGrant}
          disabledReason={disabledReason}
          displayTimeZone={displayTimeZone}
          existingGrants={selectedStudent.manualGrants}
          studentDisplayName={selectedStudent.displayName}
          studentId={selectedStudent.id}
        />
      ) : studentMatches && studentMatches.items.length > 0 ? (
        <section
          aria-labelledby="access-student-choice"
          className="admin-command-form"
        >
          <h3 id="access-student-choice">Выберите ученика для выдачи</h3>
          <div className="admin-access-student-choice-list">
            {studentMatches.items.map((student) => (
              <Link
                className="button button-secondary"
                href={`/admin/access?${new URLSearchParams({
                  q: student.id,
                  ...(source ? { source } : {}),
                  ...(state ? { state } : {}),
                }).toString()}`}
                key={student.id}
              >
                {student.displayName} · {student.primaryMethod.label}
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <p className="admin-command-feedback admin-command-feedback-neutral">
          {query
            ? "Ученики для выдачи не найдены. Уточните запрос."
            : "Введите имя, Telegram, email, телефон или UUID ученика."}
        </p>
      )}

      <section className="admin-dashboard-section">
        <div className="admin-dashboard-section-heading">
          <h2>Основания доступа</h2>
          <p>Найдено: {page.items.length}</p>
        </div>
        <div className="admin-access-source-list">
          {page.items.map((item) => {
            const manualGrant: AdminStudentManualGrant | undefined =
              item.source === "manual"
                ? {
                    id: item.id,
                    source: "manual",
                    status: item.state === "revoked" ? "revoked" : "granted",
                    periodStart: item.periodStart,
                    periodEnd: item.periodEnd,
                    grantReason: item.grantReason ?? "Причина не сохранена",
                    grantedAt: item.grantedAt ?? item.periodStart,
                    revokedAt: item.revokedAt,
                    revokeReason: item.revokeReason,
                    effectiveNow: item.state === "active",
                    overlapsAnotherManualGrant: item.overlapsAnotherManualGrant,
                    canRevoke: item.canRevoke,
                  }
                : undefined;
            return (
              <article className="admin-access-source-card" key={`${item.source}:${item.id}`}>
                <div>
                  <strong>{sourceLabel(item.source)}</strong>
                  <span className={`badge ${item.state === "active" ? "badge-success" : item.state === "revoked" ? "badge-error" : "badge-neutral"}`}>
                    {stateLabel(item.state)}
                  </span>
                </div>
                <Link href={`/admin/students/${item.customerId}`}>
                  {item.customerDisplayName}
                </Link>
                <p>
                  {formatAdminDateTime(item.periodStart, displayTimeZone)} —{" "}
                  {formatAdminDateTime(item.periodEnd, displayTimeZone)}
                </p>
                {item.planId ? <p>Тариф: {item.planId === "monthly" ? "Месячный" : "Годовой"}</p> : null}
                {item.grantReason ? <p>{item.grantReason}</p> : null}
                {item.overlapsAnotherManualGrant ? <span className="badge badge-warning">Есть пересечение</span> : null}
                {manualGrant ? (
                  <AdminManualAccessRevokeForm
                    accessRemainsAfterRevoke={item.accessRemainsAfterRevoke}
                    grant={manualGrant}
                    studentId={item.customerId}
                  />
                ) : null}
              </article>
            );
          })}
          {page.items.length === 0 ? (
            <div className="admin-empty-state">
              <h3>Основания не найдены</h3>
              <p>Измените поиск или фильтры.</p>
            </div>
          ) : null}
        </div>
        {page.nextCursor ? (
          <Link
            className="button button-secondary"
            href={`/admin/access?${new URLSearchParams({
              ...(query ? { q: query } : {}),
              ...(source ? { source } : {}),
              ...(state ? { state } : {}),
              cursor: page.nextCursor,
            }).toString()}`}
          >
            Следующая страница
          </Link>
        ) : null}
      </section>
    </>
  );
}
