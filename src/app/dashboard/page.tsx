import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  formatCabinetDate,
  getCabinetAccessBasisPresentation,
  getCabinetContext,
} from "./_lib/cabinet-context";
import {
  createCabinetAccessPresentation,
} from "./_lib/cabinet-access-presentation";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Курсы и оплаченный доступ ученика.",
};

const coming = [
  ["Сон: восстановление как навык", "август"],
  ["Питание без крайностей", "осень"],
];

export default async function DashboardPage() {
  const {
    user,
    subscription,
    canReadCourses,
    subscriptionActive,
    subscriptionEnded,
    appliedEffectiveAccess,
  } = await getCabinetContext();
  const periodEnd = subscription?.currentPeriodEnd
    ? formatCabinetDate(subscription.currentPeriodEnd)
    : null;
  const accessBasisPresentation =
    getCabinetAccessBasisPresentation(appliedEffectiveAccess);
  const accessPresentation = createCabinetAccessPresentation({
    canReadCourses,
    subscriptionActive,
    subscriptionEnded,
    hasSubscription: Boolean(subscription),
    formattedPeriodEnd: periodEnd,
    ...accessBasisPresentation,
  });
  const firstName = user.displayName.split(/\s+/)[0] || "ученик";

  return (
    <>
      <h1>Добрый день, {firstName}</h1>

      <div className="cabinet-overview-grid">
        <section
          className="cabinet-continue"
          aria-labelledby="continue-title"
        >
          <p className="overline">Первый курс</p>
          <h2 id="continue-title">
            Здоровые привычки: система на каждый день
          </h2>
          <p>12 коротких текстовых уроков · 6 разделов</p>
          <div className="cabinet-continue-actions">
            <Link
              className="button button-secondary"
              href={
                canReadCourses
                  ? "/courses/healthy-habits/lessons/1"
                  : "/dashboard/subscription"
              }
            >
              {canReadCourses
                ? "Открыть первый урок"
                : "Оформить доступ"}
            </Link>
          </div>
        </section>

        <section className="cabinet-subscription">
          <header>
            <h2>Подписка</h2>
            <span
              className={`badge ${
                subscriptionActive ? "badge-success" : "badge-neutral"
              }`}
            >
              {accessPresentation.paidSubscriptionStatus}
            </span>
          </header>
          {subscriptionActive ? (
            <p>
              {subscription?.planId === "annual"
                ? "Годовой тариф"
                : "Месячный тариф"}{" "}
              · доступ до
              <br />
              <strong>
                {periodEnd} · без повторного списания
              </strong>
            </p>
          ) : (
            <p>{accessPresentation.inactiveSubscriptionSummary}</p>
          )}
          {accessPresentation.additionalAccessNote ? (
            <p>{accessPresentation.additionalAccessNote}</p>
          ) : null}
          <Link href="/dashboard/subscription">
            {subscriptionActive
              ? "Управление подпиской"
              : "Выбрать тариф"}
          </Link>
          {accessPresentation.showRenewalDetails ? (
            <div className="cabinet-total-progress">
              <p>
                <strong>Продление</strong>
                <span>
                  {subscription?.autoRenew
                    ? "Автоматически"
                    : "Только вручную"}
                </span>
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <section className="cabinet-courses" aria-labelledby="my-courses">
        <header>
          <h2 id="my-courses">Мои курсы</h2>
          <Link href="/dashboard/courses">Все курсы</Link>
        </header>
        <div className="cabinet-course-grid">
          <Link
            className="cabinet-course-card"
            href="/courses/healthy-habits"
          >
            <div>
              <Image
                src="/images/course-cover-abstract.png"
                alt=""
                fill
                loading="eager"
                sizes="(max-width: 767px) 100vw, 260px"
              />
            </div>
            <section>
              <h3>Здоровые привычки</h3>
              <p>
                <span>12 уроков</span>
                <span>6 разделов</span>
              </p>
            </section>
          </Link>
          {coming.map(([title, date]) => (
            <article className="cabinet-coming-card" key={title}>
              <span className="badge badge-neutral">Скоро</span>
              <h3>{title}</h3>
              <p>{date} · войдёт в подписку</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
