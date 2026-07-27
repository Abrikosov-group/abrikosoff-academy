"use client";

import Link from "next/link";
import {
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  TelegramLogoIcon,
} from "@phosphor-icons/react";
import { FormEvent, useState } from "react";

type LoginPanelProps = {
  plan: "annual" | "monthly";
};

export function LoginPanel({ plan }: LoginPanelProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Укажите корректную электронную почту");
      return;
    }

    setError("");
    setSent(true);
  }

  if (sent) {
    return (
      <div className="login-sent" role="status">
        <CheckCircleIcon aria-hidden="true" size={38} weight="fill" />
        <h2>Ссылка отправлена</h2>
        <p>
          В рабочей версии письмо придёт на <strong>{email}</strong>. В
          прототипе можно сразу продолжить оформление.
        </p>
        <Link className="button button-primary" href={`/checkout?plan=${plan}`}>
          Продолжить
        </Link>
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
      <Link
        className="button button-telegram"
        href={`/checkout?plan=${plan}`}
      >
        <TelegramLogoIcon aria-hidden="true" size={21} weight="fill" />
        Войти через Telegram
      </Link>

      <div className="auth-divider">
        <span>или</span>
      </div>

      <form className="email-form" onSubmit={submitEmail} noValidate>
        <label htmlFor="email">Электронная почта</label>
        <div className="input-with-icon">
          <EnvelopeSimpleIcon aria-hidden="true" size={21} />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "email-error" : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error ? (
          <p className="field-error" id="email-error">
            {error}
          </p>
        ) : null}
        <button className="button button-secondary" type="submit">
          Получить ссылку для входа
        </button>
      </form>

      <p className="auth-legal">
        Продолжая, вы принимаете <Link href="/terms">условия оферты</Link> и{" "}
        <Link href="/privacy">политику конфиденциальности</Link>.
      </p>
    </>
  );
}
