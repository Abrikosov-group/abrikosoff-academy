"use client";

import { GaugeIcon } from "@phosphor-icons/react/dist/csr/Gauge";
import { StudentIcon } from "@phosphor-icons/react/dist/csr/Student";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminNavigationProps = {
  collapsed: boolean;
  showStudents: boolean;
};

function isCurrentRoute(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
export function AdminNavigation({
  collapsed,
  showStudents,
}: AdminNavigationProps) {
  const pathname = usePathname();
  const items = [
    {
      href: "/admin",
      icon: GaugeIcon,
      label: "Обзор",
      visible: true,
    },
    {
      href: "/admin/students",
      icon: StudentIcon,
      label: "Ученики",
      visible: showStudents,
    },
  ] as const;

  return (
    <nav aria-label="Административная навигация">
      {items.map((item) => {
        if (!item.visible) {
          return null;
        }

        const active = isCurrentRoute(pathname, item.href);
        const Icon = item.icon;

        return (
          <Link
            aria-label={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={active ? "active" : undefined}
            href={item.href}
            key={item.href}
            title={collapsed ? item.label : undefined}
          >
            <Icon
              aria-hidden="true"
              className="admin-nav-icon"
              size={22}
              weight={active ? "fill" : "regular"}
            />
            <span className="admin-nav-label">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
