"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { TelegramLogoIcon } from "@phosphor-icons/react/dist/csr/TelegramLogo";
import { useState } from "react";

const navigationItems = [
  { href: "/dashboard", label: "Обзор" },
  { href: "/dashboard/courses", label: "Мои курсы" },
  { href: "/dashboard/subscription", label: "Подписка" },
  { href: "/dashboard/payments", label: "История платежей" },
  { href: "/dashboard/profile", label: "Профиль и вход" },
] as const;

function isCurrentRoute(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function CabinetLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {navigationItems.map((item) => {
        const active = isCurrentRoute(pathname, item.href);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "active" : undefined}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function SupportLink() {
  return (
    <a
      className="cabinet-support"
      href="https://t.me/AbrikosoffBot"
      rel="noreferrer"
      target="_blank"
    >
      <TelegramLogoIcon aria-hidden="true" size={15} weight="fill" />
      Поддержка
    </a>
  );
}

export function CabinetNavigation() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentLabel =
    navigationItems.find((item) =>
      isCurrentRoute(pathname, item.href),
    )?.label ?? "Разделы";

  return (
    <>
      <aside className="cabinet-sidebar">
        <nav aria-label="Личный кабинет">
          <CabinetLinks pathname={pathname} />
        </nav>
        <SupportLink />
      </aside>

      <div className="cabinet-mobile-navigation">
        <button
          aria-controls="cabinet-mobile-menu"
          aria-expanded={mobileMenuOpen}
          className="cabinet-mobile-menu-button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          type="button"
        >
          <span className="cabinet-mobile-menu-label">
            <small>Раздел кабинета</small>
            {currentLabel}
          </span>
          <span
            aria-hidden="true"
            className={`cabinet-mobile-menu-icon ${
              mobileMenuOpen ? "is-open" : ""
            }`}
          >
            <CaretDownIcon size={20} weight="bold" />
          </span>
        </button>
        <div
          className="cabinet-mobile-menu"
          hidden={!mobileMenuOpen}
          id="cabinet-mobile-menu"
        >
          <nav aria-label="Личный кабинет">
            <CabinetLinks
              pathname={pathname}
              onNavigate={() => setMobileMenuOpen(false)}
            />
          </nav>
          <SupportLink />
        </div>
      </div>
    </>
  );
}
