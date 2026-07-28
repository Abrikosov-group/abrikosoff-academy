import Image from "next/image";
import Link from "next/link";

export default function AdminForbidden() {
  return (
    <main className="auth-page">
      <section
        className="auth-card"
        aria-labelledby="admin-forbidden-title"
      >
        <Link className="auth-logo" href="/" aria-label="На главную">
          <Image
            src="/brand/logo-mark.svg"
            alt=""
            width={72}
            height={72}
            priority
          />
        </Link>
        <p className="overline">Доступ ограничен</p>
        <h1 id="admin-forbidden-title">Нет доступа к панели</h1>
        <p className="auth-intro">
          У этой учётной записи нет активной административной роли
          или необходимого разрешения.
        </p>
        <Link className="button button-secondary" href="/dashboard">
          Вернуться в личный кабинет
        </Link>
      </section>
    </main>
  );
}
