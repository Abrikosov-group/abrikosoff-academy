"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type CabinetAccountMenuProps = {
  displayName: string;
  initials: string;
};

export function CabinetAccountMenu({
  displayName,
  initials,
}: CabinetAccountMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const profileLinkRef = useRef<HTMLAnchorElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    profileLinkRef.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="cabinet-account-menu" ref={containerRef}>
      <button
        aria-controls="cabinet-account-popover"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Закрыть меню профиля" : "Открыть меню профиля"}
        className="header-avatar cabinet-account-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        {initials}
      </button>

      {open ? (
        <div
          aria-label="Меню профиля"
          className="cabinet-account-popover"
          id="cabinet-account-popover"
          role="dialog"
        >
          <div className="cabinet-account-popover-header">
            <span className="header-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              <strong>{displayName}</strong>
              <small>Аккаунт Академии</small>
            </div>
          </div>
          <nav aria-label="Меню аккаунта">
            <Link
              aria-current={
                pathname === "/dashboard/profile" ? "page" : undefined
              }
              href="/dashboard/profile"
              onClick={() => setOpen(false)}
              ref={profileLinkRef}
            >
              Профиль и вход
            </Link>
          </nav>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Выйти из аккаунта</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
