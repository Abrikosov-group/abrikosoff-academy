type CabinetAccessPresentationInput = {
  canReadCourses: boolean;
  subscriptionActive: boolean;
  subscriptionEnded: boolean;
  hasSubscription: boolean;
  formattedPeriodEnd: string | null;
  manualAccessActive: boolean;
  paidGrantAccessActive: boolean;
  formattedManualAccessPeriodEnd: string | null;
  formattedPaidGrantAccessPeriodEnd: string | null;
};

function endedPeriodSentence(formattedPeriodEnd: string | null) {
  if (!formattedPeriodEnd) {
    return ".";
  }

  return formattedPeriodEnd.endsWith(".")
    ? ` ${formattedPeriodEnd}`
    : ` ${formattedPeriodEnd}.`;
}

function activePeriodSentence(
  label: string,
  formattedPeriodEnd: string | null,
) {
  if (!formattedPeriodEnd) {
    return `${label}.`;
  }

  return formattedPeriodEnd.endsWith(".")
    ? `${label} ${formattedPeriodEnd}`
    : `${label} ${formattedPeriodEnd}.`;
}

export function createCabinetAccessPresentation(
  input: CabinetAccessPresentationInput,
) {
  const hasAlternativeCourseAccess =
    input.canReadCourses && !input.subscriptionActive;
  const hasKnownEffectiveAccess =
    input.manualAccessActive || input.paidGrantAccessActive;
  const periodEnd = endedPeriodSentence(
    input.formattedPeriodEnd,
  );
  const manualAccessSentence = input.manualAccessActive
    ? activePeriodSentence(
        "Ручной доступ действует до",
        input.formattedManualAccessPeriodEnd,
      )
    : null;
  const paidGrantAccessSentence = input.paidGrantAccessActive
    ? activePeriodSentence(
        "Оплаченный доступ действует до",
        input.formattedPaidGrantAccessPeriodEnd,
      )
    : null;
  const effectiveAccessSentence = [
    paidGrantAccessSentence,
    manualAccessSentence,
  ]
    .filter((sentence): sentence is string => Boolean(sentence))
    .join(" ");
  const inactiveKnownAccessSummary = input.subscriptionEnded
    ? `Предыдущий оплаченный период завершён${periodEnd} ${effectiveAccessSentence}`
    : `${effectiveAccessSentence} Платная подписка не оформлена.`;

  return {
    headerStatus: input.subscriptionActive
      ? { label: "Подписка активна", active: true }
      : hasAlternativeCourseAccess
        ? {
            label:
              input.manualAccessActive &&
              !input.paidGrantAccessActive
                ? "Ручной доступ активен"
                : input.paidGrantAccessActive &&
                    !input.manualAccessActive
                  ? "Оплаченный доступ активен"
                  : "Доступ активен",
            active: true,
          }
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
        ? hasKnownEffectiveAccess
          ? inactiveKnownAccessSummary
          : input.subscriptionEnded
            ? `Оплаченный период завершён${periodEnd} Доступ к курсам остаётся активным.`
            : "Платная подписка не оформлена. Доступ к курсам активен."
        : input.subscriptionEnded
          ? `Оплаченный период завершён${periodEnd} Выберите тариф, чтобы снова открыть курсы.`
          : "Выберите тариф, чтобы открыть все курсы Академии.",
    subscriptionStatusNote: hasAlternativeCourseAccess
      ? hasKnownEffectiveAccess
        ? inactiveKnownAccessSummary
        : input.subscriptionEnded
          ? `Предыдущий оплаченный период завершился${periodEnd} Доступ к курсам остаётся активным.`
          : "Доступ к курсам уже активен. Платная подписка не оформлена."
      : input.subscriptionEnded
        ? `Предыдущий оплаченный период завершился${periodEnd} Выберите новый тариф, чтобы восстановить доступ.`
        : null,
    additionalAccessNote:
      input.subscriptionActive && manualAccessSentence
        ? manualAccessSentence
        : null,
    showRenewalDetails: input.hasSubscription,
  };
}
