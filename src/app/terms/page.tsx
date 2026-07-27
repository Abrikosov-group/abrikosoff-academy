import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { SiteHeader } from "@/components/academy/site-header";

export const metadata: Metadata = {
  title: "Оферта",
};

export default function TermsPage() {
  return (
    <main>
      <SiteHeader />
      <article className="legal-page page-shell">
        <Link className="back-link-inline" href="/">
          <ArrowLeftIcon aria-hidden="true" size={18} />
          На главную
        </Link>
        <p className="overline">Правовая информация</p>
        <h1>Публичная оферта</h1>
        <p className="legal-note">
          Черновик страницы для MVP. Перед приёмом реальных платежей здесь
          будет опубликован согласованный текст оферты действующего ИП.
        </p>
        <h2>Предмет</h2>
        <p>
          Исполнитель предоставляет заказчику доступ к образовательным
          материалам Академии на срок оплаченной подписки.
        </p>
        <h2>Оплата и доступ</h2>
        <p>
          Стоимость, период и условия продления показываются до оплаты. Доступ
          открывается после подтверждения платежа.
        </p>
        <h2>Продление</h2>
        <p>
          Пользователь может отключить автоматическое продление в личном
          кабинете. Доступ сохраняется до окончания оплаченного периода.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
