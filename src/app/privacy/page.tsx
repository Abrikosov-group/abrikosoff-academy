import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/academy/site-footer";
import { SiteHeader } from "@/components/academy/site-header";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
};

export default function PrivacyPage() {
  return (
    <main>
      <SiteHeader />
      <article className="legal-page page-shell">
        <Link className="back-link-inline" href="/">
          <ArrowLeftIcon aria-hidden="true" size={18} />
          На главную
        </Link>
        <p className="overline">Правовая информация</p>
        <h1>Политика конфиденциальности</h1>
        <p className="legal-note">
          Черновик страницы для MVP. Финальный документ будет дополнен
          реквизитами оператора и перечнем подключённых сервисов.
        </p>
        <h2>Какие данные используются</h2>
        <p>
          Для входа и предоставления доступа могут использоваться адрес
          электронной почты, идентификатор Telegram и сведения о статусе
          подписки.
        </p>
        <h2>Для чего нужны данные</h2>
        <p>
          Данные помогают авторизовать ученика, сохранить прогресс, подтвердить
          оплату и оказать поддержку.
        </p>
        <h2>Обращения</h2>
        <p>
          По вопросам обработки данных можно написать на
          support@abrikosoff.com.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
