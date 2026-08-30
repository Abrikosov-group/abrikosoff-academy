import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getDatabasePool } from "@/lib/database";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import type { EffectiveAccessDecision } from "@/modules/access/domain/effective-access";
import { readStudentCourseAccess } from "@/modules/access/server/read-student-course-access";
import { getCurrentUser } from "@/modules/identity/server/session";
import { summarizeCabinetAccessBases } from "./cabinet-access-basis";

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
    appliedEffectiveAccess: access.appliedEffectiveAccess,
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

export function getCabinetAccessBasisPresentation(
  access: EffectiveAccessDecision | null,
) {
  const { manualPeriodEnd, paidPeriodEnd } =
    summarizeCabinetAccessBases(access);

  return {
    manualAccessActive: Boolean(manualPeriodEnd),
    paidGrantAccessActive: Boolean(paidPeriodEnd),
    formattedManualAccessPeriodEnd: manualPeriodEnd
      ? formatCabinetDate(manualPeriodEnd)
      : null,
    formattedPaidGrantAccessPeriodEnd: paidPeriodEnd
      ? formatCabinetDate(paidPeriodEnd)
      : null,
  };
}
