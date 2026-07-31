"use client";

import { SpinnerGapIcon } from "@phosphor-icons/react/dist/icons/SpinnerGap";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useRef,
  useState,
} from "react";
import { formatRussianCount } from "@/modules/administration/domain/student-presentation";
import {
  blockUserReasonOptions,
  isUserStatusReasonCode,
  unblockUserReasonOptions,
} from "@/modules/administration/domain/user-status-command";
import type { AdminStudentStatus } from "@/modules/administration/domain/student-read-model";

const sessionCountForms = [
  "сессия",
  "сессии",
  "сессий",
] as const;
const terminalCommandErrorCodes = new Set([
  "ADMINISTRATION_DISABLED",
  "ADMIN_AUTH_REQUIRED",
  "ADMIN_LOGIN_REQUIRED",
  "ADMIN_ROLE_REQUIRED",
  "ADMIN_PERMISSION_DENIED",
  "ADMIN_REAUTH_REQUIRED",
  "ADMIN_VERIFICATION_REJECTED",
  "ADMIN_COMMAND_INVALID_REQUEST",
  "IDEMPOTENCY_CONFLICT",
  "USER_NOT_FOUND",
  "USER_STATUS_TRANSITION_INVALID",
  "LAST_AVAILABLE_OWNER",
  "CHANGE_USER_STATUS_FAILED",
]);

type CommandPayload = {
  currentSessionRevoked?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
  requestId?: unknown;
  revokedSessionCount?: unknown;
  status?: unknown;
  statusChanged?: unknown;
};

