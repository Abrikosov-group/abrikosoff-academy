export const revokeUserSessionsReasonOptions = [
  {
    code: "suspected_unauthorized_access",
    canonicalReason: "Подозрение на посторонний доступ",
  },
  {
    code: "student_requested_sign_out",
    canonicalReason: "Запрос ученика завершить все сессии",
  },
  {
    code: "trusted_device_changed",
    canonicalReason: "Утрата или замена доверенного устройства",
  },
  {
    code: "support_security_measure",
    canonicalReason: "Проверка безопасности службой поддержки",
  },
] as const;

export type RevokeUserSessionsReasonCode =
  (typeof revokeUserSessionsReasonOptions)[number]["code"];

export function isRevokeUserSessionsReasonCode(
  value: unknown,
): value is RevokeUserSessionsReasonCode {
  return (
    typeof value === "string" &&
    revokeUserSessionsReasonOptions.some(
      (option) => option.code === value,
    )
  );
}

export function canonicalRevokeUserSessionsReason(
  code: RevokeUserSessionsReasonCode,
) {
  return revokeUserSessionsReasonOptions.find(
    (option) => option.code === code,
  )!.canonicalReason;
}
