import { describe, expect, it } from "vitest";
import { createCabinetAccessPresentation } from "@/app/dashboard/_lib/cabinet-access-presentation";

describe("представление доступа в кабинете", () => {
  it.each([
    {
      label: "ручной доступ без платной подписки",
      input: {
        canReadCourses: true,
        subscriptionActive: false,
        subscriptionEnded: false,
        hasSubscription: false,
        formattedPeriodEnd: null,
      },
      expected: {
        headerStatus: { label: "Доступ активен", active: true },
        paidSubscriptionStatus: "Не оформлена",
        inactiveSubscriptionSummary:
          "Платная подписка не оформлена. Доступ к курсам активен.",
        subscriptionStatusNote:
          "Доступ к курсам уже активен. Платная подписка не оформлена.",
        showRenewalDetails: false,
      },
    },
    {
      label: "ручной доступ после завершения платной подписки",
      input: {
        canReadCourses: true,
        subscriptionActive: false,
        subscriptionEnded: true,
        hasSubscription: true,
        formattedPeriodEnd: "31 июля 2026 г.",
      },
      expected: {
        headerStatus: { label: "Доступ активен", active: true },
        paidSubscriptionStatus: "Завершена",
        inactiveSubscriptionSummary:
          "Оплаченный период завершён 31 июля 2026 г. Доступ к курсам остаётся активным.",
        subscriptionStatusNote:
          "Предыдущий оплаченный период завершился 31 июля 2026 г. Доступ к курсам остаётся активным.",
        showRenewalDetails: true,
      },
    },
    {
      label: "действующая платная подписка",
      input: {
        canReadCourses: true,
        subscriptionActive: true,
        subscriptionEnded: false,
        hasSubscription: true,
        formattedPeriodEnd: "31 июля 2027 г.",
      },
      expected: {
        headerStatus: {
          label: "Подписка активна",
          active: true,
        },
        paidSubscriptionStatus: "Активна",
        inactiveSubscriptionSummary: null,
        subscriptionStatusNote: null,
        showRenewalDetails: true,
      },
    },
    {
      label: "завершённый доступ без другого основания",
      input: {
        canReadCourses: false,
        subscriptionActive: false,
        subscriptionEnded: true,
        hasSubscription: true,
        formattedPeriodEnd: "31 июля 2026 г.",
      },
      expected: {
        headerStatus: {
          label: "Доступ завершён",
          active: false,
        },
        paidSubscriptionStatus: "Завершена",
        inactiveSubscriptionSummary:
          "Оплаченный период завершён 31 июля 2026 г. Выберите тариф, чтобы снова открыть курсы.",
        subscriptionStatusNote:
          "Предыдущий оплаченный период завершился 31 июля 2026 г. Выберите новый тариф, чтобы восстановить доступ.",
        showRenewalDetails: true,
      },
    },
  ])("показывает согласованный статус: $label", ({ input, expected }) => {
    expect(createCabinetAccessPresentation(input)).toEqual(expected);
  });
});
