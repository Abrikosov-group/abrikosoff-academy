import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { LoginPanel } from "@/components/academy/login-panel";
import { isSubscriptionPlanId } from "@/modules/billing/domain/catalog";
import {
  checkoutRedirectPath,
  normalizeLoginRedirectPath,
} from "@/modules/identity/domain/login-redirect";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";

export const metadata: Metadata = {
  title: "Вход",
  description: "Безопасный вход в Академию Абрикософф.",
};

type LoginPageProps = {
  searchParams: Promise<{
    plan?: string;
    next?: string;
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { plan, next, error } = await searchParams;
  const purchasePlan = isSubscriptionPlanId(plan) ? plan : undefined;
  const redirectPath = purchasePlan
    ? checkoutRedirectPath(purchasePlan)
    : normalizeLoginRedirectPath(next);
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
      <Link className="back-link" href={purchasePlan ? "/pricing" : "/"}>
        <ArrowLeftIcon aria-hidden="true" size={18} />
        {purchasePlan ? "Назад к тарифам" : "На главную"}
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
          redirectPath={redirectPath}
          purchasing={Boolean(purchasePlan)}
          demoAuthEnabled={identityConfig.demoAuthEnabled}
          emailAuthEnabled={identityConfig.emailAuthMode === "demo"}
          telegram={telegram}
        />
      </section>
    </main>
  );
}
