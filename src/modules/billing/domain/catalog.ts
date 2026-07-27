import { legalDetails } from "@/config/legal";
import { BillingError } from "./errors";
import type { SubscriptionPlan, SubscriptionPlanId } from "./types";

const subscriptionPlans: Record<SubscriptionPlanId, SubscriptionPlan> = {
  monthly: {
    id: "monthly",
    title: "Месячный тариф",
    durationMonths: 1,
    price: {
      amountMinor: 150_000,
      currency: "RUB",
    },
    receiptItemName: legalDetails.payments.receiptItemName,
  },
  annual: {
    id: "annual",
    title: "Годовой тариф",
    durationMonths: 12,
    price: {
      amountMinor: 1_400_000,
      currency: "RUB",
    },
    receiptItemName: legalDetails.payments.receiptItemName,
  },
};

export function isSubscriptionPlanId(
  value: unknown,
): value is SubscriptionPlanId {
  return value === "monthly" || value === "annual";
}

export function getSubscriptionPlan(
  planId: SubscriptionPlanId,
): SubscriptionPlan {
  const plan = subscriptionPlans[planId];

  if (!plan) {
    throw new BillingError(
      "INVALID_PLAN",
      "Выбранный тариф не найден.",
      400,
    );
  }

  return plan;
}
