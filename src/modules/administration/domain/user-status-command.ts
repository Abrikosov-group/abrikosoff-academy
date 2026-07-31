import type { IdentityUserStatus } from "@/modules/identity/domain/types";

export const userStatusCommandActions = [
  "block",
  "unblock",
] as const;

export type UserStatusCommandAction =
  (typeof userStatusCommandActions)[number];

export const blockUserReasonOptions = [
  {
    code: "suspected_unauthorized_access",
    canonicalReason: "Подозрение на посторонний доступ",
  },
  {
    code: "student_requested_block",
    canonicalReason: "Запрос ученика заблокировать учётную запись",
  },
  {
    code: "terms_violation_review",
    canonicalReason: "Ограничение доступа на время проверки нарушения",
  },
  {
    code: "support_security_measure",
    canonicalReason: "Проверка безопасности службой поддержки",
  },
] as const;

export const unblockUserReasonOptions = [
  {
    code: "security_check_completed",
    canonicalReason: "Проверка безопасности завершена",
  },
  {
    code: "student_request_resolved",
    canonicalReason: "Запрос ученика обработан",
  },
  {
    code: "restriction_review_completed",
    canonicalReason: "Проверка ограничения доступа завершена",
  },
  {
    code: "support_correction",
    canonicalReason: "Исправление службой поддержки",
  },
] as const;

export type BlockUserReasonCode =
  (typeof blockUserReasonOptions)[number]["code"];
export type UnblockUserReasonCode =
  (typeof unblockUserReasonOptions)[number]["code"];
export type UserStatusReasonCode =
  | BlockUserReasonCode
  | UnblockUserReasonCode;

export function isUserStatusCommandAction(
  value: unknown,
): value is UserStatusCommandAction {
  return (
    typeof value === "string" &&
    userStatusCommandActions.includes(
      value as UserStatusCommandAction,
    )
  );
}

export function targetStatusForUserStatusAction(
  action: UserStatusCommandAction,
): Extract<IdentityUserStatus, "active" | "blocked"> {
  return action === "block" ? "blocked" : "active";
}

export function isUserStatusReasonCode(
  action: UserStatusCommandAction,
  value: unknown,
): value is UserStatusReasonCode {
  const options =
    action === "block"
      ? blockUserReasonOptions
      : unblockUserReasonOptions;

  return (
    typeof value === "string" &&
    options.some((option) => option.code === value)
  );
}

export function canonicalUserStatusReason(
  action: UserStatusCommandAction,
  code: UserStatusReasonCode,
) {
  const options:
    | typeof blockUserReasonOptions
    | typeof unblockUserReasonOptions =
    action === "block"
      ? blockUserReasonOptions
      : unblockUserReasonOptions;

  return options.find(
    (option) => option.code === code,
  )!.canonicalReason;
}
