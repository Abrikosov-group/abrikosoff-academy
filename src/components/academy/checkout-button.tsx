"use client";

import { SpinnerGapIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState } from "react";

type CheckoutButtonProps = {
  plan: "annual" | "monthly";
  initialReceiptEmail?: string;
};

export function CheckoutButton({
  plan,
  initialReceiptEmail,
}: CheckoutButtonProps) {
  const operationKeyRef = useRef<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState(
    initialReceiptEmail ?? "",
  );
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const annual = plan === "annual";

  async function startPayment() {
    if (processing || !accepted) return;

    if (
      !initialReceiptEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiptEmail)
    ) {
      setErrorMessage(
        "Укажите электронную почту, на которую отправить кассовый чек.",
      );
      return;
    }

    setProcessing(true);
    setErrorMessage("");
    operationKeyRef.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operationKeyRef.current,
        },
        body: JSON.stringify({
          plan,
          recurringConsent: true,
          receiptEmail: receiptEmail || undefined,
        }),
      });
      const payload = (await response.json()) as {
        confirmationUrl?: unknown;
        error?: { message?: unknown };
      };

      if (
        !response.ok ||
        typeof payload.confirmationUrl !== "string"
      ) {
        const message =
          typeof payload.error?.message === "string"
            ? payload.error.message
            : "Не удалось перейти к оплате. Попробуйте ещё раз.";
        throw new Error(message);
      }

      window.location.assign(payload.confirmationUrl);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось перейти к оплате. Попробуйте ещё раз.",
      );
      setProcessing(false);
    }
  }

  return (
    <div className="checkout-actions">
      {!initialReceiptEmail ? (
        <label className="checkout-receipt-field">
          <span>Электронная почта для кассового чека</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={receiptEmail}
            placeholder="name@example.ru"
            onChange={(event) => {
              setReceiptEmail(event.target.value.trim());
              setErrorMessage("");
            }}
          />
        </label>
      ) : null}
      <label className="checkout-consent">
        <input
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          type="checkbox"
        />
        <span>
          Принимаю <Link href="/terms">оферту</Link> и соглашаюсь на
          автоматическое продление с периодическим списанием{" "}
          {annual ? "14 000 ₽ каждые 12 месяцев" : "1 500 ₽ каждый месяц"}.
          Продление можно отключить в любой момент.
        </span>
      </label>
      <button
        className="button button-primary checkout-submit"
        type="button"
        disabled={processing || !accepted}
        onClick={startPayment}
      >
        {processing ? (
          <>
            <SpinnerGapIcon
              className="spinner"
              aria-hidden="true"
              size={21}
            />
            Переходим к оплате…
          </>
        ) : (
          "Перейти к оплате"
        )}
      </button>
      {errorMessage ? (
        <p className="checkout-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
