type CabinetAccessPresentationInput = {
  canReadCourses: boolean;
  subscriptionActive: boolean;
  subscriptionEnded: boolean;
  hasSubscription: boolean;
  formattedPeriodEnd: string | null;
};

function endedPeriodSentence(formattedPeriodEnd: string | null) {
  if (!formattedPeriodEnd) {
    return ".";
  }

  return formattedPeriodEnd.endsWith(".")
    ? ` ${formattedPeriodEnd}`
    : ` ${formattedPeriodEnd}.`;
}

export function createCabinetAccessPresentation(
  input: CabinetAccessPresentationInput,
) {
  const hasAlternativeCourseAccess =
    input.canReadCourses && !input.subscriptionActive;
  const periodEnd = endedPeriodSentence(
    input.formattedPeriodEnd,
  );

  return {
    headerStatus: input.subscriptionActive
      ? { label: "Подписка активна", active: true }
      : hasAlternativeCourseAccess
        ? { label: "Доступ активен", active: true }
        : input.subscriptionEnded
          ? { label: "Доступ завершён", active: false }
          : { label: "Нет подписки", active: false },
    paidSubscriptionStatus: input.subscriptionActive
      ? "Активна"
      : input.subscriptionEnded
        ? "Завершена"
        : "Не оформлена",
    inactiveSubscriptionSummary: input.subscriptionActive
      ? null
      : hasAlternativeCourseAccess
        ? input.subscriptionEnded
          ? `Оплаченный период завершён${periodEnd} Доступ к курсам остаётся активным.`
          : "Платная подписка не оформлена. Доступ к курсам активен."
        : input.subscriptionEnded
          ? `Оплаченный период завершён${periodEnd} Выберите тариф, чтобы снова открыть курсы.`
          : "Выберите тариф, чтобы открыть все курсы Академии.",
    subscriptionStatusNote: hasAlternativeCourseAccess
      ? input.subscriptionEnded
        ? `Предыдущий оплаченный период завершился${periodEnd} Доступ к курсам остаётся активным.`
        : "Доступ к курсам уже активен. Платная подписка не оформлена."
      : input.subscriptionEnded
        ? `Предыдущий оплаченный период завершился${periodEnd} Выберите новый тариф, чтобы восстановить доступ.`
        : null,
    showRenewalDetails: input.hasSubscription,
  };
}
