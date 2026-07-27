import Image from "next/image";
import Link from "next/link";
import { TelegramLogoIcon } from "@phosphor-icons/react/dist/ssr";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-shell footer-grid">
        <div className="footer-brand">
          <Image
            src="/brand/logo-horizontal-dark.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
          />
          <p>
            Практические знания для устойчивых изменений — спокойно и по
            системе.
          </p>
        </div>

        <div>
          <p className="footer-heading">Академия</p>
          <nav aria-label="Навигация в подвале">
            <Link href="/courses">Курсы</Link>
            <Link href="/pricing">Тарифы</Link>
            <Link href="/dashboard">Личный кабинет</Link>
          </nav>
        </div>

        <div>
          <p className="footer-heading">Помощь</p>
          <nav aria-label="Поддержка">
            <a
              href="https://t.me/AbrikosoffBot"
              rel="noreferrer"
              target="_blank"
            >
              <TelegramLogoIcon aria-hidden="true" size={18} />
              @AbrikosoffBot
            </a>
            <a href="mailto:support@abrikosoff.com">
              support@abrikosoff.com
            </a>
          </nav>
        </div>
      </div>

      <div className="page-shell footer-bottom">
        <span>© 2026 Академия Абрикософф</span>
        <div>
          <Link href="/terms">Оферта</Link>
          <Link href="/privacy">Политика конфиденциальности</Link>
        </div>
      </div>
    </footer>
  );
}
