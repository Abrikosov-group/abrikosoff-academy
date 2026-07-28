"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CaretRightIcon,
  GlobeSimpleIcon,
  ListIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const navigation = [
  { href: "/courses", label: "Курсы" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/#about", label: "Об Академии" },
];

type SiteHeaderProps = {
  user?: {
    displayName: string;
    initials: string;
  };
};

export function SiteHeader({ user }: SiteHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const authenticated = Boolean(user);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  return (
    <header className={`site-header${menuOpen ? " is-menu-open" : ""}`}>
      <div className="page-shell site-header-inner">
        <Link className="brand-logo" href="/" aria-label="Академия Абрикософф">
          <Image
            className="desktop-brand-logo"
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
          <span className="mobile-brand-logo" aria-hidden="true">
            <Image
              src="/brand/logo-mark.svg"
              alt=""
              width={100}
              height={100}
            />
            <span>Абрикософф</span>
          </span>
        </Link>

        <nav className="desktop-navigation" aria-label="Основная навигация">
          {navigation.map((item) => (
            <Link
              className={
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href))
                  ? "active"
                  : undefined
              }
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <span className="language-label">
            <GlobeSimpleIcon aria-hidden="true" size={17} />
            RU · ₽
          </span>
          {authenticated ? (
            <Link
              className="header-avatar"
              href="/dashboard"
              aria-label={`Личный кабинет ${user?.displayName}`}
            >
              {user?.initials}
            </Link>
          ) : (
            <Link
              className="button button-small button-secondary"
              href="/login"
            >
              Войти
            </Link>
          )}
          <button
            className="mobile-menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? (
              <XIcon aria-hidden="true" size={25} />
            ) : (
              <ListIcon aria-hidden="true" size={25} />
            )}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mobile-menu" id="mobile-menu">
          <nav className="page-shell" aria-label="Мобильная навигация">
            {authenticated ? (
              <>
                <Link
                  className="mobile-account-card"
                  href="/dashboard"
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="header-avatar">{user?.initials}</span>
                  <span>
                    <strong>{user?.displayName}</strong>
                    <small>Личный кабинет</small>
                  </span>
                  <CaretRightIcon aria-hidden="true" size={18} />
                </Link>
                <div className="mobile-auth-links">
                  <Link
                    className="active"
                    href="/courses/healthy-habits/lessons/1"
                    onClick={() => setMenuOpen(false)}
                  >
                    Продолжить урок 3
                  </Link>
                  <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
                    Мои курсы
                  </Link>
                  <Link href="/courses" onClick={() => setMenuOpen(false)}>
                    Каталог
                  </Link>
                  <Link href="/pricing" onClick={() => setMenuOpen(false)}>
                    Подписка
                  </Link>
                  <Link
                    className="secondary"
                    href="/dashboard#payments"
                    onClick={() => setMenuOpen(false)}
                  >
                    История платежей
                  </Link>
                  <Link
                    className="secondary"
                    href="/dashboard#profile"
                    onClick={() => setMenuOpen(false)}
                  >
                    Профиль и вход
                  </Link>
                </div>
                <div className="mobile-auth-footer">
                  <a
                    className="mobile-support-link"
                    href="https://t.me/AbrikosoffBot"
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span>Поддержка:</span>
                    <strong>@AbrikosoffBot</strong>
                  </a>
                  <form action="/api/auth/logout" method="post">
                    <button
                      className="mobile-logout-button"
                      type="submit"
                    >
                      Выйти
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                {navigation.map((item) => (
                  <Link
                    className="mobile-menu-nav-link"
                    href={item.href}
                    key={item.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="mobile-locale-row">
                  <span>Язык и валюта</span>
                  <span className="language-label">
                    <GlobeSimpleIcon aria-hidden="true" size={17} />
                    RU · ₽
                  </span>
                </div>
                <div className="mobile-menu-actions">
                  <Link
                    className="button button-primary"
                    href="/pricing"
                    onClick={() => setMenuOpen(false)}
                  >
                    Выбрать тариф
                  </Link>
                  <Link
                    className="button button-secondary"
                    href="/login"
                    onClick={() => setMenuOpen(false)}
                  >
                    Войти
                  </Link>
                  <a
                    className="mobile-support-link"
                    href="https://t.me/AbrikosoffBot"
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span>Поддержка:</span>
                    <strong>@AbrikosoffBot</strong>
                  </a>
                </div>
              </>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
