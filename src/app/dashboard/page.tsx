import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TelegramLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { getDatabasePool } from "@/lib/database";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { getCurrentUser } from "@/modules/identity/server/session";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Курсы и оплаченный доступ ученика.",
};

const coming = [
  ["Сон: восстановление как навык", "август"],
  ["Питание без крайностей", "осень"],
];

function getInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "А";
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const subscription = await getSubscriptionSummary(
    getDatabasePool(),
    user.id,
  );
  const subscriptionActive =
    hasCurrentSubscriptionAccess(subscription);
  const subscriptionEnded = Boolean(
    subscription?.currentPeriodEnd && !subscriptionActive,
  );
  const periodEnd = subscription?.currentPeriodEnd
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Moscow",
      }).format(new Date(subscription.currentPeriodEnd))
    : null;
  const firstName = user.displayName.split(/\s+/)[0] || "ученик";
  const initials = getInitials(user.displayName);

  return (
    <main className="cabinet-page">
      <header className="cabinet-header">
        <Link href="/" aria-label="На главную">
          <Image
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </Link>
        <div>
          <span
            className={`badge ${
              subscriptionActive ? "badge-success" : "badge-neutral"
            }`}
          >
            {subscriptionActive
              ? "Подписка активна"
              : subscriptionEnded
                ? "Доступ завершён"
                : "Нет подписки"}
          </span>
          <span className="header-avatar">{initials}</span>
        </div>
      </header>

      <div className="cabinet-layout">
        <aside className="cabinet-sidebar">
          <nav aria-label="Личный кабинет">
            <Link className="active" href="/dashboard">
              Обзор
            </Link>
            <Link href="/courses">Мои курсы</Link>
            <Link href="/pricing">Подписка</Link>
            <Link href="/dashboard">История платежей</Link>
            <Link href="/dashboard">Профиль и вход</Link>
          </nav>
          <a
            className="cabinet-support"
            href="https://t.me/AbrikosoffBot"
            rel="noreferrer"
            target="_blank"
          >
            <TelegramLogoIcon aria-hidden="true" size={15} weight="fill" />
            Поддержка
          </a>
        </aside>

        <div className="cabinet-main">
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
                      : "/pricing"
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
              <Link href="/pricing">
                {subscriptionActive
                  ? "Посмотреть тарифы"
                  : "Выбрать тариф"}
              </Link>
              <div className="cabinet-total-progress">
                <p>
                  <strong>Продление</strong>
                  <span>Только вручную</span>
                </p>
              </div>
            </section>
          </div>

          <section className="cabinet-courses" aria-labelledby="my-courses">
            <header>
              <h2 id="my-courses">Мои курсы</h2>
              <Link href="/courses">Каталог</Link>
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
        </div>
      </div>
    </main>
  );
}
