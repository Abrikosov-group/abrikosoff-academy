import Image from "next/image";
import Link from "next/link";
import { CabinetNavigation } from "@/components/academy/cabinet-navigation";
import { getCabinetContext } from "./_lib/cabinet-context";

function getInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "А";
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const {
    user,
    subscriptionActive,
    subscriptionEnded,
  } = await getCabinetContext();

  return (
    <main className="cabinet-page">
      <header className="cabinet-header">
        <Link href="/" aria-label="На главную">
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
          <Link
            aria-label="Открыть профиль"
            className="header-avatar"
            href="/dashboard/profile"
          >
            {getInitials(user.displayName)}
          </Link>
        </div>
      </header>

      <div className="cabinet-layout">
        <CabinetNavigation />
        <div className="cabinet-main">{children}</div>
      </div>
    </main>
  );
}
