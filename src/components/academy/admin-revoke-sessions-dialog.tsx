"use client";

import { SpinnerGapIcon } from "@phosphor-icons/react/dist/icons/SpinnerGap";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useRef,
  useState,
} from "react";
import {
  isRevokeUserSessionsReasonCode,
  revokeUserSessionsReasonOptions,
} from "@/modules/administration/domain/revoke-user-sessions";
import { formatRussianCount } from "@/modules/administration/domain/student-presentation";

const sessionCountForms = [
  "сессия",
  "сессии",
  "сессий",
] as const;

type CommandPayload = {
  activeSessionCount?: unknown;
  currentSessionRevoked?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
  requestId?: unknown;
  revokedSessionCount?: unknown;
};

export function AdminRevokeSessionsDialog({
  activeSessionCount,
  isCurrentActor,
  studentDisplayName,
  studentId,
}: {
  activeSessionCount: number;
  isCurrentActor: boolean;
  studentDisplayName: string;
  studentId: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const operationKeyRef = useRef<string | null>(null);
  const submittedReasonRef = useRef<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [requestId, setRequestId] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

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

  async function revokeSessions(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (processing) {
      return;
    }

    const normalizedReason = reason.trim();

    if (!isRevokeUserSessionsReasonCode(normalizedReason)) {
      setReasonError("Выберите причину отзыва.");
      setErrorMessage("");
      setRequestId("");
      return;
    }

    if (
      submittedReasonRef.current !== null &&
      submittedReasonRef.current !== normalizedReason
    ) {
      operationKeyRef.current = crypto.randomUUID();
    }

    operationKeyRef.current ??= crypto.randomUUID();
    submittedReasonRef.current = normalizedReason;
    setProcessing(true);
    setReasonError("");
    setErrorMessage("");
    setRequestId("");

    try {
      const response = await fetch(
        `/api/admin/students/${encodeURIComponent(
          studentId,
        )}/sessions/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationKeyRef.current,
          },
          body: JSON.stringify({
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

        if (
          errorCode !== "COMMAND_IN_PROGRESS" &&
          errorCode !== "COMMAND_ATTEMPT_SUPERSEDED" &&
          errorCode !== "COMMAND_RECOVERY_REQUIRED"
        ) {
          operationKeyRef.current = null;
          submittedReasonRef.current = null;
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
            : "Не удалось отозвать сессии. Повторите попытку.",
        );
      }

      if (
        payload.activeSessionCount !== 0 ||
        typeof payload.revokedSessionCount !== "number"
      ) {
        operationKeyRef.current = null;
        submittedReasonRef.current = null;
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
      submittedReasonRef.current = null;

      if (payload.currentSessionRevoked === true) {
        window.location.assign("/login");
        return;
      }

      setSuccessMessage(
        payload.revokedSessionCount === 0
          ? "Активных сессий уже не было."
          : `${formatRussianCount(
              payload.revokedSessionCount,
              sessionCountForms,
            )} отозвано.`,
      );
      setReason("");
      setProcessing(false);
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось отозвать сессии. Повторите попытку.",
      );
      setProcessing(false);
    }
  }

  if (activeSessionCount <= 0) {
    return successMessage ? (
      <p
        className="admin-command-success"
        role="status"
      >
        {successMessage}
      </p>
    ) : null;
  }

  return (
    <div className="admin-session-command">
      <button
        className="button button-danger button-small"
        type="button"
        onClick={openDialog}
      >
        Отозвать все активные сессии
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
        aria-describedby="revoke-sessions-consequence"
        aria-labelledby="revoke-sessions-title"
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
          onSubmit={revokeSessions}
        >
          <div>
            <p className="overline">Критическое действие</p>
            <h2 id="revoke-sessions-title">
              Отозвать все сессии?
            </h2>
          </div>
          <p id="revoke-sessions-consequence">
            У ученика «{studentDisplayName}» будут отозваны{" "}
            {formatRussianCount(
              activeSessionCount,
              sessionCountForms,
            )}
            . На всех устройствах потребуется войти заново.
            {isCurrentActor
              ? " Текущая административная сессия тоже завершится."
              : ""}
          </p>
          <label htmlFor="revoke-sessions-reason">
            Причина отзыва
          </label>
          <select
            aria-describedby={
              reasonError
                ? "revoke-sessions-reason-help revoke-sessions-reason-error"
                : "revoke-sessions-reason-help"
            }
            aria-invalid={Boolean(reasonError)}
            autoComplete="off"
            disabled={processing}
            id="revoke-sessions-reason"
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
              setReasonError("Выберите причину отзыва.");
            }}
          >
            <option disabled value="">
              Выберите причину
            </option>
            {revokeUserSessionsReasonOptions.map((option) => (
              <option
                key={option.code}
                value={option.code}
              >
                {option.canonicalReason}
              </option>
            ))}
          </select>
          <small id="revoke-sessions-reason-help">
            В аудит сохранится только выбранная обезличенная
            формулировка — без имён, контактов и токенов.
          </small>
          {reasonError ? (
            <p
              className="field-error"
              id="revoke-sessions-reason-error"
              role="alert"
            >
              {reasonError}
            </p>
          ) : null}
          {errorMessage ? (
            <div
              className="admin-command-error"
              id="revoke-sessions-error"
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
              className="button button-danger"
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
                  Отзываем…
                </>
              ) : (
                "Отозвать сессии"
              )}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
