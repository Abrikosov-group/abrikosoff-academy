import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = {
  title: "Оплата прошла",
  description: "Подписка Академии активна.",
};

type SuccessPageProps = {
  searchParams: Promise<{ plan?: string }>;
};

export default async function PaymentSuccessPage({
  searchParams,
}: SuccessPageProps) {
  const { plan } = await searchParams;
  const selectedPlan = plan === "monthly" ? "monthly" : "annual";

  return (
    <main className="success-page">
      <section className="success-card" aria-labelledby="success-title">
        <div className="success-icon">
          <CheckCircleIcon aria-hidden="true" size={64} weight="fill" />
        </div>
        <p className="overline">Добро пожаловать</p>
        <h1 id="success-title">Подписка активна</h1>
        <p>
          {selectedPlan === "annual" ? "Годовой" : "Месячный"} доступ к
          Академии открыт. Начните с короткого вводного урока.
        </p>
        <Link
          className="button button-primary"
          href="/courses/healthy-habits/lessons/1"
        >
          Открыть первый урок
          <ArrowRightIcon aria-hidden="true" size={20} />
        </Link>
        <Link className="text-link centered-link" href="/dashboard">
          Перейти в личный кабинет
        </Link>
      </section>
    </main>
  );
}
