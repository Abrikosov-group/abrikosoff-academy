import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  formatCabinetDate,
  getCabinetContext,
} from "./_lib/cabinet-context";

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
    subscriptionActive,
    subscriptionEnded,
  } = await getCabinetContext();
  const periodEnd = subscription?.currentPeriodEnd
    ? formatCabinetDate(subscription.currentPeriodEnd)
    : null;
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
                subscriptionActive
                  ? "/courses/healthy-habits/lessons/1"
                  : "/dashboard/subscription"
              }
            >
              {subscriptionActive
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
              {subscriptionActive
                ? "Активна"
                : subscriptionEnded
                  ? "Завершена"
                  : "Не оформлена"}
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
            <p>
              {subscriptionEnded
                ? `Оплаченный период завершён ${periodEnd}. Выберите тариф, чтобы снова открыть курсы.`
                : "Выберите тариф, чтобы открыть все курсы Академии."}
            </p>
          )}
          <Link href="/dashboard/subscription">
            {subscriptionActive
              ? "Управление подпиской"
              : "Выбрать тариф"}
          </Link>
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
