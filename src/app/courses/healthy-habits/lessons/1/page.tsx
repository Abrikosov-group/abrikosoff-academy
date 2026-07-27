import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { LessonCompleteButton } from "@/components/academy/lesson-complete-button";
import { getAccessContext } from "@/modules/access/server/get-access-context";

export const metadata: Metadata = {
  title: "Утренний якорь",
  description: "Текстовый урок курса «Здоровые привычки».",
};

export default async function FirstLessonPage() {
  const access = await getAccessContext();

  if (!access.user) {
    redirect("/login");
  }

  if (!access.canReadCourses) {
    redirect("/pricing");
  }

  return (
    <main className="lesson-page">
      <header className="lesson-topbar">
        <Link href="/dashboard" aria-label="Вернуться к курсу">
          <ArrowLeftIcon aria-hidden="true" size={20} />
          <span>Здоровые привычки</span>
        </Link>
        <div>
          <span>Материал курса · 7 минут</span>
          <a href="#course-content">Содержание</a>
        </div>
      </header>

      <div className="lesson-layout">
        <aside className="lesson-sidebar" id="course-content">
          <h2>Здоровые привычки: система на каждый день</h2>
          <div className="lesson-course-progress">
            <p>
              <span>12 уроков</span>
              <span>6 разделов</span>
            </p>
          </div>
          <nav aria-label="Содержание курса">
            <strong>Раздел 1. Основы</strong>
            <strong className="active">Раздел 2. Утренний распорядок</strong>
            <Link href="#">
              Сигналы и награды <small>6 мин</small>
            </Link>
            <Link className="current" href="#">
              Утренний якорь <small>7 мин</small>
            </Link>
            <Link href="#">
              Вечерняя рутина <small>6 мин</small>
            </Link>
            <strong>Раздел 3. Питание и энергия</strong>
            <strong>Раздел 4. Движение</strong>
            <strong>Раздел 5. Сон</strong>
            <strong>Раздел 6. Система целиком</strong>
          </nav>
        </aside>

        <article className="lesson-content">
          <p className="overline">
            Раздел 2 · Утренний распорядок
          </p>
          <h1>Утренний якорь: с чего начинается система</h1>
          <p className="lesson-meta">
            7 минут чтения · обновлён 12 июля 2026
          </p>

          <div className="lesson-prose">
            <p className="lesson-lead">
              Самая частая ошибка при построении привычек — надеяться на силу
              воли. Она заканчивается раньше, чем день. Вместо этого мы
              построим систему, которая начинается с одного маленького
              утреннего действия — якоря.
            </p>

            <h2>Почему якорь работает</h2>
            <p>
              Якорь — это привязка нового действия к{" "}
              <a href="#anchor">уже существующему распорядку</a>. Сигналом
              становится сама жизнь:{" "}
              <strong>
                после того как я налью утренний чай — я открою блокнот
              </strong>
              . Телефон и напоминания больше не нужны.
            </p>
            <ul>
              <li>сигнал — событие, которое уже происходит каждый день;</li>
              <li>действие — короче двух минут;</li>
              <li>награда — заметная сразу.</li>
            </ul>

            <figure className="lesson-image">
              <Image
                src="/images/academy-morning-routine.png"
                alt="Утренний стол с блокнотом и чаем"
                width={1536}
                height={1024}
                sizes="(max-width: 767px) 100vw, 680px"
              />
              <figcaption>
                Якорь может быть простым предметом — блокнот рядом с чайником.
              </figcaption>
            </figure>

            <blockquote>
              <span>«</span>
              <div>
                <p>
                  Мы не поднимаемся до уровня своих целей — мы опускаемся до
                  уровня своих систем.
                </p>
                <cite>Джеймс Клир, «Атомные привычки»</cite>
              </div>
            </blockquote>

            <div className="lesson-task">
              <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
              <p>
                <strong>Задание на сегодня.</strong> Выберите один якорь и
                запишите его формулой «после X — я сделаю Y».
              </p>
            </div>
          </div>

          <div className="lesson-navigation">
            <Link href="/courses/healthy-habits">
              <ArrowLeftIcon aria-hidden="true" size={18} />
              К описанию курса
            </Link>
            <LessonCompleteButton />
          </div>
        </article>
      </div>
    </main>
  );
}
