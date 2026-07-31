"use client";

import { CaretDoubleLeftIcon } from "@phosphor-icons/react/dist/csr/CaretDoubleLeft";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/dist/csr/CaretDoubleRight";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import Link from "next/link";
import {
  type ReactNode,
  useId,
  useState,
} from "react";
import { AdminNavigation } from "./admin-navigation";

const adminSidebarPreferenceCookie =
  "academy_admin_sidebar";
const adminSidebarPreferenceMaxAge = 60 * 60 * 24 * 365;

export function AdminWorkspace({
  children,
  initiallyCollapsed,
  showStudents,
}: {
  children: ReactNode;
  initiallyCollapsed: boolean;
  showStudents: boolean;
}) {
  const sidebarId = useId();
  const [collapsed, setCollapsed] = useState(
    initiallyCollapsed,
  );

  function toggleSidebar() {
    const nextCollapsed = !collapsed;
    const secure =
      window.location.protocol === "https:" ? "; Secure" : "";

    setCollapsed(nextCollapsed);
    document.cookie =
      [
        `${adminSidebarPreferenceCookie}=${
          nextCollapsed ? "collapsed" : "expanded"
        }`,
        "Path=/admin",
        `Max-Age=${adminSidebarPreferenceMaxAge}`,
        "SameSite=Lax",
      ].join("; ") + secure;
  }

  const toggleLabel = collapsed
    ? "Развернуть боковое меню"
    : "Свернуть боковое меню";

  return (
    <div
      className="admin-layout"
      data-sidebar-state={
        collapsed ? "collapsed" : "expanded"
      }
    >
      <aside className="admin-sidebar" id={sidebarId}>
        <div className="admin-sidebar-heading">
          <p className="admin-sidebar-label">
            Панель управления
          </p>
          <button
            aria-controls={sidebarId}
            aria-expanded={!collapsed}
            aria-label={toggleLabel}
            className="admin-sidebar-toggle"
            onClick={toggleSidebar}
            title={toggleLabel}
            type="button"
          >
            {collapsed ? (
              <CaretDoubleRightIcon
                aria-hidden="true"
                size={20}
                weight="bold"
              />
            ) : (
              <CaretDoubleLeftIcon
                aria-hidden="true"
                size={20}
                weight="bold"
              />
            )}
          </button>
        </div>
        <AdminNavigation
          collapsed={collapsed}
          showStudents={showStudents}
        />
        <Link
          aria-label={
            collapsed ? "Личный кабинет" : undefined
          }
          className="admin-back-link"
          href="/dashboard"
          title={collapsed ? "Личный кабинет" : undefined}
        >
          <HouseIcon
            aria-hidden="true"
            className="admin-nav-icon"
            size={22}
          />
          <span className="admin-nav-label">
            Личный кабинет
          </span>
        </Link>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
