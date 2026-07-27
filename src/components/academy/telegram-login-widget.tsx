"use client";

import { useEffect, useRef } from "react";

type TelegramLoginWidgetProps = {
  botUsername: string;
  authUrl: string;
};

export function TelegramLoginWidget({
  botUsername,
  authUrl,
}: TelegramLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    container.replaceChildren();
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = "large";
    script.dataset.radius = "10";
    script.dataset.userpic = "false";
    script.dataset.authUrl = authUrl;
    script.dataset.requestAccess = "write";
    container.append(script);

    return () => {
      container.replaceChildren();
    };
  }, [authUrl, botUsername]);

  return (
    <div
      className="telegram-login-widget"
      ref={containerRef}
      aria-label="Войти через Telegram"
    />
  );
}
