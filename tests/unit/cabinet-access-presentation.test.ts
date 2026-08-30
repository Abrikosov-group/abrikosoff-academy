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
        manualAccessActive: true,
        paidGrantAccessActive: false,
        formattedManualAccessPeriodEnd: "1 сентября 2040 г.",
        formattedPaidGrantAccessPeriodEnd: null,
      },
      expected: {
        headerStatus: {
          label: "Ручной доступ активен",
          active: true,
        },
        paidSubscriptionStatus: "Не оформлена",
        inactiveSubscriptionSummary:
          "Ручной доступ действует до 1 сентября 2040 г. Платная подписка не оформлена.",
        subscriptionStatusNote:
          "Ручной доступ действует до 1 сентября 2040 г. Платная подписка не оформлена.",
        additionalAccessNote: null,
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
        manualAccessActive: true,
        paidGrantAccessActive: false,
        formattedManualAccessPeriodEnd: "1 сентября 2040 г.",
        formattedPaidGrantAccessPeriodEnd: null,
      },
      expected: {
        headerStatus: {
          label: "Ручной доступ активен",
          active: true,
        },
        paidSubscriptionStatus: "Завершена",
        inactiveSubscriptionSummary:
          "Предыдущий оплаченный период завершён 31 июля 2026 г. Ручной доступ действует до 1 сентября 2040 г.",
        subscriptionStatusNote:
          "Предыдущий оплаченный период завершён 31 июля 2026 г. Ручной доступ действует до 1 сентября 2040 г.",
        additionalAccessNote: null,
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
        manualAccessActive: false,
        paidGrantAccessActive: true,
        formattedManualAccessPeriodEnd: null,
        formattedPaidGrantAccessPeriodEnd: "31 июля 2027 г.",
      },
      expected: {
        headerStatus: {
          label: "Подписка активна",
          active: true,
        },
        paidSubscriptionStatus: "Активна",
        inactiveSubscriptionSummary: null,
        subscriptionStatusNote: null,
        additionalAccessNote: null,
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
        manualAccessActive: false,
        paidGrantAccessActive: false,
        formattedManualAccessPeriodEnd: null,
        formattedPaidGrantAccessPeriodEnd: null,
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
        additionalAccessNote: null,
        showRenewalDetails: true,
      },
    },
    {
      label: "оплаченный v2-доступ без активной подписки",
      input: {
        canReadCourses: true,
        subscriptionActive: false,
        subscriptionEnded: false,
        hasSubscription: false,
        formattedPeriodEnd: null,
        manualAccessActive: false,
        paidGrantAccessActive: true,
        formattedManualAccessPeriodEnd: null,
        formattedPaidGrantAccessPeriodEnd: "1 октября 2040 г.",
      },
      expected: {
        headerStatus: {
          label: "Оплаченный доступ активен",
          active: true,
        },
        paidSubscriptionStatus: "Не оформлена",
        inactiveSubscriptionSummary:
          "Оплаченный доступ действует до 1 октября 2040 г. Платная подписка не оформлена.",
        subscriptionStatusNote:
          "Оплаченный доступ действует до 1 октября 2040 г. Платная подписка не оформлена.",
        additionalAccessNote: null,
        showRenewalDetails: false,
      },
    },
    {
      label: "ручной грант одновременно с активной подпиской",
      input: {
        canReadCourses: true,
        subscriptionActive: true,
        subscriptionEnded: false,
        hasSubscription: true,
        formattedPeriodEnd: "31 июля 2040 г.",
        manualAccessActive: true,
        paidGrantAccessActive: true,
        formattedManualAccessPeriodEnd: "1 сентября 2040 г.",
        formattedPaidGrantAccessPeriodEnd: "31 июля 2040 г.",
      },
      expected: {
        headerStatus: {
          label: "Подписка активна",
          active: true,
        },
        paidSubscriptionStatus: "Активна",
        inactiveSubscriptionSummary: null,
        subscriptionStatusNote: null,
        additionalAccessNote:
          "Ручной доступ действует до 1 сентября 2040 г.",
        showRenewalDetails: true,
      },
    },
  ])("показывает согласованный статус: $label", ({ input, expected }) => {
    expect(createCabinetAccessPresentation(input)).toEqual(expected);
  });
});
