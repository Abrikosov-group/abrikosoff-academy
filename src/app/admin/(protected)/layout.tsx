import Image from "next/image";
import Link from "next/link";
import { AccountMenu } from "@/components/academy/account-menu";
import { AdminNavigation } from "@/components/academy/admin-navigation";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";
import { getUserInitials } from "@/modules/identity/domain/user-presentation";

export default async function ProtectedAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await requireAdminContext("admin.enter");

  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link
          href="/admin"
          aria-label="На главную административной панели"
        >
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
          <AccountMenu
            avatarUrl={context.actor.avatarUrl}
            canAccessAdministration
            displayName={context.actor.displayName}
            initials={getUserInitials(context.actor.displayName)}
          />
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-sidebar-label">Панель управления</p>
          <AdminNavigation
            showStudents={
              context.permissions.has("users.read") &&
              context.permissions.has("access.read")
            }
          />
          <Link className="admin-back-link" href="/dashboard">
            Личный кабинет
          </Link>
        </aside>
        <div className="admin-main">{children}</div>
      </div>
    </main>
  );
}
