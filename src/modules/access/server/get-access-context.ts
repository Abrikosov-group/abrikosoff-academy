import "server-only";

import { getDatabasePool } from "@/lib/database";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getCurrentUser } from "@/modules/identity/server/session";

export async function getAccessContext() {
  const user = await getCurrentUser();

  if (!user) {
    return {
      user: null,
      subscription: null,
      canReadCourses: false,
    };
  }

  const subscription = await getSubscriptionSummary(
    getDatabasePool(),
    user.id,
  );

  return {
    user,
    subscription,
    canReadCourses: hasCurrentSubscriptionAccess(subscription),
  };
}
