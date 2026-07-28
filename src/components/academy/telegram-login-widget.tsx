"use client";

import { useEffect, useRef, useState } from "react";

type TelegramLoginWidgetProps = {
  botUsername: string;
  redirectPath: string;
};

export function TelegramLoginWidget({
  botUsername,
  redirectPath,
}: TelegramLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    const abortController = new AbortController();
    let disposed = false;

    if (!container) return;

    const widgetContainer = container;
    widgetContainer.replaceChildren();

    async function initializeWidget() {
      try {
        const response = await fetch("/api/auth/telegram/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            redirectPath,
            privacyAccepted: true,
          }),
          cache: "no-store",
          signal: abortController.signal,
        });
        const payload = (await response.json()) as {
          authUrl?: unknown;
          error?: { message?: unknown };
        };

        if (!response.ok || typeof payload.authUrl !== "string") {
          throw new Error(
            typeof payload.error?.message === "string"
              ? payload.error.message
              : "Не удалось подготовить вход через Telegram.",
          );
        }

        if (disposed) return;

        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-widget.js?22";
        script.async = true;
        script.dataset.telegramLogin = botUsername;
        script.dataset.size = "large";
        script.dataset.radius = "10";
        script.dataset.userpic = "false";
        script.dataset.authUrl = payload.authUrl;
        script.dataset.requestAccess = "write";
        widgetContainer.append(script);
      } catch (requestError) {
        if (disposed || abortController.signal.aborted) return;

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось подготовить вход через Telegram.",
        );
      }
    }

    void initializeWidget();

    return () => {
      disposed = true;
      abortController.abort();
      widgetContainer.replaceChildren();
    };
  }, [botUsername, redirectPath]);

  return (
    <>
      <div
        className="telegram-login-widget"
        ref={containerRef}
        aria-label="Войти через Telegram"
      />
      {error ? (
        <p className="field-error auth-consent-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
