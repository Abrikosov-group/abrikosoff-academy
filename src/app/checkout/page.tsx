import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, LockKeyIcon } from "@phosphor-icons/react/dist/ssr";
import { CheckoutButton } from "@/components/academy/checkout-button";
import { getDatabasePool } from "@/lib/database";
import { hasCurrentSubscriptionAccess } from "@/modules/billing/domain/subscription-access";
import { addSubscriptionPeriod } from "@/modules/billing/domain/subscription-period";
import { getSubscriptionSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { getCurrentUser } from "@/modules/identity/server/session";

export const metadata: Metadata = {
  title: "Оформление подписки",
  description: "Проверка тарифа перед переходом к оплате.",
};

type CheckoutPageProps = {
  searchParams: Promise<{ plan?: string }>;
};

export default async function CheckoutPage({
  searchParams,
}: CheckoutPageProps) {
  const { plan } = await searchParams;
  const selectedPlan = plan === "monthly" ? "monthly" : "annual";
  const annual = selectedPlan === "annual";
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?plan=${selectedPlan}`);
  }

  const currentSubscription = await getSubscriptionSummary(
    getDatabasePool(),
    user.id,
  );

  if (hasCurrentSubscriptionAccess(currentSubscription)) {
    redirect("/dashboard");
  }

  const telegramUsername =
    user.primaryMethod.type === "telegram" &&
    typeof user.primaryMethod.metadata.username === "string"
      ? `@${user.primaryMethod.metadata.username}`
      : null;
  const accountLabel =
    telegramUsername ||
    user.receiptEmail ||
    user.displayName;
  const methodLabel =
    user.primaryMethod.type === "telegram"
      ? "Telegram"
      : user.primaryMethod.type === "email"
        ? "электронная почта"
        : "телефон";
  const accessEndDate = addSubscriptionPeriod(
    new Date(),
    selectedPlan,
  );
  const accessEndDateLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(accessEndDate);

  return (
    <main className="checkout-page">
      <section className="checkout-frame" aria-labelledby="checkout-title">
        <header className="flow-header">
          <Link href={`/login?plan=${selectedPlan}`} aria-label="Назад">
            <ArrowLeftIcon aria-hidden="true" size={20} />
          </Link>
          <h1 id="checkout-title">Оформление подписки</h1>
        </header>

        <div className="checkout-content">
          <div className="order-summary">
            <div className="order-heading">
              <strong>{annual ? "Годовой тариф" : "Месячный тариф"}</strong>
              {annual ? <span className="badge badge-success">−22%</span> : null}
            </div>
            <div>
              <span>
                Подписка на {annual ? "12 месяцев" : "1 месяц"}
              </span>
              <strong>{annual ? "14 000 ₽" : "1 500 ₽"}</strong>
            </div>
            {annual ? (
              <div className="order-old-price">
                <span>Вместо 12 × 1 500 ₽</span>
                <span>18 000 ₽</span>
              </div>
            ) : null}
            <div className="order-total">
              <strong>Итого</strong>
              <strong>{annual ? "14 000 ₽" : "1 500 ₽"}</strong>
            </div>
          </div>

          <p className="checkout-account">
            Аккаунт: <strong>{accountLabel}</strong> ({methodLabel}). Доступ
            действует до {accessEndDateLabel}. Повторного списания не будет.
          </p>

          <CheckoutButton
            plan={selectedPlan}
            initialReceiptEmail={user.receiptEmail}
          />
          <p className="secure-note">
            <LockKeyIcon aria-hidden="true" size={15} />
            Защищённая страница ЮKassa · демо пропускает этот шаг
          </p>
        </div>
      </section>
    </main>
  );
}
