"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type AccountMenuProps = {
  canAccessAdministration: boolean;
  displayName: string;
  initials: string;
};

function isCurrentRoute(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AccountMenu({
  canAccessAdministration,
  displayName,
  initials,
}: AccountMenuProps) {
  const pathname = usePathname();
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const navigation = [
    {
      href: "/dashboard",
      label: "Личный кабинет",
      visible: true,
    },
    {
      href: "/admin",
      label: "Админка",
      visible: canAccessAdministration,
    },
    {
      href: "/dashboard/profile",
      label: "Профиль и вход",
      visible: true,
    },
  ] as const;

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`Открыть меню аккаунта: ${displayName}`}
        className="header-avatar account-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        {initials}
      </button>

      {open ? (
        <div
          aria-label="Меню аккаунта"
          className="account-menu-panel"
          id={panelId}
        >
          <p className="account-menu-identity">
            <span>Вы вошли как</span>
            <strong>{displayName}</strong>
          </p>
          <nav aria-label="Переходы аккаунта">
            {navigation.map((item) =>
              item.visible ? (
                <Link
                  aria-current={
                    isCurrentRoute(pathname, item.href)
                      ? "page"
                      : undefined
                  }
                  href={item.href}
                  key={item.href}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ) : null,
            )}
          </nav>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Выйти</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
