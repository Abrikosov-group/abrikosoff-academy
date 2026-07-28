import type { Metadata } from "next";
import Link from "next/link";
import type { IdentityMethodType } from "@/modules/identity/domain/types";
import { getCabinetContext } from "../_lib/cabinet-context";

export const metadata: Metadata = {
  title: "Профиль и вход",
  description: "Данные профиля и способ входа в Академию.",
};

const methodLabels: Record<IdentityMethodType, string> = {
  email: "Почта",
  phone: "Телефон",
  telegram: "Telegram",
};

function getMethodValue(
  type: IdentityMethodType,
  identifier: string,
  metadata: Record<string, unknown>,
) {
  if (type === "telegram") {
    const username = metadata.username;

    return typeof username === "string" && username
      ? `@${username.replace(/^@/, "")}`
      : "Telegram подключён";
  }

  return identifier;
}

export default async function CabinetProfilePage() {
  const { user } = await getCabinetContext();
  const method = user.primaryMethod;

  return (
    <>
      <header className="cabinet-section-heading">
        <p className="overline">Учётная запись</p>
        <h1>Профиль и вход</h1>
        <p>
          Основные данные аккаунта и подключённый способ входа.
        </p>
      </header>

      <div className="cabinet-profile-grid">
        <section
          className="cabinet-profile-card"
          aria-labelledby="profile-data-title"
        >
          <h2 id="profile-data-title">Профиль</h2>
          <dl>
            <div>
              <dt>Имя</dt>
              <dd>{user.displayName}</dd>
            </div>
            <div>
              <dt>Почта для чеков</dt>
              <dd>{user.receiptEmail ?? "Не указана"}</dd>
            </div>
          </dl>
        </section>

        <section
          className="cabinet-profile-card"
          aria-labelledby="login-method-title"
        >
          <h2 id="login-method-title">Способ входа</h2>
          <dl>
            <div>
              <dt>{methodLabels[method.type]}</dt>
              <dd>
                {getMethodValue(
                  method.type,
                  method.identifier,
                  method.metadata,
                )}
              </dd>
            </div>
          </dl>
          <p>
            Пароль не нужен: подтверждение происходит через
            подключённый способ входа.
          </p>
        </section>
      </div>

      <section
        className="cabinet-account-actions"
        aria-labelledby="account-actions-title"
      >
        <div>
          <h2 id="account-actions-title">Управление аккаунтом</h2>
          <p>
            После выхода для возвращения в кабинет потребуется снова
            подтвердить вход.
          </p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="button button-secondary" type="submit">
            Выйти из аккаунта
          </button>
        </form>
      </section>

      <p className="cabinet-profile-legal">
        Как Академия использует данные, описано в{" "}
        <Link href="/privacy">политике конфиденциальности</Link>.
      </p>
    </>
  );
}
