"use client";

import { CreditCardIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CheckoutButtonProps = {
  plan: "annual" | "monthly";
};

export function CheckoutButton({ plan }: CheckoutButtonProps) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);

  function startPayment() {
    if (processing) return;
    setProcessing(true);
    window.setTimeout(() => {
      router.push(`/payment/success?plan=${plan}`);
    }, 900);
  }

  return (
    <button
      className="button button-primary checkout-submit"
      type="button"
      disabled={processing}
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
        <>
          <CreditCardIcon aria-hidden="true" size={21} />
          Оплатить в ЮKassa
        </>
      )}
    </button>
  );
}
