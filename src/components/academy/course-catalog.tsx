"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  MoonStarsIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
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
          <article className="catalog-card">
            <div className="catalog-card-cover">
              <Image
                src="/images/academy-morning-routine.png"
                alt="Утренний стол с блокнотом и чаем"
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
              <div className="catalog-progress-copy">
                <span>Первый урок открыт</span>
                <span>12 уроков</span>
              </div>
              <div className="catalog-progress" aria-hidden="true">
                <span />
              </div>
              <Link
                className="text-link catalog-card-link"
                href="/courses/healthy-habits"
              >
                Открыть курс
                <ArrowRightIcon aria-hidden="true" size={18} />
              </Link>
            </div>
          </article>
        ) : null}

        {showComing ? (
          <>
            <article className="catalog-card catalog-card-coming">
              <div className="catalog-icon">
                <span className="badge badge-neutral">Скоро · август</span>
                <MoonStarsIcon
                  aria-hidden="true"
                  size={54}
                  weight="duotone"
                />
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
              <div className="catalog-icon catalog-icon-gold">
                <span className="badge badge-neutral">Скоро · осень</span>
                <SparkleIcon
                  aria-hidden="true"
                  size={54}
                  weight="duotone"
                />
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
