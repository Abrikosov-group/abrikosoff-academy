import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  LockKeyIcon,
} from "@phosphor-icons/react/dist/ssr";
import { CheckoutButton } from "@/components/academy/checkout-button";

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

  return (
    <main className="checkout-page">
      <Link className="back-link" href={`/login?plan=${selectedPlan}`}>
        <ArrowLeftIcon aria-hidden="true" size={18} />
        Назад
      </Link>

      <section className="checkout-card" aria-labelledby="checkout-title">
        <div className="checkout-brand">
          <Image
            src="/brand/logo-horizontal.svg"
            alt="Академия Абрикософф"
            width={384}
            height={100}
            priority
          />
        </div>
        <header>
          <p className="overline">Последний шаг</p>
          <h1 id="checkout-title">Проверьте подписку</h1>
          <p>После оплаты откроются все курсы и личный кабинет.</p>
        </header>

        <div className="order-summary">
          <div>
            <span>Тариф</span>
            <strong>{annual ? "Годовой" : "Месячный"}</strong>
          </div>
          <div>
            <span>Период</span>
            <strong>{annual ? "12 месяцев" : "1 месяц"}</strong>
          </div>
          <div className="order-total">
            <span>К оплате</span>
            <strong>{annual ? "14 000 ₽" : "1 500 ₽"}</strong>
          </div>
        </div>

        <ul className="checkout-features">
          <li>
            <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
            Доступ ко всем курсам сразу после оплаты
          </li>
          <li>
            <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
            История платежей и управление продлением в кабинете
          </li>
        </ul>

        <CheckoutButton plan={selectedPlan} />
        <p className="secure-note">
          <LockKeyIcon aria-hidden="true" size={17} />
          Оплата откроется на защищённой странице ЮKassa
        </p>
        <p className="prototype-note">
          Это интерактивный прототип: реальное списание не выполняется.
        </p>
      </section>
    </main>
  );
}
