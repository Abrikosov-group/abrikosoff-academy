export const maximumRenewalAttempts = 4;
export const renewalGracePeriodMilliseconds = 7 * 24 * 60 * 60 * 1000;
export const renewalWorkerIntervalMilliseconds = 15 * 60 * 1000;

const financialRetryDelaysMilliseconds = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  renewalGracePeriodMilliseconds,
];

/**
 * @param {{ attemptNumber: number; processedAt: Date; graceEnd: Date }} input
 * @returns {{ kind: "retry"; nextAttemptAt: Date } | { kind: "exhausted" }}
 */
export function decideNextFinancialRenewalAttempt(input) {
  if (
    input.attemptNumber >= maximumRenewalAttempts ||
    input.processedAt.getTime() >= input.graceEnd.getTime()
  ) {
    return { kind: "exhausted" };
  }

  const delay =
    financialRetryDelaysMilliseconds[
      Math.min(
        Math.max(input.attemptNumber - 1, 0),
        financialRetryDelaysMilliseconds.length - 1,
      )
    ];

  const lastSafeAttemptAt =
    input.graceEnd.getTime() - renewalWorkerIntervalMilliseconds;
  const nextAttemptAt = Math.min(
    input.processedAt.getTime() + delay,
    lastSafeAttemptAt,
  );

  return nextAttemptAt > input.processedAt.getTime()
    ? { kind: "retry", nextAttemptAt: new Date(nextAttemptAt) }
    : { kind: "exhausted" };
}
