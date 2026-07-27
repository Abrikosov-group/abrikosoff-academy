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
        {completed ? "Урок завершён" : "Отметить урок как пройденный"}
      </button>
      {completed ? (
        <p role="status">
          Отличное начало. Следующий урок откроется в полной версии курса.
        </p>
      ) : null}
    </div>
  );
}
