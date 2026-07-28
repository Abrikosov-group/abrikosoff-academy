"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type PaymentStatusPollerProps = {
  orderId: string;
};

const retryDelays = [0, 1_000, 2_000, 3_000, 5_000, 8_000, 13_000];
const pendingStatuses = new Set([
  "created",
  "pending",
  "requires_action",
]);

export function PaymentStatusPoller({
  orderId,
}: PaymentStatusPollerProps) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;

    async function reconcile(attempt: number) {
      if (stopped) {
        return;
      }

      activeController = new AbortController();

      try {
        const response = await fetch(
          `/api/payments/orders/${encodeURIComponent(orderId)}/reconcile`,
          {
            method: "POST",
            cache: "no-store",
            signal: activeController.signal,
          },
        );
        const payload = (await response.json()) as {
          status?: unknown;
        };

        if (
          response.ok &&
          typeof payload.status === "string" &&
          !pendingStatuses.has(payload.status)
        ) {
          router.refresh();
          return;
        }
      } catch {
        if (activeController.signal.aborted) {
          return;
        }
      }

      const nextAttempt = attempt + 1;

      if (nextAttempt < retryDelays.length) {
        timeoutId = setTimeout(
          () => void reconcile(nextAttempt),
          retryDelays[nextAttempt],
        );
      }
    }

    void reconcile(0);

    return () => {
      stopped = true;
      activeController?.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [orderId, router]);

  return null;
}
