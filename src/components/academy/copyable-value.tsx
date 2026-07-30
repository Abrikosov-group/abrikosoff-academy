"use client";

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CopySimpleIcon } from "@phosphor-icons/react/dist/csr/CopySimple";
import {
  useEffect,
  useRef,
  useState,
} from "react";

type CopyState = "idle" | "copied" | "failed";

type CopyButtonProps = {
  actionText?: string;
  label: string;
  value: string;
  variant?: "icon" | "text";
};

export function CopyButton({
  actionText,
  label,
  value,
  variant = "icon",
}: CopyButtonProps) {
  const resetTimer = useRef<number | undefined>(undefined);
  const [copyState, setCopyState] =
    useState<CopyState>("idle");

  useEffect(
    () => () => {
      window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(
        () => setCopyState("idle"),
        2_000,
      );
    } catch {
      setCopyState("failed");
    }
  }

  const copied = copyState === "copied";
  const statusLabel = copied
    ? `${label} скопирован`
    : copyState === "failed"
      ? `Не удалось скопировать ${label}`
      : `Скопировать ${label} ${value}`;
  const visibleLabel = copied
    ? "Скопировано"
    : copyState === "failed"
      ? "Повторить"
      : actionText ?? `Скопировать ${label}`;

  return (
    <>
      <button
        aria-label={statusLabel}
        className={
          variant === "text"
            ? "admin-copy-action"
            : "admin-copy-button"
        }
        data-copy-state={copyState}
        onClick={copyValue}
        title={statusLabel}
        type="button"
      >
        {copied ? (
          <CheckIcon aria-hidden="true" size={16} weight="bold" />
        ) : (
          <CopySimpleIcon aria-hidden="true" size={16} />
        )}
        {variant === "text" ? <span>{visibleLabel}</span> : null}
      </button>
      <span
        aria-live="polite"
        className="visually-hidden"
        role="status"
      >
        {copyState === "idle" ? "" : statusLabel}
      </span>
    </>
  );
}

export function CopyableValue({
  badge,
  displayValue,
  label,
  value,
}: {
  badge?: string;
  displayValue?: string;
  label: string;
  value: string;
}) {
  return (
    <span className="admin-copyable-value">
      {badge ? (
        <span className="admin-copyable-badge">{badge}</span>
      ) : null}
      <code title={value}>{displayValue ?? value}</code>
      <CopyButton label={label} value={value} />
    </span>
  );
}
