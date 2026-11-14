"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SubscriptionRenewalControlProps = {
  autoRenew: boolean;
};

export function SubscriptionRenewalControl({
  autoRenew,
}: SubscriptionRenewalControlProps) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  async function changeRenewal() {
    if (processing) return;
    setProcessing(true);
    setError("");

    try {
      const response = await fetch("/api/subscriptions/renewal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !autoRenew }),
      });
      const payload = (await response.json()) as {
        error?: { message?: unknown };
      };

      if (!response.ok) {
        throw new Error(
          typeof payload.error?.message === "string"
            ? payload.error.message
            : "Не удалось изменить автоматическое продление.",
        );
      }

      router.refresh();
      setProcessing(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить автоматическое продление.",
      );
      setProcessing(false);
    }
  }

  return (
    <div className="subscription-renewal-control">
      <button
        className="button button-secondary"
        type="button"
        disabled={processing}
        onClick={changeRenewal}
      >
        {processing
          ? "Сохраняем…"
          : autoRenew
            ? "Отключить автоматическое продление"
            : "Включить автоматическое продление"}
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
