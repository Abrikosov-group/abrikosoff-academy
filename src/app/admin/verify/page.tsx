import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTelegramVerificationButton } from "@/components/academy/admin-telegram-verification-button";
import { normalizeAdminRedirectPath } from "@/modules/administration/domain/admin-redirect";
import { getIdentityConfig } from "@/modules/identity/server/identity-config";
import {
  requireAdminVerificationStart,
} from "@/modules/administration/server/require-admin-context";

type AdminVerifyPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
  }>;
};

export default async function AdminVerifyPage({
  searchParams,
}: AdminVerifyPageProps) {
  const params = await searchParams;
  const redirectPath = normalizeAdminRedirectPath(params.next);
  const verification = await requireAdminVerificationStart(
    redirectPath,
  );

  if (verification.alreadyVerified) {
    redirect(redirectPath);
  }

  const telegramEnabled = Boolean(getIdentityConfig().telegram);

  return (
    <main className="auth-page">
      <Link className="back-link" href="/dashboard">
        Вернуться в личный кабинет
      </Link>
      <section
        className="auth-card"
        aria-labelledby="admin-verification-title"
      >
        <Link className="auth-logo" href="/" aria-label="На главную">
          <Image
            src="/brand/logo-mark.svg"
            alt=""
            width={72}
            height={72}
            priority
          />
        </Link>
        <p className="overline">Административный вход</p>
        <h1 id="admin-verification-title">
          Подтвердите вход
        </h1>
        <p className="auth-intro">
          Отдельное подтверждение защищает панель, даже если обычная
          сессия Академии осталась открытой.
        </p>
        {params.error ? (
          <p className="field-error auth-page-error" role="alert">
            Подтверждение не завершено. Попробуйте ещё раз.
          </p>
        ) : null}
        {telegramEnabled ? (
          <AdminTelegramVerificationButton
            redirectPath={redirectPath}
          />
        ) : (
          <p className="field-error" role="alert">
            Подтверждение через Telegram ещё не настроено.
          </p>
        )}
      </section>
    </main>
  );
}
