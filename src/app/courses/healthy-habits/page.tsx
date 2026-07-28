import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CaretDownIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { AuthenticatedSiteHeader } from "@/components/academy/authenticated-site-header";

export const metadata: Metadata = {
  title: "Здоровые привычки",
  description:
    "Практический курс о привычках, которые поддерживают здоровье каждый день.",
};

const sections = [
  {
    title: "Раздел 1. Основы: как устроены привычки",
    lessons: [
      ["1. Почему сила воли не работает", "5 мин"],
      ["2. Сигналы и награды", "6 мин"],
    ],
  },
  { title: "Раздел 2. Утренний распорядок" },
  { title: "Раздел 3. Питание и энергия" },
  { title: "Разделы 4–6" },
];

const subscriptionBenefits = [
  "Вся библиотека курсов сразу",
  "Новые материалы без доплат",
  "Без автоматического продления",
];

export default function HealthyHabitsPage() {
  return (
    <main>
      <AuthenticatedSiteHeader />
      <section className="course-detail-page">
        <div className="page-shell">
          <nav className="breadcrumbs" aria-label="Хлебные крошки">
            <Link href="/courses">Курсы</Link>
            <span>›</span>
            <strong>Здоровые привычки</strong>
          </nav>

          <div className="course-detail-grid">
            <div className="course-detail-main">
              <header className="course-detail-cover">
                <Image
                  src="/images/course-cover-abstract.png"
                  alt=""
                  fill
                  priority
                  sizes="(max-width: 767px) 100vw, 684px"
                />
                <div>
                  <p className="overline">Курс Академии</p>
                  <h1>Здоровые привычки: система на каждый день</h1>
                  <p className="course-detail-meta">
                    12 уроков · 6 разделов · 5–10 минут на урок · обновляется
                  </p>
                </div>
              </header>

              <p className="course-detail-lead">
                Курс о том, как выстроить здоровые привычки без силы воли и
                марафонов: маленькие действия, привязанные к вашему обычному
                дню.
              </p>

              <div className="course-mobile-benefits">
                {subscriptionBenefits.map((benefit) => (
                  <p key={benefit}>
                    <CheckCircleIcon
                      aria-hidden="true"
                      size={17}
                      weight="fill"
                    />
                    {benefit}
                  </p>
                ))}
              </div>

              <section className="course-program" aria-labelledby="program-title">
                <h2 id="program-title">Программа</h2>
                <div className="course-program-list">
                  {sections.map((section, index) => (
                    <details key={section.title} open={index === 0}>
                      <summary>
                        {section.title}
                        <CaretDownIcon aria-hidden="true" size={18} />
                      </summary>
                      {section.lessons ? (
                        <div className="course-program-lessons">
                          {section.lessons.map(([title, duration]) => (
                            <div key={title}>
                              <span>{title}</span>
                              <small>{duration}</small>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </details>
                  ))}
                </div>
              </section>

              <section className="course-author" aria-label="Автор курса">
                <span className="course-author-mark">
                  <Image
                    src="/brand/logo-mark.svg"
                    alt=""
                    width={28}
                    height={28}
                  />
                </span>
                <div>
                  <h2>Автор Академии</h2>
                  <p>
                    Практик системного подхода к привычкам; ведёт Академию с
                    2024 года.
                  </p>
                </div>
              </section>
            </div>

            <aside className="course-subscription-card">
              <h2>Курс входит в подписку</h2>
              <ul>
                {subscriptionBenefits.map((benefit) => (
                  <li key={benefit}>
                    <CheckCircleIcon
                      aria-hidden="true"
                      size={17}
                      weight="fill"
                    />
                    {benefit}
                  </li>
                ))}
              </ul>
              <div className="course-price-list">
                <div>
                  <strong>Годовой</strong>
                  <b>
                    14 000 ₽<small>/год</small>
                  </b>
                  <span>−22% · выгода 4 000 ₽</span>
                </div>
                <div>
                  <strong>Месячный</strong>
                  <b>
                    1 500 ₽<small>/мес</small>
                  </b>
                </div>
              </div>
              <Link className="button button-primary" href="/pricing">
                Выбрать тариф
              </Link>
              <p>
                Оплата через ЮKassa · <Link href="/terms">условия</Link>
              </p>
            </aside>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
