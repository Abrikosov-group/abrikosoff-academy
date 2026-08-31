"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import {
  dateTimeLocalToUtcIso,
  formatDateTimeLocal,
} from "@/modules/administration/domain/admin-date-time";
import type { AdminStudentManualGrant } from "@/modules/administration/domain/student-read-model";

function createIdempotencyKey() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function readErrorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? "Операция не выполнена.";
}

export function AdminManualAccessGrantForm({
  canGrant,
  disabledReason,
  existingGrants,
  displayTimeZone,
  studentDisplayName,
  studentId,
}: {
  canGrant: boolean;
  disabledReason?: string;
  existingGrants: readonly AdminStudentManualGrant[];
  displayTimeZone: string;
  studentDisplayName: string;
  studentId: string;
}) {
  const router = useRouter();
  const [periodStart, setPeriodStart] = useState(() =>
    formatDateTimeLocal(new Date(), displayTimeZone),
  );
  const [periodEnd, setPeriodEnd] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  }>();
  const overlapCount = useMemo(() => {
    const start = Date.parse(periodStart);
    const end = Date.parse(periodEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return existingGrants.filter(
      (grant) =>
        grant.status === "granted" &&
        Date.parse(grant.periodStart) < end &&
        Date.parse(grant.periodEnd) > start,
    ).length;
  }, [existingGrants, periodEnd, periodStart]);
  const durationLabel = useMemo(() => {
    const duration = Date.parse(periodEnd) - Date.parse(periodStart);
    if (!Number.isFinite(duration) || duration <= 0) return "не определена";
    const totalHours = Math.round(duration / 3_600_000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return [days > 0 ? `${days} сут.` : "", hours > 0 ? `${hours} ч.` : ""]
      .filter(Boolean)
      .join(" ");
  }, [periodEnd, periodStart]);

  function beginConfirmation(event: FormEvent) {
    event.preventDefault();
    if (!idempotencyKey) setIdempotencyKey(createIdempotencyKey());
    setConfirming(true);
    setMessage(undefined);
  }

  async function submitGrant() {
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/access/manual`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            periodStart: dateTimeLocalToUtcIso(
              periodStart,
              displayTimeZone,
            ),
            periodEnd: dateTimeLocalToUtcIso(
              periodEnd,
              displayTimeZone,
            ),
            reason,
          }),
        },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setMessage({
        tone: "success",
        text: "Ручной доступ успешно выдан.",
      });
      setConfirming(false);
      setIdempotencyKey("");
      setPeriodStart(formatDateTimeLocal(new Date(), displayTimeZone));
      setPeriodEnd("");
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Не удалось выдать ручной доступ.",
      });
    } finally {
      setPending(false);
    }
  }

  if (!canGrant) {
    return (
      <p className="admin-command-feedback admin-command-feedback-neutral">
        {disabledReason ?? "Выдача ручного доступа недоступна."}
      </p>
    );
  }

  return (
    <form className="admin-command-form" onSubmit={beginConfirmation}>
      <h3>Выдать ручной доступ</h3>
      <div className="admin-command-form-grid">
        <label>
          Начало периода
          <input
            onChange={(event) => {
              setPeriodStart(event.target.value);
              setConfirming(false);
            }}
            required
            type="datetime-local"
            value={periodStart}
          />
        </label>
        <label>
          Окончание периода
          <input
            onChange={(event) => {
              setPeriodEnd(event.target.value);
              setConfirming(false);
            }}
            required
            type="datetime-local"
            value={periodEnd}
          />
        </label>
      </div>
      <label>
        Причина
        <textarea
          maxLength={500}
          minLength={10}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirming(false);
          }}
          required
          value={reason}
        />
        <span>{reason.length}/500 символов</span>
      </label>
      {confirming ? (
        <div className="admin-command-confirmation" role="group">
          <p>
            <strong>{studentDisplayName}</strong>: {periodStart} — {periodEnd}.
            Продолжительность: {durationLabel}. Пересечений с ручными периодами:{" "}
            {overlapCount}. Причина: {reason}
          </p>
          <button
            className="button button-primary"
            disabled={pending}
            onClick={() => void submitGrant()}
            type="button"
          >
            {pending ? "Выдаём…" : "Подтвердить выдачу"}
          </button>
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => setConfirming(false)}
            type="button"
          >
            Изменить данные
          </button>
        </div>
      ) : (
        <button className="button button-primary" type="submit">
          Проверить и продолжить
        </button>
      )}
      {message ? (
        <p
          className={`admin-command-feedback ${
            message.tone === "success"
              ? "admin-command-feedback-success"
              : "admin-command-feedback-error"
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

export function AdminManualAccessRevokeForm({
  accessRemainsAfterRevoke,
  grant,
  studentId,
}: {
  accessRemainsAfterRevoke: boolean;
  grant: AdminStudentManualGrant;
  studentId: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [message, setMessage] = useState<string>();

  if (!grant.canRevoke) return null;

  async function revoke() {
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/access/manual/${grant.id}/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setMessage("Ручной доступ отозван. История сохранена.");
      setConfirming(false);
      window.setTimeout(() => router.refresh(), 2_000);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось отозвать ручной доступ.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-inline-command">
      {confirming ? (
        <>
          <label>
            Причина отзыва
            <textarea
              maxLength={500}
              minLength={10}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
            <span>{reason.length}/500 символов</span>
          </label>
          <p>
            {accessRemainsAfterRevoke
              ? "После отзыва доступ сохранится за счёт другого действующего основания."
              : "Другого действующего основания сейчас нет; после отзыва этот грант не сможет открыть доступ."}
          </p>
          <button
            className="button button-danger"
            disabled={pending || reason.trim().length < 10}
            onClick={() => void revoke()}
            type="button"
          >
            {pending ? "Отзываем…" : "Подтвердить отзыв"}
          </button>
        </>
      ) : (
        <button
          className="button button-danger"
          onClick={() => {
            setIdempotencyKey(createIdempotencyKey());
            setConfirming(true);
          }}
          type="button"
        >
          Отозвать ручной доступ
        </button>
      )}
      {message ? (
        <p className="admin-command-feedback admin-command-feedback-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
