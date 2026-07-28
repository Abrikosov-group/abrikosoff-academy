import Link from "next/link";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";

export function LessonCompleteButton() {
  return (
    <div className="lesson-complete">
      <Link
        className="button button-primary"
        href="/dashboard"
      >
        <CheckCircleIcon
          aria-hidden="true"
          size={21}
          weight="regular"
        />
        Вернуться в кабинет
      </Link>
    </div>
  );
}
