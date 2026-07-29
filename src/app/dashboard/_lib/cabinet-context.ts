import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getDatabasePool } from "@/lib/database";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { getCurrentUser } from "@/modules/identity/server/session";

export const getCabinetContext = cache(async () => {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [subscription, canAccessAdministration] =
    await Promise.all([
      getSubscriptionSummary(getDatabasePool(), user.id),
      getAdministrationRuntime().service.canEnterAdministration(
        user.id,
      ),
    ]);
  const subscriptionActive =
    hasCurrentSubscriptionAccess(subscription);

  return {
    user,
    canAccessAdministration,
    subscription,
    subscriptionActive,
    subscriptionEnded: Boolean(
      subscription?.currentPeriodEnd && !subscriptionActive,
    ),
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
