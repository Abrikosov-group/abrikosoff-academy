import Image from "next/image";
import Link from "next/link";
import { AccountMenu } from "@/components/academy/account-menu";
import { CabinetNavigation } from "@/components/academy/cabinet-navigation";
import { getUserInitials } from "@/modules/identity/domain/user-presentation";
import {
  createCabinetAccessPresentation,
} from "./_lib/cabinet-access-presentation";
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
    subscription,
    canReadCourses,
    subscriptionActive,
    subscriptionEnded,
  } = await getCabinetContext();
  const accessPresentation = createCabinetAccessPresentation({
    canReadCourses,
    subscriptionActive,
    subscriptionEnded,
    hasSubscription: Boolean(subscription),
    formattedPeriodEnd: null,
  });

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
              accessPresentation.headerStatus.active
                ? "badge-success"
                : "badge-neutral"
            }`}
          >
            {accessPresentation.headerStatus.label}
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
