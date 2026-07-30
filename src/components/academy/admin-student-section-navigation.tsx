"use client";

import { useEffect, useState } from "react";

const sections = [
  { id: "overview", label: "Обзор" },
  { id: "access-payments", label: "Доступ и оплаты" },
  { id: "identity-security", label: "Вход и безопасность" },
  { id: "sessions", label: "Сессии" },
] as const;

type SectionId = (typeof sections)[number]["id"];

function sectionFromHash(): SectionId {
  const hash = window.location.hash.slice(1);

  return sections.some((section) => section.id === hash)
    ? (hash as SectionId)
    : "overview";
}

export function AdminStudentSectionNavigation() {
  const [activeSection, setActiveSection] =
    useState<SectionId>("overview");

  useEffect(() => {
    const updateFromHash = () => {
      setActiveSection(sectionFromHash());
    };
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement =>
        Boolean(element),
      );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) =>
              left.boundingClientRect.top -
              right.boundingClientRect.top,
          )[0];

        if (visible?.target.id) {
          setActiveSection(visible.target.id as SectionId);
        }
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0, 0.1],
      },
    );

    updateFromHash();
    elements.forEach((element) => observer.observe(element));
    window.addEventListener("hashchange", updateFromHash);

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, []);

  return (
    <nav
      aria-label="Разделы карточки ученика"
      className="admin-student-section-navigation"
    >
      {sections.map((section) => (
        <a
          aria-current={
            activeSection === section.id ? "location" : undefined
          }
          href={`#${section.id}`}
          key={section.id}
          onClick={() => setActiveSection(section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
