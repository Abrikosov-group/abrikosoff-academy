import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeftIcon,
  BookOpenTextIcon,
  ClockIcon,
  ListIcon,
} from "@phosphor-icons/react/dist/ssr";
import { LessonCompleteButton } from "@/components/academy/lesson-complete-button";

export const metadata: Metadata = {
  title: "Урок 1. Маленький шаг",
  description: "Первый урок курса «Здоровые привычки».",
};

export default function FirstLessonPage() {
  return (
    <main className="lesson-shell">
      <header className="lesson-header">
        <Link className="lesson-brand" href="/dashboard">
          <Image
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </Link>
        <span>Урок 1 из 12</span>
        <Link
          className="icon-link"
          href="/courses/healthy-habits"
          aria-label="Содержание курса"
        >
          <ListIcon aria-hidden="true" size={23} />
        </Link>
      </header>

      <div className="lesson-layout">
        <aside className="lesson-sidebar">
          <Link href="/courses/healthy-habits">
            <ArrowLeftIcon aria-hidden="true" size={18} />
            К курсу
          </Link>
          <p className="overline">Модуль 1</p>
          <h2>Начинаем с опоры</h2>
          <ol>
            <li className="active">Маленький шаг, который останется</li>
            <li>Ваша точка старта</li>
            <li>Среда вместо силы воли</li>
          </ol>
        </aside>

        <article className="lesson-content">
          <div className="lesson-breadcrumbs">
            <BookOpenTextIcon aria-hidden="true" size={19} />
            Здоровые привычки · Модуль 1
          </div>
          <h1>Маленький шаг, который останется</h1>
          <div className="lesson-meta">
            <ClockIcon aria-hidden="true" size={18} />
            5 минут чтения
          </div>

          <div className="lesson-prose">
            <p className="lesson-lead">
              Устойчивая привычка начинается не с силы воли, а с действия,
              которое настолько посильно, что ему легко найти место в обычном
              дне.
            </p>
            <h2>Почему мы начинаем с малого</h2>
            <p>
              Когда новая цель требует слишком много времени и внимания, мозг
              быстро записывает её в категорию «сложно». Первые несколько дней
              могут держаться на энтузиазме, но затем вмешиваются работа,
              усталость и неожиданные дела.
            </p>
            <p>
              Наша задача — выбрать минимальную версию полезного действия. Не
              час тренировки, а пять минут движения. Не идеальный рацион, а
              один понятный завтрак. Такой шаг создаёт повторение, а повторение
              постепенно становится опорой.
            </p>

            <div className="lesson-quote">
              <p>
                Хорошая первая привычка выглядит почти слишком простой. Именно
                поэтому у неё есть шанс остаться.
              </p>
            </div>

            <h2>Практика на сегодня</h2>
            <div className="lesson-task">
              <span>Задание</span>
              <h3>Выберите действие на две минуты</h3>
              <p>
                Запишите одну привычку, которую хотите развить, и её самую
                маленькую версию. Формулировка должна начинаться с глагола:
                «выпить стакан воды», «пройтись пять минут», «открыть дневник».
              </p>
            </div>
          </div>

          <LessonCompleteButton />
        </article>
      </div>
    </main>
  );
}
