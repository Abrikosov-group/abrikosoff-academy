import Link from "next/link";
import type { AdminDashboardMetrics } from "@/modules/administration/domain/dashboard-read-model";
import { formatAdminDateTime } from "@/modules/administration/domain/student-presentation";

type AdminDashboardProps = {
  canOpenStudentList: boolean;
  metrics: AdminDashboardMetrics;
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function studentsPeriodHref(from: string, through: string) {
  const query = new URLSearchParams({
    from,
    to: through,
  });

  return `/admin/students?${query.toString()}`;
}

function signalBadge(count: number, error = false) {
  if (count === 0) {
    return <span className="badge badge-success">Отклонений нет</span>;
  }

  return (
    <span className={error ? "badge badge-error" : "badge badge-warm"}>
      Требует внимания
    </span>
  );
}

export function AdminDashboard({
  canOpenStudentList,
  metrics,
}: AdminDashboardProps) {
  const hasPrimaryMetrics = Boolean(
    metrics.students || metrics.access,
  );

  return (
    <>
      <header className="admin-page-heading admin-page-heading-wide">
        <p className="overline">Операционная картина</p>
        <h1>Обзор Академии</h1>
        <p>
          Фактические показатели из PostgreSQL без демонстрационных
          значений и изменяющих команд.
        </p>
        <p className="admin-dashboard-generated-at">
          Сформировано{" "}
          <time dateTime={metrics.generatedAt}>
            {formatAdminDateTime(
              metrics.generatedAt,
              metrics.displayTimeZone,
            )}
          </time>
          . Часовой пояс: {metrics.displayTimeZone}.
        </p>
      </header>

      {hasPrimaryMetrics ? (
        <section
          aria-labelledby="admin-dashboard-primary-title"
          className="admin-dashboard-section"
        >
          <div className="admin-dashboard-section-heading">
            <div>
              <p className="overline">Ученики и доступ</p>
              <h2 id="admin-dashboard-primary-title">
                Состояние аудитории
              </h2>
            </div>
            <p>
              Показатели относятся к одному снимку данных на указанное
              время.
            </p>
          </div>

          <div className="admin-dashboard-metric-grid">
            {metrics.students ? (
              <>
                <article
                  aria-labelledby="active-students-title"
                  className="admin-dashboard-metric-card"
                >
                  <p
                    className="admin-dashboard-metric-label"
                    id="active-students-title"
                  >
                    Активные ученики
                  </p>
                  <strong className="admin-dashboard-metric-value">
                    {formatMetric(
                      metrics.students.activeStudents,
                    )}
                  </strong>
                  <p className="admin-dashboard-metric-note">
                    Учётные записи со статусом «активен».
                  </p>
                  {canOpenStudentList ? (
                    <Link
                      aria-label="Открыть список активных учеников"
                      className="admin-dashboard-metric-link"
                      href="/admin/students?status=active"
                    >
                      Открыть список
                    </Link>
                  ) : null}
                </article>

                <article
                  aria-labelledby="new-students-title"
                  className="admin-dashboard-metric-card"
                >
                  <p
                    className="admin-dashboard-metric-label"
                    id="new-students-title"
                  >
                    Новые ученики
                  </p>
                  <div className="admin-dashboard-period-values">
                    <div>
                      <strong>
                        {formatMetric(
                          metrics.students
                            .newStudentsLast7Days,
                        )}
                      </strong>
                      <span>за 7 дней</span>
                    </div>
                    <div>
                      <strong>
                        {formatMetric(
                          metrics.students
                            .newStudentsLast30Days,
                        )}
                      </strong>
                      <span>за 30 дней</span>
                    </div>
                  </div>
                  <p className="admin-dashboard-metric-note">
                    Активные и заблокированные учётные записи,
                    созданные в календарных периодах.
                  </p>
                  {canOpenStudentList ? (
                    <div className="admin-dashboard-period-links">
                      <Link
                        aria-label="Открыть новых учеников за 7 дней"
                        className="admin-dashboard-metric-link"
                        href={studentsPeriodHref(
                          metrics.periods.last7DaysFrom,
                          metrics.periods.through,
                        )}
                      >
                        За 7 дней
                      </Link>
                      <Link
                        aria-label="Открыть новых учеников за 30 дней"
                        className="admin-dashboard-metric-link"
                        href={studentsPeriodHref(
                          metrics.periods.last30DaysFrom,
                          metrics.periods.through,
                        )}
                      >
                        За 30 дней
                      </Link>
                    </div>
                  ) : null}
                </article>
              </>
            ) : null}

            {metrics.access ? (
              <article
                aria-labelledby="active-access-title"
                className="admin-dashboard-metric-card"
              >
                <p
                  className="admin-dashboard-metric-label"
                  id="active-access-title"
                >
                  Действующий оплаченный доступ
                </p>
                <strong className="admin-dashboard-metric-value">
                  {formatMetric(
                    metrics.access.activePaidAccessStudents,
                  )}
                </strong>
                <p className="admin-dashboard-metric-note">
                  Уникальные ученики с действующим оплаченным
                  грантом.
                </p>
                {canOpenStudentList ? (
                  <Link
                    aria-label="Открыть учеников с действующим оплаченным доступом"
                    className="admin-dashboard-metric-link"
                    href="/admin/students?access=active&source=paid"
                  >
                    Открыть список
                  </Link>
                ) : null}
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      {metrics.billing ? (
        <section
          aria-labelledby="admin-dashboard-signals-title"
          className="admin-dashboard-section"
        >
          <div className="admin-dashboard-section-heading">
            <div>
              <p className="overline">Платёжный контур</p>
              <h2 id="admin-dashboard-signals-title">
                Сигналы для проверки
              </h2>
            </div>
            <p>
              Это счётчики очереди диагностики, а не бухгалтерский
              отчёт.
            </p>
          </div>

          <div className="admin-dashboard-signal-grid">
            <article
              aria-labelledby="pending-payments-title"
              className="admin-dashboard-signal-card"
            >
              <div className="admin-dashboard-signal-heading">
                <p id="pending-payments-title">
                  Ожидают не менее 15 минут
                </p>
                {signalBadge(
                  metrics.billing.stalePendingPayments,
                )}
              </div>
              <strong className="admin-dashboard-signal-value">
                {formatMetric(
                  metrics.billing.stalePendingPayments,
                )}
              </strong>
              <p>
                Платежи в состояниях «создан», «ожидает» или
                «требует действия», которые не обновлялись минимум
                15 минут.
              </p>
            </article>

            <article
              aria-labelledby="failed-webhooks-title"
              className="admin-dashboard-signal-card"
            >
              <div className="admin-dashboard-signal-heading">
                <p id="failed-webhooks-title">
                  Ошибки обработки webhook-событий
                </p>
                {signalBadge(
                  metrics.billing.failedWebhookEvents,
                  true,
                )}
              </div>
              <strong className="admin-dashboard-signal-value">
                {formatMetric(
                  metrics.billing.failedWebhookEvents,
                )}
              </strong>
              <p>
                События со статусом обработки «ошибка». Исходное
                тело события дашборд не читает и не отображает.
              </p>
            </article>
          </div>

          <p className="admin-dashboard-drilldown-note">
            Детализация этих сигналов появится вместе с отдельным
            read-only разделом платежной диагностики. До этого
            дашборд не выдаёт агрегаты за готовый раздел
            диагностики.
          </p>
        </section>
      ) : null}

      <details className="admin-dashboard-methodology">
        <summary>Как считаются показатели</summary>
        <div>
          <p>
            Новые ученики считаются за 7 и 30 календарных дней,
            включая текущий день в зоне{" "}
            {metrics.displayTimeZone}, и только до времени
            формирования снимка. Удалённые учётные записи исключены.
          </p>
          <p>
            Доступ сейчас учитывает только подтверждённый источник{" "}
            <code>billing_access_grants</code>: период начался, ещё
            не закончился и грант не отозван. Ручные гранты ещё не
            реализованы и в показатель не включаются.
          </p>
          <p>
            Денежные суммы, персональные данные, платёжные реквизиты
            и исходные тела webhook-событий в этот экран не
            передаются.
          </p>
        </div>
      </details>
    </>
  );
}
