import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CheckCircleIcon,
  CreditCardIcon,
  GearSixIcon,
  HouseIcon,
} from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Курсы, прогресс и подписка ученика.",
};

export default function DashboardPage() {
  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link href="/" aria-label="На главную">
          <Image
            src="/brand/logo-horizontal-dark.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </Link>
        <nav aria-label="Личный кабинет">
          <Link className="active" href="/dashboard">
            <HouseIcon aria-hidden="true" size={20} weight="fill" />
            Главная
          </Link>
          <Link href="/courses">
            <BookOpenTextIcon aria-hidden="true" size={20} />
            Мои курсы
          </Link>
          <Link href="/pricing">
            <CreditCardIcon aria-hidden="true" size={20} />
            Подписка
          </Link>
          <Link href="/dashboard">
            <GearSixIcon aria-hidden="true" size={20} />
            Настройки
          </Link>
        </nav>
        <div className="dashboard-user">
          <span>ГА</span>
          <div>
            <strong>Герман</strong>
            <small>Ученик Академии</small>
          </div>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div>
            <p className="overline">Личный кабинет</p>
            <h1>Добрый день, Герман</h1>
          </div>
          <div className="subscription-status">
            <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
            Подписка активна
          </div>
        </header>

        <section className="dashboard-continue" aria-labelledby="continue-title">
          <div className="dashboard-course-cover">
            <Image
              src="/images/academy-morning-routine.png"
              alt=""
              fill
              priority
              loading="eager"
              sizes="(max-width: 767px) 100vw, 38vw"
            />
          </div>
          <div>
            <p className="overline">Продолжить обучение</p>
            <h2 id="continue-title">Здоровые привычки</h2>
            <p>Модуль 1 · Урок 1: Маленький шаг, который останется</p>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={8}
              aria-label="Прогресс курса"
            >
              <span />
            </div>
            <small>Пройдено 8%</small>
            <Link
              className="button button-primary"
              href="/courses/healthy-habits/lessons/1"
            >
              Продолжить
              <ArrowRightIcon aria-hidden="true" size={19} />
            </Link>
          </div>
        </section>

        <section className="dashboard-section" aria-labelledby="my-courses">
          <div className="section-heading">
            <div>
              <p className="overline">Библиотека</p>
              <h2 id="my-courses">Мои курсы</h2>
            </div>
            <Link className="text-link" href="/courses">
              Все курсы
              <ArrowRightIcon aria-hidden="true" size={18} />
            </Link>
          </div>
          <article className="dashboard-course-row">
            <div className="dashboard-course-mark">
              <Image
                src="/brand/logo-mark.svg"
                alt=""
                width={58}
                height={58}
              />
            </div>
            <div>
              <h3>Здоровые привычки: система на каждый день</h3>
              <p>12 уроков · 4 модуля</p>
            </div>
            <Link
              className="button button-small button-secondary"
              href="/courses/healthy-habits"
            >
              Открыть
            </Link>
          </article>
        </section>
      </div>
    </main>
  );
}
