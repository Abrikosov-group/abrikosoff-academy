import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { AuthenticatedSiteHeader } from "@/components/academy/authenticated-site-header";

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
  {
    title: "Все курсы библиотеки",
    text: "одна подписка открывает всё.",
  },
  {
    title: "Новые материалы каждый месяц",
    text: "без доплат.",
  },
  {
    title: "Короткие текстовые уроки",
    text: "по 5–10 минут в удобном темпе.",
  },
  {
    title: "Продление без лишних действий",
    text: "подписка продлевается автоматически, пока она вам нужна.",
  },
];

const comingCourses = [
  {
    title: "Сон: восстановление как навык",
    text: "Режим, среда и вечерние ритуалы.",
  },
  {
    title: "Питание без крайностей",
    text: "Спокойные отношения с едой.",
  },
  {
    title: "Внимание и фокус",
    text: "Работа без постоянных отвлечений.",
  },
];

export default function HomePage() {
  return (
    <main>
      <AuthenticatedSiteHeader />

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
              От 1 167 ₽ в месяц · автоматическое продление
            </p>
          </div>

          <div className="hero-photo">
            <Image
              src="/images/academy-morning-routine.png"
              alt="Утренний стол с блокнотом и чаем"
              fill
              priority
              sizes="(max-width: 767px) 100vw, 480px"
            />
          </div>

          <div className="home-about" id="about">
            <h2>Что такое Академия</h2>
            <p>
              Это авторская образовательная среда: последовательные курсы без
              инфошума и обещаний «результата за неделю». Мы объясняем, как
              устроены привычки, и помогаем встроить их в обычную жизнь.
            </p>
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
          <h2 id="included-title">Что входит в подписку</h2>
          <ul className="included-list">
            {included.map((item) => (
              <li key={item.title}>
                <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
                <span>
                  <strong>{item.title}</strong> — {item.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-courses page-shell" aria-labelledby="courses-title">
        <div className="home-section-heading">
          <h2 id="courses-title">Курсы</h2>
          <Link href="/courses">Весь каталог</Link>
        </div>

        <div className="home-course-grid">
          <Link
            className="home-course-card"
            href="/courses/healthy-habits"
          >
            <div className="home-course-cover">
              <Image
                src="/images/course-cover-abstract.png"
                alt=""
                fill
                sizes="(max-width: 767px) 100vw, 285px"
              />
              <span className="badge badge-warm">Первый курс</span>
            </div>
            <div>
              <h3>Здоровые привычки</h3>
              <p>Система на каждый день — маленькими шагами.</p>
              <small>12 уроков · 6 разделов</small>
            </div>
          </Link>

          {comingCourses.map((course) => (
            <article className="home-course-card is-coming" key={course.title}>
              <div className="home-course-cover">
                <span className="badge badge-neutral">Скоро</span>
              </div>
              <div>
                <h3>{course.title}</h3>
                <p>{course.text}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="home-course-note">
          Библиотека пополняется каждый месяц — новые курсы и уроки сразу
          входят в подписку.
        </p>
      </section>

      <section className="home-pricing page-shell" aria-labelledby="home-pricing">
        <div>
          <h2 id="home-pricing">Одна подписка — вся Академия</h2>
          <p>
            Годовой тариф — 14 000 ₽ (выгода 4 000 ₽, −22%), месячный —
            1 500 ₽. Подписка продлевается автоматически; отключить
            продление можно в личном кабинете в любой момент.
          </p>
          <div className="home-pricing-actions">
            <Link className="button button-primary" href="/pricing">
              Смотреть тарифы
            </Link>
            <Link href="/terms">Условия подписки</Link>
          </div>
        </div>
        <div className="home-price-card">
          <span className="badge badge-success">−22% · выгода 4 000 ₽</span>
          <div>
            <strong>Годовой</strong>
            <b>14 000 ₽<small>/год</small></b>
          </div>
          <div>
            <strong>Месячный</strong>
            <b>1 500 ₽<small>/мес</small></b>
          </div>
        </div>
      </section>

      <section className="home-faq page-shell" aria-labelledby="faq-title">
        <h2 id="faq-title">Частые вопросы</h2>
        <div className="faq-list">
          <details open>
            <summary>Как работает автоматическое продление?</summary>
            <p>
              Следующая оплата проходит автоматически в конце периода.
              Продление можно отключить в личном кабинете; доступ сохранится
              до конца уже оплаченного периода.
            </p>
          </details>
          <details>
            <summary>Как войти без Telegram?</summary>
            <p>
              На запуске вход работает через Telegram. Вход по электронной
              почте добавим после подключения сервиса отправки писем.
            </p>
          </details>
          <details>
            <summary>Что будет с прогрессом после отмены?</summary>
            <p>Он сохранится, и после возвращения можно продолжить чтение.</p>
          </details>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
