"use client";

import { CheckCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

export function LessonCompleteButton() {
  const [completed, setCompleted] = useState(false);

  return (
    <div className="lesson-complete">
      <button
        className={
          completed
            ? "button button-success"
            : "button button-primary"
        }
        type="button"
        onClick={() => setCompleted(true)}
      >
        <CheckCircleIcon
          aria-hidden="true"
          size={21}
          weight={completed ? "fill" : "regular"}
        />
        {completed ? "Урок прочитан" : "Урок прочитан — дальше"}
      </button>
      {completed ? (
        <p role="status">
          Готово. Прогресс курса обновлён.
        </p>
      ) : null}
    </div>
  );
}
