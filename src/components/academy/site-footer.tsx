import Image from "next/image";
import Link from "next/link";
import { TelegramLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { legalDetails } from "@/config/legal";

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
            Продавец — {legalDetails.seller.shortName}. Оплата через защищённую
            страницу {legalDetails.payments.provider}.
          </p>
        </div>

        <div>
          <p className="footer-heading">Академия</p>
          <nav aria-label="Навигация в подвале">
            <Link href="/courses">Каталог</Link>
            <Link href="/pricing">Тарифы</Link>
            <Link href="/#about">Об Академии</Link>
          </nav>
        </div>

        <div>
          <p className="footer-heading">Документы</p>
          <nav aria-label="Документы">
            <Link href="/terms">Оферта</Link>
            <Link href="/privacy">Конфиденциальность</Link>
          </nav>
        </div>

        <div>
          <p className="footer-heading">Поддержка</p>
          <nav aria-label="Контакты поддержки">
            <a
              href={legalDetails.contacts.telegramUrl}
              rel="noreferrer"
              target="_blank"
            >
              <TelegramLogoIcon aria-hidden="true" size={18} />
              {legalDetails.contacts.telegram}
            </a>
            <a href={`mailto:${legalDetails.contacts.supportEmail}`}>
              {legalDetails.contacts.supportEmail}
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
