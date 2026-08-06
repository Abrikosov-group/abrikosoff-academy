import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCabinetContext } from "../_lib/cabinet-context";

export const metadata: Metadata = {
  title: "Мои курсы",
  description: "Доступные ученику курсы Академии.",
};

const coming = [
  {
    title: "Сон: восстановление как навык",
    release: "август",
  },
  {
    title: "Питание без крайностей",
    release: "осень",
  },
];

export default async function CabinetCoursesPage() {
  const { canReadCourses } = await getCabinetContext();

  return (
    <>
      <header className="cabinet-section-heading">
        <p className="overline">Библиотека Академии</p>
        <h1>Мои курсы</h1>
        <p>
          Здесь собраны доступные материалы и курсы, которые появятся
          в подписке позднее.
        </p>
      </header>

      <section
        className="cabinet-course-feature"
        aria-labelledby="healthy-habits-title"
      >
        <div className="cabinet-course-feature-cover">
          <Image
            src="/images/course-cover-abstract.png"
            alt=""
            fill
            priority
            sizes="(max-width: 767px) 100vw, 360px"
          />
        </div>
        <div className="cabinet-course-feature-copy">
          <p className="overline">Первый курс</p>
          <h2 id="healthy-habits-title">
            Здоровые привычки: система на каждый день
          </h2>
          <p>
            12 коротких текстовых уроков · 6 разделов · 5–10 минут
            на урок
          </p>
          <div className="cabinet-course-feature-actions">
            <Link
              className="button button-primary"
              href={
                canReadCourses
                  ? "/courses/healthy-habits/lessons/1"
                  : "/dashboard/subscription"
              }
            >
              {canReadCourses
                ? "Открыть первый урок"
                : "Оформить доступ"}
            </Link>
            <Link href="/courses/healthy-habits">
              Посмотреть программу
            </Link>
          </div>
        </div>
      </section>

      <section
        className="cabinet-upcoming-courses"
        aria-labelledby="upcoming-courses-title"
      >
        <h2 id="upcoming-courses-title">Скоро в Академии</h2>
        <div className="cabinet-course-grid">
          {coming.map((course) => (
            <article
              className="cabinet-coming-card"
              key={course.title}
            >
              <span className="badge badge-neutral">Скоро</span>
              <h3>{course.title}</h3>
              <p>{course.release} · войдёт в подписку</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
