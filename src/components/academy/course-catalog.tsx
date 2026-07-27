"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type Filter = "all" | "available" | "coming";

export function CourseCatalog() {
  const [filter, setFilter] = useState<Filter>("all");

  const showAvailable = filter === "all" || filter === "available";
  const showComing = filter === "all" || filter === "coming";

  return (
    <>
      <div className="catalog-toolbar">
        <header className="catalog-heading-row">
          <h1>Курсы</h1>
          <p>
            Все курсы входят в подписку. Библиотека пополняется каждый месяц.
          </p>
        </header>
        <div className="catalog-filters" aria-label="Фильтр курсов">
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            Все
          </button>
          <button
            type="button"
            aria-pressed={filter === "available"}
            onClick={() => setFilter("available")}
          >
            Доступны
          </button>
          <button
            type="button"
            aria-pressed={filter === "coming"}
            onClick={() => setFilter("coming")}
          >
            Скоро
          </button>
        </div>
      </div>

      <div className="catalog-grid">
        {showAvailable ? (
          <Link className="catalog-card" href="/courses/healthy-habits">
            <div className="catalog-card-cover">
              <Image
                src="/images/course-cover-abstract.png"
                alt=""
                fill
                priority
                sizes="(max-width: 767px) 100vw, 33vw"
              />
              <span className="course-cover-label">Курс Академии</span>
            </div>
            <div className="catalog-card-body">
              <h2>Здоровые привычки</h2>
              <p>
                Система на каждый день: сон, питание, движение и внимание.
              </p>
              <span className="catalog-coming-note">
                12 уроков · 6 разделов
              </span>
            </div>
          </Link>
        ) : null}

        {showComing ? (
          <>
            <article className="catalog-card catalog-card-coming">
              <div className="catalog-icon">
                <span className="badge badge-neutral">Скоро · август</span>
              </div>
              <div className="catalog-card-body">
                <h2>Сон: восстановление как навык</h2>
                <p>
                  Режим, среда и вечерние ритуалы без борьбы с собой.
                </p>
                <span className="catalog-coming-note">
                  Войдёт в подписку без доплат
                </span>
              </div>
            </article>

            <article className="catalog-card catalog-card-coming">
              <div className="catalog-icon">
                <span className="badge badge-neutral">Скоро · осень</span>
              </div>
              <div className="catalog-card-body">
                <h2>Питание без крайностей</h2>
                <p>
                  Спокойные отношения с едой — без диет и запретов.
                </p>
                <span className="catalog-coming-note">
                  Войдёт в подписку без доплат
                </span>
              </div>
            </article>
          </>
        ) : null}
      </div>

      <p className="catalog-footnote">
        Фильтры по темам появятся, когда курсов станет больше.
      </p>
    </>
  );
}
