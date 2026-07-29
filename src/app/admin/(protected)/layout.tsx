import Image from "next/image";
import Link from "next/link";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";

function getInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "А";
}

export default async function ProtectedAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await requireAdminContext("admin.enter");

  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link href="/" aria-label="На главную">
          <Image
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </Link>
        <div className="admin-header-actions">
          <span className="badge badge-warm">Администратор</span>
          <span
            aria-label={context.actor.displayName}
            className="header-avatar"
          >
            {getInitials(context.actor.displayName)}
          </span>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-sidebar-label">Панель управления</p>
          <nav aria-label="Административная навигация">
            <Link className="active" href="/admin">
              Обзор
            </Link>
          </nav>
          <Link className="admin-back-link" href="/dashboard">
            Личный кабинет
          </Link>
        </aside>
        <div className="admin-main">{children}</div>
      </div>
    </main>
  );
}
