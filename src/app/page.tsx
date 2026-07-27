import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CheckCircleIcon,
  ClockIcon,
  SparkleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { SiteHeader } from "@/components/academy/site-header";

export const metadata: Metadata = {
  title: "Здоровые привычки — спокойно и по системе",
  description:
    "Подписка на библиотеку практических курсов о привычках, здоровье и качестве жизни.",
};

const benefits = [
  {
    title: "Хотите системности",
    text: "Устали от разрозненных советов и хотите понятную последовательность шагов.",
  },
  {
    title: "Цените своё время",
    text: "Уроки по 5–10 минут, которые удобно читать между делами.",
  },
  {
    title: "Без крайностей",
    text: "Никаких марафонов и жёстких ограничений — только устойчивые изменения.",
  },
];

const included = [
  "Все курсы библиотеки — одна подписка открывает всё.",
  "Новые материалы каждый месяц — без доплат.",
  "Прогресс и продолжение — вернётесь туда, где остановились.",
  "Отмена в один клик — доступ до конца оплаченного периода.",
];

export default function HomePage() {
  return (
    <main>
      <SiteHeader />

      <section className="home-hero" aria-labelledby="home-title">
        <div className="page-shell home-hero-grid">
          <div className="home-hero-copy">
            <p className="overline">Академия Абрикософф</p>
            <h1 id="home-title">Здоровые привычки — спокойно и по системе</h1>
            <p className="hero-lead">
              Подписка на библиотеку практических курсов о привычках, здоровье
              и качестве жизни. Короткие текстовые уроки — читайте в удобном
              темпе.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/pricing">
                Выбрать тариф
              </Link>
              <Link
                className="button button-secondary"
                href="/courses/healthy-habits"
              >
                Смотреть первый курс
              </Link>
            </div>
            <p className="hero-note">
              От 1 167 ₽ в месяц · отмена продления в один клик
            </p>
          </div>

          <div className="hero-photo">
            <Image
              src="/images/academy-morning-routine.png"
              alt="Утренний стол с блокнотом, чаем и веточкой зелени"
              width={1536}
              height={1024}
              priority
              loading="eager"
              sizes="(max-width: 767px) 100vw, 46vw"
            />
          </div>

          <div className="benefit-grid" aria-label="Для кого Академия">
            {benefits.map((benefit) => (
              <article className="benefit-card" key={benefit.title}>
                <h2>{benefit.title}</h2>
                <p>{benefit.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="included-section" aria-labelledby="included-title">
        <div className="page-shell included-grid">
          <div>
            <p className="overline overline-light">Одна подписка</p>
            <h2 id="included-title">Что входит в подписку</h2>
          </div>
          <ul className="included-list">
            {included.map((item) => (
              <li key={item}>
                <CheckCircleIcon aria-hidden="true" size={22} weight="fill" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section page-shell" id="courses">
        <div className="section-heading">
          <div>
            <p className="overline">Курсы Академии</p>
            <h2>Начните с первого курса</h2>
          </div>
          <Link className="text-link" href="/courses">
            Каталог <ArrowRightIcon aria-hidden="true" size={18} />
          </Link>
        </div>

        <div className="home-course-grid">
          <article className="featured-course">
            <div className="course-cover course-cover-photo">
              <Image
                src="/images/academy-morning-routine.png"
                alt=""
                fill
                loading="eager"
                sizes="(max-width: 767px) 100vw, 55vw"
              />
              <span className="badge badge-warm">Первый курс</span>
            </div>
            <div className="course-body">
              <p className="overline">Курс Академии</p>
              <h3>Здоровые привычки</h3>
              <p>
                Система на каждый день: сон, питание, движение и внимание —
                маленькими шагами.
              </p>
              <div className="course-meta">
                <span>
                  <BookOpenTextIcon aria-hidden="true" size={18} /> 12 уроков
                </span>
                <span>
                  <ClockIcon aria-hidden="true" size={18} /> 5–10 минут
                </span>
              </div>
              <Link
                className="button button-secondary button-inline"
                href="/courses/healthy-habits"
              >
                О курсе
              </Link>
            </div>
          </article>

          <div className="coming-course-list">
            <article className="coming-course-card">
              <div className="coming-course-visual" aria-hidden="true">
                <Image
                  src="/brand/logo-mark.svg"
                  alt=""
                  width={72}
                  height={72}
                />
              </div>
              <div>
                <span className="badge badge-neutral">Скоро</span>
                <h3>Сон: восстановление как навык</h3>
                <p>Режим, среда и вечерние ритуалы без борьбы с собой.</p>
              </div>
            </article>
            <article className="coming-course-card">
              <div className="coming-course-visual" aria-hidden="true">
                <SparkleIcon size={56} weight="duotone" />
              </div>
              <div>
                <span className="badge badge-neutral">Скоро</span>
                <h3>Питание без крайностей</h3>
                <p>Спокойные отношения с едой — без диет и запретов.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="pricing-preview" id="pricing">
        <div className="page-shell pricing-preview-grid">
          <div>
            <p className="overline">Подписка</p>
            <h2>Вся Академия — по одному тарифу</h2>
            <p>Все текущие и будущие курсы входят в подписку без доплат.</p>
          </div>
          <div className="price-summary">
            <span className="badge badge-success">−22% · выгода 4 000 ₽</span>
            <p>Годовой</p>
            <strong>14 000 ₽</strong>
            <span>≈ 1 167 ₽ в месяц</span>
          </div>
          <div className="price-summary price-summary-secondary">
            <p>Месячный</p>
            <strong>1 500 ₽</strong>
            <span>в месяц</span>
          </div>
          <Link className="button button-primary" href="/pricing">
            Смотреть тарифы
          </Link>
        </div>
      </section>

      <section className="section page-shell faq-section" id="about">
        <div className="section-heading">
          <div>
            <p className="overline">Коротко и ясно</p>
            <h2>Частые вопросы</h2>
          </div>
        </div>
        <div className="faq-list">
          <details open>
            <summary>Как отменить продление?</summary>
            <p>
              В кабинете, в разделе «Подписка», одним нажатием. Доступ
              сохранится до конца оплаченного периода.
            </p>
          </details>
          <details>
            <summary>Как войти без Telegram?</summary>
            <p>
              Укажите электронную почту — мы пришлём одноразовую ссылку для
              входа. Пароль не потребуется.
            </p>
          </details>
          <details>
            <summary>Что будет с прогрессом после отмены?</summary>
            <p>
              Прогресс останется в кабинете. После возобновления подписки вы
              продолжите с того же места.
            </p>
          </details>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
