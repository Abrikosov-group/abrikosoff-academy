import "server-only";

import type { Pool } from "pg";
import { withDatabaseReadSnapshot } from "@/lib/database";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import {
  resolveStudentCourseAccess,
  validateEffectiveAccessConfiguration,
} from "./get-effective-access";

export async function readStudentCourseAccess(
  pool: Pool,
  userId: string,
) {
  let shadowFallbackApplied = false;

  try {
    return await withDatabaseReadSnapshot(
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
        const courseAccess = await resolveStudentCourseAccess({
          userId,
          at: evaluatedAt,
          legacyCanReadCourses: subscriptionActive,
          database: client,
          onShadowFallbackApplied: () => {
            shadowFallbackApplied = true;
          },
        });

        return {
          evaluatedAt,
          subscription,
          subscriptionActive,
          subscriptionEnded: Boolean(
            subscription?.currentPeriodEnd && !subscriptionActive,
          ),
          canReadCourses: courseAccess.canReadCourses,
          appliedEffectiveAccess:
            courseAccess.appliedEffectiveAccess,
        };
      },
    );
  } catch (error) {
    if (!shadowFallbackApplied) {
      throw error;
    }

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
        await validateEffectiveAccessConfiguration(client);

        return {
          evaluatedAt,
          subscription,
          subscriptionActive,
          subscriptionEnded: Boolean(
            subscription?.currentPeriodEnd && !subscriptionActive,
          ),
          canReadCourses: subscriptionActive,
          appliedEffectiveAccess: null,
        };
      },
    );
  }
}
