"use client";

import Link from "next/link";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/icons/CheckCircle";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/icons/SpinnerGap";
import { TelegramLogoIcon } from "@phosphor-icons/react/dist/icons/TelegramLogo";
import { FormEvent, useState } from "react";

type LoginPanelProps = {
  redirectPath: string;
  purchasing: boolean;
  demoAuthEnabled: boolean;
  emailAuthEnabled: boolean;
  telegramEnabled: boolean;
};

export function LoginPanel({
  redirectPath,
  purchasing,
  demoAuthEnabled,
  emailAuthEnabled,
  telegramEnabled,
}: LoginPanelProps) {
  const [email, setEmail] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [sent, setSent] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!privacyAccepted) {
      setError("Подтвердите согласие на обработку персональных данных");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Укажите корректную электронную почту");
      return;
    }

    setError("");
    setProcessing(true);

    try {
      const response = await fetch("/api/auth/email/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          redirectPath,
          privacyAccepted: true,
        }),
      });
      const payload = (await response.json()) as {
        verificationUrl?: unknown;
        error?: { message?: unknown };
      };

      if (!response.ok) {
        throw new Error(
          typeof payload.error?.message === "string"
            ? payload.error.message
            : "Не удалось отправить ссылку для входа.",
        );
      }

      if (typeof payload.verificationUrl === "string") {
        window.location.assign(payload.verificationUrl);
        return;
      }

      setProcessing(false);
      setSent(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отправить ссылку для входа.",
      );
      setProcessing(false);
    }
  }

  async function loginWithDemoTelegram() {
    if (!privacyAccepted || processing) {
      if (!privacyAccepted) {
        setError("Подтвердите согласие на обработку персональных данных");
      }
      return;
    }

    setError("");
    setProcessing(true);

    try {
      const response = await fetch("/api/auth/demo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          redirectPath,
          privacyAccepted: true,
        }),
      });
      const payload = (await response.json()) as {
        nextUrl?: unknown;
        error?: { message?: unknown };
      };

      if (!response.ok || typeof payload.nextUrl !== "string") {
        throw new Error(
          typeof payload.error?.message === "string"
            ? payload.error.message
            : "Не удалось войти через Telegram.",
        );
      }

      window.location.assign(payload.nextUrl);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось войти через Telegram.",
      );
      setProcessing(false);
    }
  }

  async function loginWithTelegram() {
    if (!privacyAccepted || processing) {
      if (!privacyAccepted) {
        setError("Подтвердите согласие на обработку персональных данных");
      }
      return;
    }

    setError("");
    setProcessing(true);

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
      });
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
            : "Не удалось подготовить вход через Telegram.",
        );
      }

      window.location.assign(payload.authUrl);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось подготовить вход через Telegram.",
      );
      setProcessing(false);
    }
  }

  if (sent) {
    return (
      <div className="login-sent" role="status">
        <CheckCircleIcon aria-hidden="true" size={38} weight="fill" />
        <h2>Ссылка отправлена</h2>
        <p>
          Письмо со ссылкой для входа отправлено на{" "}
          <strong>{email}</strong>.
        </p>
        <button
          className="text-button"
          type="button"
          onClick={() => setSent(false)}
        >
          Указать другую почту
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="privacy-consent">
        <input
          id="privacy-consent"
          checked={privacyAccepted}
          onChange={(event) => {
            setPrivacyAccepted(event.target.checked);
            if (event.target.checked) setError("");
          }}
          type="checkbox"
        />
        <span>
          <label htmlFor="privacy-consent">
            Даю согласие на обработку персональных данных для создания
            аккаунта, предоставления доступа и поддержки на условиях
          </label>{" "}
          <Link href="/privacy">Политики конфиденциальности</Link>.
        </span>
      </div>

      {demoAuthEnabled ? (
        <button
          className={`button button-telegram ${
            privacyAccepted ? "" : "button-disabled"
          }`}
          disabled={processing}
          type="button"
          onClick={loginWithDemoTelegram}
        >
          {processing ? (
            <SpinnerGapIcon className="spinner" aria-hidden="true" size={21} />
          ) : (
            <TelegramLogoIcon aria-hidden="true" size={21} weight="fill" />
          )}
          Войти через Telegram
        </button>
      ) : telegramEnabled ? (
        <button
          className={`button button-telegram ${
            privacyAccepted ? "" : "button-disabled"
          }`}
          disabled={processing}
          type="button"
          onClick={loginWithTelegram}
        >
          {processing ? (
            <SpinnerGapIcon className="spinner" aria-hidden="true" size={21} />
          ) : (
            <TelegramLogoIcon aria-hidden="true" size={21} weight="fill" />
          )}
          Войти через Telegram
        </button>
      ) : (
        <button
          className="button button-telegram button-disabled"
          type="button"
          onClick={() =>
            setError(
              privacyAccepted
                ? "Вход через Telegram ещё не настроен."
                : "Подтвердите согласие на обработку персональных данных",
            )
          }
        >
          <TelegramLogoIcon aria-hidden="true" size={21} weight="fill" />
          Войти через Telegram
        </button>
      )}

      {emailAuthEnabled ? (
        <>
          <div className="auth-divider">
            <span>или по почте</span>
          </div>

          <form className="email-form" onSubmit={submitEmail} noValidate>
            <label htmlFor="email">Электронная почта</label>
            <div className="input-with-icon">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@example.ru"
                value={email}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "email-error" : undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <button
              className="button button-secondary"
              type="submit"
              disabled={!privacyAccepted || processing}
            >
              {processing ? "Отправляем…" : "Получить ссылку для входа"}
            </button>
          </form>
        </>
      ) : (
        <p className="auth-method-note">
          На запуске доступен вход через Telegram. Вход по почте подключим
          после выбора сервиса отправки писем.
        </p>
      )}

      {error ? (
        <p className="field-error auth-consent-error" id="email-error">
          {error}
        </p>
      ) : null}

      <p className="auth-legal">
        {purchasing ? (
          <>
            Оформляя подписку, вы принимаете{" "}
            <Link href="/terms">условия</Link>. Пароли не нужны.
          </>
        ) : (
          <>Пароли не нужны. После входа откроется личный кабинет.</>
        )}
      </p>
    </>
  );
}
