import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CheckCircleIcon,
  ClockIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { SiteHeader } from "@/components/academy/site-header";

export const metadata: Metadata = {
  title: "Здоровые привычки",
  description:
    "Практический курс о привычках, которые поддерживают здоровье каждый день.",
};

const modules = [
  {
    number: "01",
    title: "Начинаем с опоры",
    text: "Как выбрать одну привычку и сделать её посильной.",
  },
  {
    number: "02",
    title: "Среда сильнее силы воли",
    text: "Настраиваем пространство так, чтобы нужное действие стало проще.",
  },
  {
    number: "03",
    title: "Сон, питание и движение",
    text: "Собираем личную систему без жёстких правил и перегрузки.",
  },
  {
    number: "04",
    title: "Как сохранить результат",
    text: "Возвращаемся после перерыва и замечаем реальный прогресс.",
  },
];

export default function HealthyHabitsPage() {
  return (
    <main>
      <SiteHeader />
      <section className="course-page">
        <div className="page-shell course-hero">
          <div className="course-hero-copy">
            <span className="badge badge-warm">Первый курс Академии</span>
            <h1>Здоровые привычки: система на каждый день</h1>
            <p>
              Вы построите простую систему из небольших действий, которая
              работает в обычной жизни — без марафонов и чувства вины.
            </p>
            <div className="course-meta course-meta-large">
              <span>
                <BookOpenTextIcon aria-hidden="true" size={20} /> 12 уроков
              </span>
              <span>
                <ClockIcon aria-hidden="true" size={20} /> 5–10 минут на урок
              </span>
            </div>
            <div className="hero-actions">
              <Link className="button button-primary" href="/pricing">
                Получить доступ
              </Link>
              <Link
                className="button button-secondary"
                href="/courses/healthy-habits/lessons/1"
              >
                Прочитать первый урок
              </Link>
            </div>
          </div>
          <div className="course-hero-image">
            <Image
              src="/images/academy-morning-routine.png"
              alt="Спокойное утро с блокнотом и чашкой чая"
              fill
              priority
              sizes="(max-width: 767px) 100vw, 44vw"
            />
          </div>
        </div>

        <div className="course-intro">
          <div className="page-shell course-intro-grid">
            <div>
              <p className="overline overline-light">Результат курса</p>
              <h2>Не идеальный режим, а надёжная опора</h2>
            </div>
            <ul className="included-list">
              <li>
                <CheckCircleIcon aria-hidden="true" size={22} weight="fill" />
                Поймёте, с какой привычки начать именно вам.
              </li>
              <li>
                <CheckCircleIcon aria-hidden="true" size={22} weight="fill" />
                Соберёте понятный ритм дня без резких перестроек.
              </li>
              <li>
                <CheckCircleIcon aria-hidden="true" size={22} weight="fill" />
                Научитесь спокойно возвращаться после перерывов.
              </li>
            </ul>
          </div>
        </div>

        <section className="section page-shell" aria-labelledby="program-title">
          <div className="section-heading">
            <div>
              <p className="overline">Программа</p>
              <h2 id="program-title">Четыре последовательных модуля</h2>
            </div>
          </div>
          <div className="program-list">
            {modules.map((module) => (
              <article key={module.number}>
                <span>{module.number}</span>
                <div>
                  <h3>{module.title}</h3>
                  <p>{module.text}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="course-bottom-cta">
            <div>
              <h2>Начните с одного короткого урока</h2>
              <p>Первый урок открыт в прототипе и занимает около пяти минут.</p>
            </div>
            <Link
              className="button button-primary"
              href="/courses/healthy-habits/lessons/1"
            >
              Открыть урок
              <ArrowRightIcon aria-hidden="true" size={20} />
            </Link>
          </div>
        </section>
      </section>
      <SiteFooter />
    </main>
  );
}