export function AdminUserStatusDialog({
  isCurrentActor,
  studentDisplayName,
  studentId,
  studentStatus,
}: {
  isCurrentActor: boolean;
  studentDisplayName: string;
  studentId: string;
  studentStatus: AdminStudentStatus;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const operationKeyRef = useRef<string | null>(null);
  const submittedInputRef = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [requestId, setRequestId] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  if (studentStatus === "deleted") {
    return null;
  }

  const statusAction =
    studentStatus === "active" ? "block" : "unblock";
  const blocking = statusAction === "block";
  const reasonOptions = blocking
    ? blockUserReasonOptions
    : unblockUserReasonOptions;
  const targetStatus = blocking ? "blocked" : "active";
  const dialogTitle = blocking
    ? "Заблокировать учётную запись?"
    : "Разблокировать учётную запись?";

  function openDialog() {
    operationKeyRef.current ??= crypto.randomUUID();
    setReasonError("");
    setErrorMessage("");
    setRequestId("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (!processing) {
      dialogRef.current?.close();
    }
  }

  async function changeStatus(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (processing) {
      return;
    }

    const normalizedReason = reason.trim();

    if (
      !isUserStatusReasonCode(
        statusAction,
        normalizedReason,
      )
    ) {
      setReasonError("Выберите причину изменения.");
      setErrorMessage("");
      setRequestId("");
      return;
    }

    const submittedInput = `${statusAction}:${normalizedReason}`;

    if (
      submittedInputRef.current !== null &&
      submittedInputRef.current !== submittedInput
    ) {
      operationKeyRef.current = crypto.randomUUID();
    }

    operationKeyRef.current ??= crypto.randomUUID();
    submittedInputRef.current = submittedInput;
    setProcessing(true);
    setReasonError("");
    setErrorMessage("");
    setRequestId("");

    try {
      const response = await fetch(
        `/api/admin/students/${encodeURIComponent(
          studentId,
        )}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationKeyRef.current,
          },
          body: JSON.stringify({
            action: statusAction,
            reason: normalizedReason,
          }),
          cache: "no-store",
        },
      );
      let payload: CommandPayload = {};

      try {
        payload = (await response.json()) as CommandPayload;
      } catch {
        // Ни тело ошибки, ни его фрагменты не заменяют безопасное сообщение.
      }

      if (!response.ok) {
        const errorCode =
          typeof payload.error?.code === "string"
            ? payload.error.code
            : "";

        if (terminalCommandErrorCodes.has(errorCode)) {
          operationKeyRef.current = null;
          submittedInputRef.current = null;
        }
        if (
          errorCode === "ADMIN_AUTH_REQUIRED" ||
          errorCode === "ADMIN_LOGIN_REQUIRED"
        ) {
          window.location.assign(
            `/login?next=${encodeURIComponent(
              `/admin/students/${studentId}`,
            )}`,
          );
          return;
        }
        if (errorCode === "ADMIN_REAUTH_REQUIRED") {
          window.location.assign(
            `/admin/verify?next=${encodeURIComponent(
              `/admin/students/${studentId}`,
            )}`,
          );
          return;
        }
        setRequestId(
          typeof payload.requestId === "string"
            ? payload.requestId
            : "",
        );
        throw new Error(
          typeof payload.error?.message === "string"
            ? payload.error.message
            : "Не удалось изменить состояние ученика. Повторите попытку.",
        );
      }

      if (
        payload.status !== targetStatus ||
        typeof payload.statusChanged !== "boolean" ||
        typeof payload.revokedSessionCount !== "number" ||
        !Number.isSafeInteger(payload.revokedSessionCount) ||
        payload.revokedSessionCount < 0
      ) {
        setRequestId(
          typeof payload.requestId === "string"
            ? payload.requestId
            : "",
        );
        throw new Error(
          "Сервер вернул некорректный результат. Повторите попытку.",
        );
      }

      operationKeyRef.current = null;
      submittedInputRef.current = null;

      if (payload.currentSessionRevoked === true) {
        window.location.assign("/login");
        return;
      }

      if (blocking) {
        setSuccessMessage(
          payload.statusChanged
            ? `Учётная запись заблокирована. ${formatRussianCount(
                payload.revokedSessionCount,
                sessionCountForms,
              )} отозвано.`
            : "Учётная запись уже заблокирована. Активные сессии отозваны.",
        );
      } else {
        setSuccessMessage(
          payload.statusChanged
            ? "Учётная запись разблокирована. Для входа потребуется новая сессия."
            : "Учётная запись уже активна.",
        );
      }

      setReason("");
      setProcessing(false);
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось изменить состояние ученика. Повторите попытку.",
      );
      setProcessing(false);
    }
  }

  return (
    <div className="admin-status-command">
      <button
        className={`button ${
          blocking ? "button-danger" : "button-secondary"
        } button-small`}
        type="button"
        onClick={openDialog}
      >
        {blocking
          ? "Заблокировать учётную запись"
          : "Разблокировать учётную запись"}
      </button>
      {successMessage ? (
        <p
          className="admin-command-success"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}
      <dialog
        aria-describedby="change-user-status-consequence"
        aria-labelledby="change-user-status-title"
        className="admin-command-dialog"
        ref={dialogRef}
        onCancel={(event) => {
          if (processing) {
            event.preventDefault();
          }
        }}
      >
        <form
          aria-busy={processing}
          className="admin-command-form"
          onSubmit={changeStatus}
        >
          <div>
            <p className="overline">
              {blocking
                ? "Критическое действие"
                : "Изменение состояния"}
            </p>
            <h2 id="change-user-status-title">
              {dialogTitle}
            </h2>
          </div>
          <p id="change-user-status-consequence">
            {blocking ? (
              <>
                У ученика «{studentDisplayName}» немедленно
                завершатся все активные сессии. История
                оплаченного доступа и платежей не изменится.
                {isCurrentActor
                  ? " Текущая административная сессия тоже завершится."
                  : ""}
              </>
            ) : (
              <>
                Учётная запись ученика «{studentDisplayName}»
                снова сможет проходить вход. Прежние сессии не
                восстановятся, история оплаченного доступа и
                платежей не изменится.
              </>
            )}
          </p>
          <label htmlFor="change-user-status-reason">
            Причина изменения
          </label>
          <select
            aria-describedby={
              reasonError
                ? "change-user-status-reason-help change-user-status-reason-error"
                : "change-user-status-reason-help"
            }
            aria-invalid={Boolean(reasonError)}
            autoComplete="off"
            disabled={processing}
            id="change-user-status-reason"
            name="reason"
            required
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError("");
              setErrorMessage("");
              setRequestId("");
            }}
            onInvalid={() => {
              setReasonError("Выберите причину изменения.");
            }}
          >
            <option disabled value="">
              Выберите причину
            </option>
            {reasonOptions.map((option) => (
              <option
                key={option.code}
                value={option.code}
              >
                {option.canonicalReason}
              </option>
            ))}
          </select>
          <small id="change-user-status-reason-help">
            В аудит сохранится только выбранная обезличенная
            формулировка — без имён, контактов и токенов.
          </small>
          {reasonError ? (
            <p
              className="field-error"
              id="change-user-status-reason-error"
              role="alert"
            >
              {reasonError}
            </p>
          ) : null}
          {errorMessage ? (
            <div
              className="admin-command-error"
              id="change-user-status-error"
              role="alert"
            >
              <p>{errorMessage}</p>
              {requestId ? (
                <small>Код запроса: {requestId}</small>
              ) : null}
            </div>
          ) : null}
          <div className="admin-command-dialog-actions">
            <button
              className="button button-secondary"
              disabled={processing}
              type="button"
              onClick={closeDialog}
            >
              Отмена
            </button>
            <button
              className={`button ${
                blocking ? "button-danger" : "button-primary"
              }`}
              disabled={processing}
              type="submit"
            >
              {processing ? (
                <>
                  <SpinnerGapIcon
                    aria-hidden="true"
                    className="spinner"
                    size={20}
                  />
                  Сохраняем…
                </>
              ) : blocking ? (
                "Заблокировать"
              ) : (
                "Разблокировать"
              )}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
