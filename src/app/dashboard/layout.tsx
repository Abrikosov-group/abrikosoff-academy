import Image from "next/image";
import Link from "next/link";
import { AccountMenu } from "@/components/academy/account-menu";
import { CabinetNavigation } from "@/components/academy/cabinet-navigation";
import { getUserInitials } from "@/modules/identity/domain/user-presentation";
import { getCabinetContext } from "./_lib/cabinet-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const {
    user,
    canAccessAdministration,
    subscriptionActive,
    subscriptionEnded,
  } = await getCabinetContext();

  return (
    <main className="cabinet-page">
      <header className="cabinet-header">
        <Link
          href="/dashboard"
          aria-label="На главную личного кабинета"
        >
          <Image
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </Link>
        <div className="cabinet-header-actions">
          <span
            className={`badge ${
              subscriptionActive ? "badge-success" : "badge-neutral"
            }`}
          >
            {subscriptionActive
              ? "Подписка активна"
              : subscriptionEnded
                ? "Доступ завершён"
                : "Нет подписки"}
          </span>
          <AccountMenu
            avatarUrl={user.avatarUrl}
            canAccessAdministration={canAccessAdministration}
            displayName={user.displayName}
            initials={getUserInitials(user.displayName)}
          />
        </div>
      </header>

      <div className="cabinet-layout">
        <CabinetNavigation />
        <div className="cabinet-main">{children}</div>
      </div>
    </main>
  );
}
