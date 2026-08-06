import "server-only";

import type { Pool } from "pg";
import { withDatabaseReadSnapshot } from "@/lib/database";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { resolveStudentCourseAccess } from "./get-effective-access";

export async function readStudentCourseAccess(
  pool: Pool,
  userId: string,
) {
  return withDatabaseReadSnapshot(
    pool,
    async (client, evaluatedAt) => {
      const subscription = await getSubscriptionSummary(
        client,
        userId,
      );
      const subscriptionActive = hasCurrentSubscriptionAccess(
        subscription,
        evaluatedAt,
      );
      const canReadCourses = await resolveStudentCourseAccess({
        userId,
        at: evaluatedAt,
        legacyCanReadCourses: subscriptionActive,
        database: client,
      });

      return {
        evaluatedAt,
        subscription,
        subscriptionActive,
        subscriptionEnded: Boolean(
          subscription?.currentPeriodEnd && !subscriptionActive,
        ),
        canReadCourses,
      };
    },
  );
}
