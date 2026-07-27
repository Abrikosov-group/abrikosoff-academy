import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircleIcon,
  InfoIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { AuthenticatedSiteHeader } from "@/components/academy/authenticated-site-header";

export const metadata: Metadata = {
  title: "Тарифы",
  description: "Месячная и годовая подписка на все курсы Академии.",
};

type PricingPageProps = {
  searchParams: Promise<{ period?: string }>;
};

const benefits = [
  "Все курсы библиотеки и новые материалы без доплат",
  "Вход через Telegram или по ссылке на почту",
  "Оплата на защищённой странице ЮKassa",
];

export default async function PricingPage({
  searchParams,
}: PricingPageProps) {
  const { period } = await searchParams;
  const selectedPeriod = period === "monthly" ? "monthly" : "annual";

  return (
    <main>
      <AuthenticatedSiteHeader />
      <section className="pricing-page">
        <div className="pricing-shell">
          <header className="pricing-heading">
            <h1>Подписка на Академию</h1>
            <p>Один тариф — вся библиотека курсов и все новые материалы.</p>
          </header>

          <div className="plan-tabs" aria-label="Период подписки">
            <Link
              className={selectedPeriod === "monthly" ? "active" : undefined}
              href="/pricing?period=monthly"
            >
              Месяц
            </Link>
            <Link
              className={selectedPeriod === "annual" ? "active" : undefined}
              href="/pricing?period=annual"
            >
              Год · −22%
            </Link>
          </div>

          <div className="pricing-grid">
            <article
              className={`plan-card plan-card-annual ${
                selectedPeriod === "annual" ? "plan-card-featured" : ""
              }`}
            >
              <span className="badge badge-success">
                −22% · выгода 4 000 ₽
              </span>
              <h2>Годовой</h2>
              <p className="plan-price">
                <strong>14 000 ₽</strong>
                <span>/ год</span>
              </p>
              <p className="plan-equivalent">
                ≈ 1 167 ₽ в месяц вместо 1 500 ₽
              </p>
              <ul className="plan-mobile-features">
                <li>
                  <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />
                  Все курсы библиотеки и новые материалы
                </li>
                <li>
                  <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />
                  Чтение с телефона и компьютера
                </li>
                <li>
                  <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />
                  Без автоматического продления
                </li>
              </ul>
              <Link className="button button-primary" href="/login?plan=annual">
                Продолжить с годовым
              </Link>
              <p className="plan-note">
                Разовая оплата · <Link href="/terms">условия</Link>
              </p>
            </article>

            <article
              className={`plan-card plan-card-monthly ${
                selectedPeriod === "monthly" ? "plan-card-featured" : ""
              }`}
            >
              <h2>Месячный</h2>
              <p className="plan-price">
                <strong>1 500 ₽</strong>
                <span>/ месяц</span>
              </p>
              <p className="plan-equivalent">Тот же полный доступ</p>
              <Link
                className="button button-secondary"
                href="/login?plan=monthly"
              >
                Выбрать месячный
              </Link>
              <p className="plan-note">
                Разовая оплата · <Link href="/terms">условия</Link>
              </p>
            </article>
          </div>

          <ul className="pricing-benefits">
            {benefits.map((benefit) => (
              <li key={benefit}>
                <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
                {benefit}
              </li>
            ))}
          </ul>

          <div className="pricing-mobile-note">
            <InfoIcon aria-hidden="true" size={19} weight="fill" />
            <p>
              Оплата проходит на защищённой странице ЮKassa. Повторных списаний
              нет: после окончания периода доступ можно оплатить снова.
            </p>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
