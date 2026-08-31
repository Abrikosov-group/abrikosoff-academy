export const maximumRenewalAttempts = 4;
export const renewalGracePeriodMilliseconds = 7 * 24 * 60 * 60 * 1000;

const financialRetryDelaysMilliseconds = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  renewalGracePeriodMilliseconds,
];

/**
 * @param {{ attemptNumber: number; processedAt: Date; graceEnd: Date }} input
 */
export function nextFinancialRenewalAttemptAt(input) {
  const delay =
    financialRetryDelaysMilliseconds[
      Math.min(
        Math.max(input.attemptNumber - 1, 0),
        financialRetryDelaysMilliseconds.length - 1,
      )
    ];

  return new Date(
    Math.min(input.processedAt.getTime() + delay, input.graceEnd.getTime()),
  );
}
