import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { AccountMenu } from "@/components/academy/account-menu";
import { AdminWorkspace } from "@/components/academy/admin-workspace";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";
import { getUserInitials } from "@/modules/identity/domain/user-presentation";

export default async function ProtectedAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await requireAdminContext("admin.enter");
  const sidebarInitiallyCollapsed =
    (await cookies()).get("academy_admin_sidebar")?.value ===
    "collapsed";

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
      <AdminWorkspace
        initiallyCollapsed={sidebarInitiallyCollapsed}
        showAccess={context.permissions.has("access.read")}
        showStudents={
          context.permissions.has("users.read") &&
          context.permissions.has("access.read")
        }
      >
        {children}
      </AdminWorkspace>
    </main>
  );
}
