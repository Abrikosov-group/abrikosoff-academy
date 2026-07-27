import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  CheckIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getDatabasePool } from "@/lib/database";
import { getCustomerOrderSummary } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { getCurrentUser } from "@/modules/identity/server/session";

export const metadata: Metadata = {
  title: "Результат оплаты",
  description: "Состояние оплаты подписки Академии.",
};

type SuccessPageProps = {
  searchParams: Promise<{ orderId?: string }>;
};

export default async function PaymentSuccessPage({
  searchParams,
}: SuccessPageProps) {
  const { orderId } = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const order =
    orderId && /^[0-9a-f-]{36}$/i.test(orderId)
      ? await getCustomerOrderSummary(
          getDatabasePool(),
          orderId,
          user.id,
        )
      : null;
  const annual = order?.planId !== "monthly";
  const paymentConfirmed = order?.status === "paid";

  return (
    <main className="success-page">
      <section className="success-card" aria-labelledby="success-title">
        <div className="success-icon">
          {paymentConfirmed ? (
            <CheckIcon aria-hidden="true" size={34} weight="bold" />
          ) : (
            <SpinnerGapIcon
              aria-hidden="true"
              className="spinner"
              size={34}
            />
          )}
        </div>
        <h1 id="success-title">
          {paymentConfirmed ? "Подписка активна" : "Проверяем оплату"}
        </h1>
        {paymentConfirmed ? (
          <p>
            {annual
              ? "Годовой тариф оплачен — 14 000 ₽."
              : "Месячный тариф оплачен — 1 500 ₽."}
            <br />
            Доступ к материалам Академии уже открыт.
          </p>
        ) : (
          <p>
            Банк вернул вас в Академию. Подтверждаем результат платежа —
            обычно это занимает несколько секунд.
          </p>
        )}

        {paymentConfirmed ? (
          <>
            <div className="success-course-card">
              <span aria-hidden="true" />
              <div>
                <small>Начните сейчас</small>
                <strong>Здоровые привычки · Урок 1</strong>
                <p>5 минут чтения</p>
              </div>
              <ArrowRightIcon aria-hidden="true" size={18} />
            </div>

            <Link
              className="button button-primary"
              href="/courses/healthy-habits/lessons/1"
            >
              Начать первый урок
            </Link>
          </>
        ) : (
          <Link className="button button-primary" href="/dashboard">
            Проверить в личном кабинете
          </Link>
        )}
        <Link
          className="text-link centered-link"
          href={paymentConfirmed ? "/dashboard" : "/pricing"}
        >
          {paymentConfirmed ? "В личный кабинет" : "Вернуться к тарифам"}
        </Link>
      </section>
    </main>
  );
}
