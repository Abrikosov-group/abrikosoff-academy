import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { LoginPanel } from "@/components/academy/login-panel";

export const metadata: Metadata = {
  title: "Вход",
  description: "Вход в Академию через Telegram или электронную почту.",
};

type LoginPageProps = {
  searchParams: Promise<{ plan?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { plan } = await searchParams;
  const selectedPlan = plan === "monthly" ? "monthly" : "annual";

  return (
    <main className="auth-page">
      <Link className="back-link" href="/pricing">
        <ArrowLeftIcon aria-hidden="true" size={18} />
        Назад к тарифам
      </Link>

      <section className="auth-card" aria-labelledby="login-title">
        <Link className="auth-logo" href="/" aria-label="На главную">
          <Image
            src="/brand/logo-mark.svg"
            alt=""
            width={72}
            height={72}
            priority
          />
        </Link>
        <p className="overline">Академия Абрикософф</p>
        <h1 id="login-title">Вход в Академию</h1>
        <p className="auth-intro">
          Если вы здесь впервые — аккаунт создастся автоматически. После входа
          продолжим оформление{" "}
          {selectedPlan === "annual" ? "годовой" : "месячной"} подписки.
        </p>
        <LoginPanel plan={selectedPlan} />
      </section>
    </main>
  );
}
