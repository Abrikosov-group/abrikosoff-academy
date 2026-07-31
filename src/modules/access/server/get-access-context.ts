import "server-only";

import { getDatabasePool } from "@/lib/database";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { getCurrentUser } from "@/modules/identity/server/session";
import { resolveStudentCourseAccess } from "./get-effective-access";

export async function getAccessContext() {
  const user = await getCurrentUser();

  if (!user) {
    return {
      user: null,
      subscription: null,
      canReadCourses: false,
    };
  }

  const evaluatedAt = new Date();
  const subscription = await getSubscriptionSummary(
    getDatabasePool(),
    user.id,
  );
  const canReadCourses = await resolveStudentCourseAccess({
    userId: user.id,
    at: evaluatedAt,
    legacyCanReadCourses: hasCurrentSubscriptionAccess(
      subscription,
      evaluatedAt,
    ),
  });

  return {
    user,
    subscription,
    canReadCourses,
  };
}
