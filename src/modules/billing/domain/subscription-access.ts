type AccessSubscription = {
  status: string;
  currentPeriodEnd?: string;
  gracePeriodEnd?: string;
};

export function hasCurrentSubscriptionAccess(
  subscription: AccessSubscription | null,
  at: Date = new Date(),
) {
  if (
    !subscription ||
    (subscription.status !== "active" &&
      subscription.status !== "grace_period") ||
    !subscription.currentPeriodEnd
  ) {
    return false;
  }

  const periodEnd = Date.parse(
    subscription.status === "grace_period" && subscription.gracePeriodEnd
      ? subscription.gracePeriodEnd
      : subscription.currentPeriodEnd,
  );

  return Number.isFinite(periodEnd) && periodEnd > at.getTime();
}
