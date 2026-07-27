"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GlobeSimpleIcon,
  ListIcon,
  TelegramLogoIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const navigation = [
  { href: "/courses", label: "Курсы" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/#about", label: "Об Академии" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  return (
    <header className="site-header">
      <div className="page-shell site-header-inner">
        <Link className="brand-logo" href="/" aria-label="Академия Абрикософф">
          <Image
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </Link>

        <nav className="desktop-navigation" aria-label="Основная навигация">
          {navigation.map((item) => (
            <Link
              className={pathname === item.href ? "active" : undefined}
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
            RU
          </span>
          <Link className="button button-small button-secondary" href="/login">
            Войти
          </Link>
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
            {navigation.map((item) => (
              <Link
                href={item.href}
                key={item.href}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              className="button button-primary"
              href="/login"
              onClick={() => setMenuOpen(false)}
            >
              Войти в Академию
            </Link>
            <a
              className="mobile-support-link"
              href="https://t.me/AbrikosoffBot"
              rel="noreferrer"
              target="_blank"
            >
              <TelegramLogoIcon aria-hidden="true" size={20} />
              Поддержка в Telegram
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
