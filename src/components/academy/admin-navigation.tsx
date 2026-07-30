"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminNavigationProps = {
  showStudents: boolean;
};

function isCurrentRoute(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
export function AdminNavigation({
  showStudents,
}: AdminNavigationProps) {
  const pathname = usePathname();
  const items = [
    { href: "/admin", label: "Обзор", visible: true },
    {
      href: "/admin/students",
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

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "active" : undefined}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
