import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";

export default function NotFound() {
  return (
    <main className="success-page">
      <section className="success-card">
        <p className="overline">Ошибка 404</p>
        <h1>Эта страница ещё не готова</h1>
        <p>Вернитесь на главную или откройте каталог курсов.</p>
        <Link className="button button-primary" href="/">
          <ArrowLeftIcon aria-hidden="true" size={19} />
          На главную
        </Link>
        <Link className="text-link centered-link" href="/courses">
          Каталог курсов
        </Link>
      </section>
    </main>
  );
}
