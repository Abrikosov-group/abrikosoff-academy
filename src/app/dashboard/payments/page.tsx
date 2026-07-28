import type { Metadata } from "next";
import Link from "next/link";
import { getDatabasePool } from "@/lib/database";
import type {
  OrderStatus,
  PaymentProviderId,
  SubscriptionPlanId,
} from "@/modules/billing/domain/types";
import { getCustomerOrderHistory } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { getCabinetContext } from "../_lib/cabinet-context";

export const metadata: Metadata = {
  title: "История платежей",
  description: "Заказы и оплаты ученика.",
};

const planLabels: Record<SubscriptionPlanId, string> = {
  annual: "Годовой",
  monthly: "Месячный",
};

const providerLabels: Record<PaymentProviderId, string> = {
  demo: "Тестовая оплата",
  yookassa: "ЮKassa",
};

const statusLabels: Record<OrderStatus, string> = {
  canceled: "Отменён",
  paid: "Оплачен",
  partially_refunded: "Частичный возврат",
  pending: "Обрабатывается",
  refunded: "Возвращён",
};

function formatOrderDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function formatOrderAmount(amountMinor: number, currency: "RUB") {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export default async function CabinetPaymentsPage() {
  const { user } = await getCabinetContext();
  const orders = await getCustomerOrderHistory(
    getDatabasePool(),
    user.id,
  );

  return (
    <>
      <header className="cabinet-section-heading">
        <p className="overline">Заказы и оплаты</p>
        <h1>История платежей</h1>
        <p>
          Здесь отображаются все попытки оплаты и завершённые
          платежи.
        </p>
      </header>

      {orders.length === 0 ? (
        <section className="cabinet-empty-state">
          <h2>Платежей пока нет</h2>
          <p>
            После первой оплаты здесь появятся тариф, сумма и статус
            заказа.
          </p>
          <Link
            className="button button-primary"
            href="/dashboard/subscription"
          >
            Выбрать тариф
          </Link>
        </section>
      ) : (
        <div className="cabinet-table-wrap">
          <table className="cabinet-payment-table">
            <caption className="visually-hidden">
              Заказы и платежи в Академии
            </caption>
            <thead>
              <tr>
                <th scope="col">Дата</th>
                <th scope="col">Тариф</th>
                <th scope="col">Способ</th>
                <th scope="col">Статус</th>
                <th scope="col">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    {formatOrderDate(
                      order.paidAt ?? order.createdAt,
                    )}
                  </td>
                  <td>{planLabels[order.planId]}</td>
                  <td>{providerLabels[order.provider]}</td>
                  <td>
                    <span
                      className={`cabinet-order-status cabinet-order-status-${order.status}`}
                    >
                      {statusLabels[order.status]}
                    </span>
                  </td>
                  <td>
                    {formatOrderAmount(
                      order.amountMinor,
                      order.currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
