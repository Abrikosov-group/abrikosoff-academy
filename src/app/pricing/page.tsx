import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircleIcon,
  ShieldCheckIcon,
  SparkleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { SiteHeader } from "@/components/academy/site-header";

export const metadata: Metadata = {
  title: "Тарифы",
  description: "Месячная и годовая подписка на все курсы Академии.",
};

type PricingPageProps = {
  searchParams: Promise<{ period?: string }>;
};

const features = [
  "Все текущие курсы Академии",
  "Новые материалы без доплат",
  "Личный прогресс и продолжение с нужного места",
  "Отмена продления в личном кабинете",
];

export default async function PricingPage({
  searchParams,
}: PricingPageProps) {
  const { period } = await searchParams;
  const selectedPeriod = period === "monthly" ? "monthly" : "annual";

  return (
    <main>
      <SiteHeader />
      <section className="inner-page pricing-page">
        <div className="page-shell">
          <header className="inner-page-header centered-heading">
            <p className="overline">Подписка на Академию</p>
            <h1>Выберите удобный период</h1>
            <p>
              Один тариф открывает всю библиотеку курсов. Начать можно с любого
              урока.
            </p>
          </header>

          <div className="plan-tabs" aria-label="Период подписки">
            <Link
              className={selectedPeriod === "annual" ? "active" : undefined}
              href="/pricing?period=annual"
            >
              Год
              <span>выгоднее</span>
            </Link>
            <Link
              className={selectedPeriod === "monthly" ? "active" : undefined}
              href="/pricing?period=monthly"
            >
              Месяц
            </Link>
          </div>

          <div className="pricing-grid">
            <article
              className={`plan-card ${
                selectedPeriod === "annual" ? "plan-card-featured" : ""
              }`}
            >
              <div className="plan-card-heading">
                <div>
                  <span className="badge badge-success">Выгода 4 000 ₽</span>
                  <h2>Годовой</h2>
                </div>
                <SparkleIcon aria-hidden="true" size={32} weight="duotone" />
              </div>
              <p className="plan-price">
                <strong>14 000 ₽</strong>
                <span>за год</span>
              </p>
              <p className="plan-equivalent">≈ 1 167 ₽ в месяц</p>
              <ul className="plan-features">
                {features.map((feature) => (
                  <li key={feature}>
                    <CheckCircleIcon
                      aria-hidden="true"
                      size={21}
                      weight="fill"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                className="button button-primary"
                href="/login?plan=annual"
              >
                Выбрать год
              </Link>
              <p className="plan-note">
                Оплата один раз в год. Продление можно отключить заранее.
              </p>
            </article>

            <article
              className={`plan-card ${
                selectedPeriod === "monthly" ? "plan-card-featured" : ""
              }`}
            >
              <div className="plan-card-heading">
                <div>
                  <span className="badge badge-neutral">Гибкий старт</span>
                  <h2>Месячный</h2>
                </div>
                <ShieldCheckIcon
                  aria-hidden="true"
                  size={32}
                  weight="duotone"
                />
              </div>
              <p className="plan-price">
                <strong>1 500 ₽</strong>
                <span>в месяц</span>
              </p>
              <p className="plan-equivalent">Оплата каждый месяц</p>
              <ul className="plan-features">
                {features.map((feature) => (
                  <li key={feature}>
                    <CheckCircleIcon
                      aria-hidden="true"
                      size={21}
                      weight="fill"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                className="button button-secondary"
                href="/login?plan=monthly"
              >
                Выбрать месяц
              </Link>
              <p className="plan-note">
                Подходит, чтобы познакомиться с форматом Академии.
              </p>
            </article>
          </div>

          <div className="pricing-assurance">
            <ShieldCheckIcon aria-hidden="true" size={28} weight="duotone" />
            <div>
              <h2>Без неожиданностей</h2>
              <p>
                Сумма и дата следующего списания всегда видны в кабинете.
                Продление отключается в один клик.
              </p>
            </div>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
