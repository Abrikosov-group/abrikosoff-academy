import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import {
  formatCabinetDate,
  getCabinetContext,
} from "../_lib/cabinet-context";

export const metadata: Metadata = {
  title: "Подписка",
  description: "Статус доступа и тарифы Академии.",
};

const included = [
  "Все курсы библиотеки",
  "Новые материалы без доплат",
  "Без автоматического продления",
];

export default async function CabinetSubscriptionPage() {
  const {
    subscription,
    subscriptionActive,
    subscriptionEnded,
  } = await getCabinetContext();
  const periodEnd = subscription?.currentPeriodEnd
    ? formatCabinetDate(subscription.currentPeriodEnd)
    : null;

  return (
    <>
      <header className="cabinet-section-heading">
        <p className="overline">Доступ к Академии</p>
        <h1>Подписка</h1>
        <p>
          Здесь можно проверить оплаченный период и выбрать следующий
          тариф.
        </p>
      </header>

      {subscriptionActive ? (
        <section
          className="cabinet-subscription-detail"
          aria-labelledby="current-subscription-title"
        >
          <header>
            <div>
              <p className="overline">Текущий тариф</p>
              <h2 id="current-subscription-title">
                {subscription?.planId === "annual"
                  ? "Годовой"
                  : "Месячный"}
              </h2>
            </div>
            <span className="badge badge-success">Активна</span>
          </header>
          <dl>
            <div>
              <dt>Доступ оплачен до</dt>
              <dd>{periodEnd}</dd>
            </div>
            <div>
              <dt>Продление</dt>
              <dd>
                {subscription?.autoRenew
                  ? "Автоматически"
                  : "Только вручную"}
              </dd>
            </div>
          </dl>
          <p>
            Все материалы Академии доступны до конца оплаченного
            периода.
          </p>
          <Link
            className="button button-primary"
            href="/dashboard/courses"
          >
            Перейти к курсам
          </Link>
        </section>
      ) : (
        <>
          {subscriptionEnded ? (
            <p className="cabinet-status-note">
              Предыдущий оплаченный период завершился {periodEnd}.
              Выберите новый тариф, чтобы восстановить доступ.
            </p>
          ) : null}

          <div className="cabinet-plan-grid">
            <article className="cabinet-plan-card cabinet-plan-card-featured">
              <span className="badge badge-success">
                −22% · выгода 4 000 ₽
              </span>
              <h2>Годовой</h2>
              <p className="cabinet-plan-price">
                <strong>14 000 ₽</strong>
                <span>/ год</span>
              </p>
              <p>≈ 1 167 ₽ в месяц вместо 1 500 ₽</p>
              <ul>
                {included.map((item) => (
                  <li key={item}>
                    <CheckCircleIcon
                      aria-hidden="true"
                      size={17}
                      weight="fill"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                className="button button-primary"
                href="/checkout?plan=annual"
              >
                Выбрать годовой
              </Link>
            </article>

            <article className="cabinet-plan-card">
              <h2>Месячный</h2>
              <p className="cabinet-plan-price">
                <strong>1 500 ₽</strong>
                <span>/ месяц</span>
              </p>
              <p>Тот же полный доступ на один месяц</p>
              <ul>
                {included.map((item) => (
                  <li key={item}>
                    <CheckCircleIcon
                      aria-hidden="true"
                      size={17}
                      weight="fill"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                className="button button-secondary"
                href="/checkout?plan=monthly"
              >
                Выбрать месячный
              </Link>
            </article>
          </div>
          <p className="cabinet-payment-note">
            Оплата проходит на защищённой странице ЮKassa.
            Повторных списаний нет.
          </p>
        </>
      )}
    </>
  );
}
