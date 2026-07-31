import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getDatabasePool } from "@/lib/database";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { readStudentCourseAccess } from "@/modules/access/server/read-student-course-access";
import { getCurrentUser } from "@/modules/identity/server/session";

export const getCabinetContext = cache(async () => {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [access, canAccessAdministration] =
    await Promise.all([
      readStudentCourseAccess(getDatabasePool(), user.id),
      getAdministrationRuntime().service.canEnterAdministration(
        user.id,
      ),
    ]);

  return {
    user,
    canAccessAdministration,
    subscription: access.subscription,
    subscriptionActive: access.subscriptionActive,
    subscriptionEnded: access.subscriptionEnded,
    canReadCourses: access.canReadCourses,
  };
});

export function formatCabinetDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
