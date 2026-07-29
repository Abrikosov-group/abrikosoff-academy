"use client";

import { SpinnerGapIcon } from "@phosphor-icons/react/dist/icons/SpinnerGap";
import { TelegramLogoIcon } from "@phosphor-icons/react/dist/icons/TelegramLogo";
import { useState } from "react";

export function AdminTelegramVerificationButton({
  redirectPath,
}: {
  redirectPath: string;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  async function beginVerification() {
    if (processing) {
      return;
    }

    setError("");
    setProcessing(true);

    try {
      const response = await fetch(
        "/api/admin/auth/telegram/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ redirectPath }),
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        authUrl?: unknown;
        nextUrl?: unknown;
        error?: { message?: unknown };
      };

      if (response.ok && typeof payload.nextUrl === "string") {
        window.location.assign(payload.nextUrl);
        return;
      }

      if (!response.ok || typeof payload.authUrl !== "string") {
        throw new Error(
          typeof payload.error?.message === "string"
            ? payload.error.message
            : "Не удалось начать подтверждение.",
        );
      }

      window.location.assign(payload.authUrl);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось начать подтверждение.",
      );
      setProcessing(false);
    }
  }

  return (
    <>
      <button
        className="button button-telegram"
        disabled={processing}
        type="button"
        onClick={beginVerification}
      >
        {processing ? (
          <SpinnerGapIcon
            aria-hidden="true"
            className="spinner"
            size={21}
          />
        ) : (
          <TelegramLogoIcon
            aria-hidden="true"
            size={21}
            weight="fill"
          />
        )}
        Подтвердить через Telegram
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
