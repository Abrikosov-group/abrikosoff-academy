import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { LoginPanel } from "@/components/academy/login-panel";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";

export const metadata: Metadata = {
  title: "Вход",
  description: "Вход в Академию через Telegram или электронную почту.",
};

type LoginPageProps = {
  searchParams: Promise<{ plan?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { plan, error } = await searchParams;
  const selectedPlan = plan === "monthly" ? "monthly" : "annual";
  const identityConfig = getIdentityConfig();
  let telegram:
    | {
        botUsername: string;
      }
    | undefined;

  if (identityConfig.telegram) {
    telegram = {
      botUsername: identityConfig.telegram.botUsername,
    };
  }

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
        <h1 id="login-title">Вход в Академию</h1>
        <p className="auth-intro">
          Если вы здесь впервые — аккаунт создастся автоматически.
        </p>
        {error ? (
          <p className="field-error auth-page-error" role="alert">
            Ссылка для входа недействительна или устарела. Попробуйте ещё раз.
          </p>
        ) : null}
        <LoginPanel
          plan={selectedPlan}
          demoAuthEnabled={identityConfig.demoAuthEnabled}
          emailAuthEnabled={identityConfig.emailAuthMode === "demo"}
          telegram={telegram}
        />
      </section>
    </main>
  );
}
