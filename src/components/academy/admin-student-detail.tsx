import { CopyableIpAddress } from "@/components/academy/copyable-ip-address";
import { AdminRevokeSessionsDialog } from "@/components/academy/admin-revoke-sessions-dialog";
import {
  CopyButton,
  CopyableValue,
} from "@/components/academy/copyable-value";
import { UserAvatar } from "@/components/academy/user-avatar";
import {
  adminAccessStateLabel,
  adminStudentStatusLabel,
  formatAdminCompactDateTime,
  formatAdminDate,
  formatAdminDateTime,
  formatIpAddress,
  formatRussianCount,
  formatStudentSummaryIdentity,
  hasLegacyTelegramProfileMetadata,
  hasNoSessionTechnicalContext,
  identityMethodLabel,
  selectPrimaryTelegramMethod,
  sortAdminStudentSessions,
  telegramProfileUrl,
} from "@/modules/administration/domain/student-presentation";
import type {
  AdminStudentAccessState,
  AdminStudentDetail,
  AdminStudentSession,
  AdminStudentStatus,
} from "@/modules/administration/domain/student-read-model";
import { getUserInitials } from "@/modules/identity/domain/user-presentation";

const paymentCountForms = [
  "платёж",
  "платежа",
  "платежей",
] as const;
const methodCountForms = [
  "способ входа",
  "способа входа",
  "способов входа",
] as const;
const sessionCountForms = [
  "сессия",
  "сессии",
  "сессий",
] as const;
const sourceCountForms = [
  "источник",
  "источника",
  "источников",
] as const;
const profileCountForms = [
  "профиль",
  "профиля",
  "профилей",
] as const;

function statusBadgeClass(status: AdminStudentStatus) {
  return status === "active"
    ? "badge-success"
    : status === "blocked"
      ? "badge-error"
      : "badge-neutral";
}

function accessBadgeClass(state: AdminStudentAccessState) {
  return state === "active"
    ? "badge-success"
    : state === "scheduled"
      ? "badge-warning"
      : state === "revoked"
        ? "badge-error"
        : "badge-neutral";
}

function planLabel(plan: "monthly" | "annual") {
  return plan === "monthly" ? "Месячный" : "Годовой";
}

function authenticationMethodLabel(
  method: AdminStudentSession["authenticationMethod"],
) {
  if (!method) return "Способ входа не сохранён";

  return {
    telegram_oidc: "Telegram",
    email_magic_link: "Email",
    demo: "Демонстрационный вход",
  }[method];
}

function deviceTypeLabel(
  type: AdminStudentSession["deviceType"],
) {
  if (!type) return undefined;

  return {
    desktop: "Компьютер",
    mobile: "Смартфон",
    tablet: "Планшет",
    bot: "Бот",
    other: "Другое устройство",
  }[type];
}

function joinTechnicalParts(
  parts: readonly (string | undefined)[],
  fallback = "Не сохранено",
) {
  const known = [
    ...new Set(
      parts.filter((part): part is string => Boolean(part)),
    ),
  ];

  return known.length > 0 ? known.join(" · ") : fallback;
}

function sessionDeviceSummary(session: AdminStudentSession) {
  const deviceName =
    session.deviceVendor || session.deviceModel
      ? [session.deviceVendor, session.deviceModel]
          .filter(Boolean)
          .join(" ")
      : deviceTypeLabel(session.deviceType);

  return joinTechnicalParts([
    session.userAgentFamily,
    session.browserVersion,
    session.operatingSystem,
    session.operatingSystemVersion,
    deviceName,
  ]);
}

function countryLabel(countryCode?: string) {
  if (!countryCode) return undefined;

  try {
    return (
      new Intl.DisplayNames(["ru"], { type: "region" }).of(
        countryCode,
      ) ?? countryCode
    );
  } catch {
    return countryCode;
  }
}

function sessionStatus(session: AdminStudentSession) {
  return {
    active: { label: "Активна", className: "badge-success" },
    expired: { label: "Истекла", className: "badge-neutral" },
    revoked: { label: "Отозвана", className: "badge-error" },
  }[session.state];
}

function latestCreatedSession(
  sessions: readonly AdminStudentSession[],
) {
  return sessions.reduce<AdminStudentSession | undefined>(
    (latest, session) =>
      !latest ||
      Date.parse(session.createdAt) >
        Date.parse(latest.createdAt)
        ? session
        : latest,
    undefined,
  );
}

export function AdminStudentSummary({
  displayTimeZone,
  student,
}: {
  displayTimeZone: string;
  student: AdminStudentDetail;
}) {
  const primaryTelegramMethod = selectPrimaryTelegramMethod(
    student.methods,
  );
  const telegramProfile = primaryTelegramMethod?.telegramProfile;
  const telegramUrl = telegramProfileUrl(
    telegramProfile?.username,
  );
  const latestSession = latestCreatedSession(student.sessions);

  return (
    <section
      aria-labelledby="student-summary-heading"
      className="admin-student-summary"
    >
      <div className="admin-student-summary-identity">
        <span className="admin-student-summary-avatar">
          <UserAvatar
            avatarUrl={telegramProfile?.photoUrl}
            initials={getUserInitials(student.displayName)}
          />
        </span>
        <div className="admin-student-summary-name">
          <p className="overline">Карточка ученика</p>
          <h1 id="student-summary-heading">
            {student.displayName}
          </h1>
          <p>{formatStudentSummaryIdentity(student.methods)}</p>
        </div>
        <div
          aria-label="Состояние ученика"
          className="admin-student-summary-badges"
        >
          <span
            className={`badge ${statusBadgeClass(student.status)}`}
          >
            {adminStudentStatusLabel(student.status)}
          </span>
          <span
            className={`badge ${accessBadgeClass(
              student.effectiveAccess.state,
            )}`}
          >
            {adminAccessStateLabel(
              student.effectiveAccess.state,
            )}
          </span>
        </div>
      </div>

      <dl className="admin-student-summary-facts">
        <div>
          <dt>Зарегистрирован</dt>
          <dd>
            <time dateTime={student.createdAt}>
              {formatAdminDate(
                student.createdAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt>Последняя сессия создана</dt>
          <dd>
            {latestSession ? (
              <time dateTime={latestSession.createdAt}>
                {formatAdminDateTime(
                  latestSession.createdAt,
                  displayTimeZone,
                )}
              </time>
            ) : (
              "Сессий нет"
            )}
          </dd>
        </div>
        {student.billingContextVisible ? (
          <div>
            <dt>Платежи</dt>
            <dd>
              {formatRussianCount(
                student.paymentCount ?? 0,
                paymentCountForms,
              )}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Вход</dt>
          <dd>
            {formatRussianCount(
              student.methods.length,
              methodCountForms,
            )}
          </dd>
        </div>
      </dl>

      <div
        aria-label="Быстрые действия"
        className="admin-student-summary-actions"
      >
        {telegramUrl ? (
          <a
            className="admin-student-external-action"
            href={telegramUrl}
            rel="noreferrer"
            target="_blank"
          >
            Открыть Telegram
          </a>
        ) : null}
        {telegramProfile?.userId ? (
          <CopyButton
            actionText="Скопировать Telegram ID"
            label="Telegram ID"
            value={telegramProfile.userId}
            variant="text"
          />
        ) : null}
        <CopyButton
          actionText="Скопировать UUID"
          label="UUID"
          value={student.id}
          variant="text"
        />
      </div>
    </section>
  );
}

export function AdminStudentOverview({
  displayTimeZone,
  student,
}: {
  displayTimeZone: string;
  student: AdminStudentDetail;
}) {
  return (
    <section
      aria-labelledby="student-overview-heading"
      className="admin-detail-section admin-student-overview"
      id="overview"
    >
      <div className="admin-section-title">
        <h2 id="student-overview-heading">Обзор</h2>
      </div>
      <dl className="admin-detail-grid admin-overview-grid">
        <div>
          <dt>Внутренний UUID</dt>
          <dd>
            <CopyableValue
              label="UUID"
              value={student.id}
            />
          </dd>
        </div>
        <div>
          <dt>Дата и время регистрации</dt>
          <dd>
            <time dateTime={student.createdAt}>
              {formatAdminDateTime(
                student.createdAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
        {student.paymentContextVisible ? (
          <div>
            <dt>Email для чека</dt>
            <dd>{student.receiptEmail ?? "Не указан"}</dd>
          </div>
        ) : null}
        <div>
          <dt>Сессии</dt>
          <dd>
            {formatRussianCount(
              student.sessionCount,
              sessionCountForms,
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function AdminStudentAccessSection({
  displayTimeZone,
  student,
}: {
  displayTimeZone: string;
  student: AdminStudentDetail;
}) {
  const accessState = student.effectiveAccess.state;

  return (
    <section
      aria-labelledby="student-access-heading"
      className="admin-detail-section"
      id="access-payments"
    >
      <div className="admin-section-title">
        <div>
          <h2 id="student-access-heading">
            {student.billingContextVisible
              ? "Доступ и оплаты"
              : "Доступ"}
          </h2>
          <p>
            {formatRussianCount(
              student.paidGrants.length,
              sourceCountForms,
            )}{" "}
            доступа
            {student.billingContextVisible
              ? ` · ${formatRussianCount(
                  student.paymentCount ?? 0,
                  paymentCountForms,
                )}`
              : null}
          </p>
        </div>
        <span
          className={`badge ${accessBadgeClass(accessState)}`}
        >
          {adminAccessStateLabel(accessState)}
        </span>
      </div>

      <div className="admin-access-summary admin-access-summary-compact">
        <div>
          <span>Эффективное состояние</span>
          {student.effectiveAccess.activeUntil ? (
            <strong>
              Активен до{" "}
              {formatAdminDateTime(
                student.effectiveAccess.activeUntil,
                displayTimeZone,
              )}
            </strong>
          ) : student.effectiveAccess.scheduledFrom ? (
            <strong>
              Начнётся{" "}
              {formatAdminDateTime(
                student.effectiveAccess.scheduledFrom,
                displayTimeZone,
              )}
            </strong>
          ) : student.effectiveAccess.mostRecentEnd ? (
            <strong>
              Последний период завершился{" "}
              {formatAdminDateTime(
                student.effectiveAccess.mostRecentEnd,
                displayTimeZone,
              )}
            </strong>
          ) : (
            <strong>Периодов доступа нет</strong>
          )}
        </div>
        <p>
          Сейчас учитываются только оплаченные периоды. Ручные
          доступы ещё не подключены.
        </p>
      </div>

      {student.paidGrants.length === 0 ? (
        <div className="admin-empty-state admin-empty-state-compact">
          <h3>Оплаченных периодов нет</h3>
          <p>Источники доступа для этого ученика не найдены.</p>
        </div>
      ) : (
        <div className="admin-table-scroll admin-responsive-table-wrap">
          <table className="admin-data-table admin-responsive-table">
            <thead>
              <tr>
                <th scope="col">Источник</th>
                <th scope="col">Тариф</th>
                <th scope="col">Период</th>
                <th scope="col">Состояние</th>
                {student.billingContextVisible ? (
                  <th scope="col">Заказ</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {student.paidGrants.map((grant) => (
                <tr
                  key={[
                    grant.planId,
                    grant.periodStart,
                    grant.grantedAt,
                  ].join(":")}
                >
                  <td data-label="Источник">Оплата</td>
                  <td data-label="Тариф">
                    {planLabel(grant.planId)}
                  </td>
                  <td data-label="Период">
                    <time dateTime={grant.periodStart}>
                      {formatAdminDateTime(
                        grant.periodStart,
                        displayTimeZone,
                      )}
                    </time>
                    <span className="admin-table-separator">
                      —
                    </span>
                    <time dateTime={grant.periodEnd}>
                      {formatAdminDateTime(
                        grant.periodEnd,
                        displayTimeZone,
                      )}
                    </time>
                  </td>
                  <td data-label="Состояние">
                    <span
                      className={`badge ${
                        grant.effectiveNow
                          ? "badge-success"
                          : grant.status === "revoked"
                            ? "badge-error"
                            : "badge-neutral"
                      }`}
                    >
                      {grant.effectiveNow
                        ? "Действует"
                        : grant.status === "revoked"
                          ? "Отозван"
                          : "Не действует"}
                    </span>
                  </td>
                  {student.billingContextVisible &&
                  grant.orderId ? (
                    <td data-label="Заказ">
                      <CopyableValue
                        displayValue={`${grant.orderId.slice(
                          0,
                          8,
                        )}…`}
                        label="ID заказа"
                        value={grant.orderId}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TelegramProfileCard({
  displayTimeZone,
  method,
}: {
  displayTimeZone: string;
  method: NonNullable<
    ReturnType<typeof selectPrimaryTelegramMethod>
  >;
}) {
  const profile = method.telegramProfile;
  const url = telegramProfileUrl(profile.username);
  const hasLegacyFields =
    hasLegacyTelegramProfileMetadata(profile);

  return (
    <article className="admin-telegram-card">
      <div className="admin-telegram-compact-heading">
        <div>
          <span>Telegram OpenID Connect</span>
          <h4>
            {profile.username
              ? `@${profile.username}`
              : "Username не передан"}
          </h4>
        </div>
        <span className="badge badge-success">Проверен</span>
      </div>

      <dl className="admin-telegram-summary">
        <div>
          <dt>Telegram ID</dt>
          <dd>
            {profile.userId ? (
              <CopyableValue
                label="Telegram ID"
                value={profile.userId}
              />
            ) : (
              "Не передан"
            )}
          </dd>
        </div>
        <div>
          <dt>Подтверждён</dt>
          <dd>
            <time dateTime={method.verifiedAt}>
              {formatAdminDateTime(
                method.verifiedAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt>Разрешения</dt>
          <dd className="admin-scope-list">
            {profile.requestedScopes.length > 0
              ? profile.requestedScopes.map((scope) => (
                  <code key={scope}>{scope}</code>
                ))
              : "Не сохранены ранее"}
          </dd>
        </div>
        <div>
          <dt>Изображение профиля</dt>
          <dd>
            {profile.photoUrl ? "Получено" : "Не передано"}
          </dd>
        </div>
      </dl>

      <div className="admin-telegram-actions">
        {url ? (
          <a href={url} rel="noreferrer" target="_blank">
            Открыть Telegram
          </a>
        ) : null}
      </div>

      <details className="admin-telegram-more">
        <summary>Технические данные OpenID Connect</summary>
        {hasLegacyFields ? (
          <p className="admin-legacy-note">
            Этот способ входа был сохранён до введения текущей
            версии Telegram-метаданных. При следующем успешном
            входе доступные поля будут сохранены в новом формате.
          </p>
        ) : null}
        <dl className="admin-detail-grid admin-telegram-details-grid">
          <div>
            <dt>OIDC subject</dt>
            <dd>
              <CopyableValue
                label="OIDC subject"
                value={profile.subject}
              />
            </dd>
          </div>
          {profile.firstName ? (
            <div>
              <dt>Имя</dt>
              <dd>{profile.firstName}</dd>
            </div>
          ) : null}
          {profile.lastName ? (
            <div>
              <dt>Фамилия</dt>
              <dd>{profile.lastName}</dd>
            </div>
          ) : null}
          {profile.profileName ? (
            <div>
              <dt>Полное имя профиля</dt>
              <dd>{profile.profileName}</dd>
            </div>
          ) : null}
          {profile.username ? (
            <div>
              <dt>Username</dt>
              <dd>@{profile.username}</dd>
            </div>
          ) : null}
          {profile.tokenIssuedAt ? (
            <div>
              <dt>ID-токен выдан</dt>
              <dd>
                <time dateTime={profile.tokenIssuedAt}>
                  {formatAdminDateTime(
                    profile.tokenIssuedAt,
                    displayTimeZone,
                  )}
                </time>
              </dd>
            </div>
          ) : null}
          {profile.tokenExpiresAt ? (
            <div>
              <dt>ID-токен был действителен до</dt>
              <dd>
                <time dateTime={profile.tokenExpiresAt}>
                  {formatAdminDateTime(
                    profile.tokenExpiresAt,
                    displayTimeZone,
                  )}
                </time>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Проверка подлинности</dt>
            <dd>
              Подпись, issuer, audience, nonce и срок действия
              проверены
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

export function AdminStudentIdentitySection({
  displayTimeZone,
  student,
}: {
  displayTimeZone: string;
  student: AdminStudentDetail;
}) {
  const telegramMethods = student.methods.filter(
    (
      method,
    ): method is NonNullable<
      ReturnType<typeof selectPrimaryTelegramMethod>
    > => Boolean(method.telegramProfile),
  );

  return (
    <section
      aria-labelledby="student-identity-heading"
      className="admin-detail-section"
      id="identity-security"
    >
      <div className="admin-section-title">
        <div>
          <h2 id="student-identity-heading">
            Вход и безопасность
          </h2>
          <p>
            {formatRussianCount(
              student.methods.length,
              methodCountForms,
            )}
          </p>
        </div>
      </div>

      {student.methods.length === 0 ? (
        <div className="admin-empty-state admin-empty-state-compact">
          <h3>Способы входа не найдены</h3>
        </div>
      ) : (
        <div className="admin-table-scroll admin-responsive-table-wrap">
          <table className="admin-data-table admin-responsive-table">
            <thead>
              <tr>
                <th scope="col">Тип</th>
                <th scope="col">Идентификатор</th>
                <th scope="col">Безопасные данные</th>
                <th scope="col">Подтверждён</th>
              </tr>
            </thead>
            <tbody>
              {student.methods.map((method) => (
                <tr key={method.id}>
                  <td data-label="Тип">
                    {identityMethodLabel(method.type)}
                  </td>
                  <td data-label="Идентификатор">
                    {method.maskedIdentifier}
                  </td>
                  <td data-label="Безопасные данные">
                    {method.telegramUsername
                      ? `@${method.telegramUsername}`
                      : "—"}
                  </td>
                  <td data-label="Подтверждён">
                    <time dateTime={method.verifiedAt}>
                      {formatAdminDateTime(
                        method.verifiedAt,
                        displayTimeZone,
                      )}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {telegramMethods.length > 0 ? (
        <div className="admin-telegram-profiles">
          <div className="admin-subsection-title">
            <h3>Проверенные данные Telegram</h3>
            <span>
              {formatRussianCount(
                telegramMethods.length,
                profileCountForms,
              )}
            </span>
          </div>
          <p className="admin-section-note">
            Показаны только проверенные поля OpenID Connect.
            Токены, nonce, коды авторизации и секреты не
            сохраняются.
          </p>
          <div className="admin-telegram-list">
            {telegramMethods.map((method) => (
              <TelegramProfileCard
                displayTimeZone={displayTimeZone}
                key={method.id}
                method={method}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SessionTechnicalDetails({
  displayTimeZone,
  session,
}: {
  displayTimeZone: string;
  session: AdminStudentSession;
}) {
  const ipAddress = session.ipAddress
    ? formatIpAddress(session.ipAddress)
    : undefined;
  const location = joinTechnicalParts(
    [
      countryLabel(session.countryCode),
      session.region,
      session.regionCode,
      session.city,
    ],
    "",
  );

  return (
    <>
      {hasNoSessionTechnicalContext(session) ? (
        <p className="admin-legacy-note">
          Технические данные для этой сессии не сохранены или уже
          удалены по сроку хранения.
        </p>
      ) : null}
      <dl className="admin-detail-grid admin-session-details-grid">
        <div>
          <dt>UUID сессии</dt>
          <dd>
            <CopyableValue
              label="UUID сессии"
              value={session.id}
            />
          </dd>
        </div>
        <div>
          <dt>Создана</dt>
          <dd>
            <time dateTime={session.createdAt}>
              {formatAdminDateTime(
                session.createdAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt>Истекает</dt>
          <dd>
            <time dateTime={session.expiresAt}>
              {formatAdminDateTime(
                session.expiresAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
        {session.revokedAt ? (
          <div>
            <dt>Отозвана</dt>
            <dd>
              <time dateTime={session.revokedAt}>
                {formatAdminDateTime(
                  session.revokedAt,
                  displayTimeZone,
                )}
              </time>
            </dd>
          </div>
        ) : null}
        {session.ipAddress && ipAddress ? (
          <div>
            <dt>Полный IP-адрес</dt>
            <dd>
              <CopyableIpAddress
                address={session.ipAddress}
                compactAddress={session.ipAddress}
                version={ipAddress.version}
              />
            </dd>
          </div>
        ) : null}
        {location ? (
          <div>
            <dt>Страна, регион и город</dt>
            <dd>{location}</dd>
          </div>
        ) : null}
        {session.timezone ? (
          <div>
            <dt>Часовой пояс сети</dt>
            <dd>{session.timezone}</dd>
          </div>
        ) : null}
        {session.userAgentFamily ? (
          <div>
            <dt>Браузер</dt>
            <dd>
              {joinTechnicalParts([
                session.userAgentFamily,
                session.browserVersion,
              ])}
            </dd>
          </div>
        ) : null}
        {session.operatingSystem ? (
          <div>
            <dt>Операционная система</dt>
            <dd>
              {joinTechnicalParts([
                session.operatingSystem,
                session.operatingSystemVersion,
              ])}
            </dd>
          </div>
        ) : null}
        {session.deviceType ||
        session.deviceVendor ||
        session.deviceModel ? (
          <div>
            <dt>Устройство</dt>
            <dd>
              {joinTechnicalParts([
                deviceTypeLabel(session.deviceType),
                session.deviceVendor,
                session.deviceModel,
              ])}
            </dd>
          </div>
        ) : null}
        {session.architecture || session.bitness ? (
          <div>
            <dt>Архитектура и разрядность</dt>
            <dd>
              {joinTechnicalParts([
                session.architecture,
                session.bitness
                  ? `${session.bitness} бит`
                  : undefined,
              ])}
            </dd>
          </div>
        ) : null}
        {session.preferredLanguage ? (
          <div>
            <dt>Язык браузера</dt>
            <dd>{session.preferredLanguage}</dd>
          </div>
        ) : null}
        {session.cloudflareRayId ? (
          <div>
            <dt>Cloudflare Ray ID</dt>
            <dd>
              <CopyableValue
                label="Cloudflare Ray ID"
                value={session.cloudflareRayId}
              />
            </dd>
          </div>
        ) : null}
      </dl>
      {session.rawUserAgent ? (
        <div className="admin-session-user-agent">
          <span>Полный User-Agent</span>
          <code>{session.rawUserAgent}</code>
        </div>
      ) : null}
    </>
  );
}

function AdminStudentSessionCard({
  displayTimeZone,
  session,
}: {
  displayTimeZone: string;
  session: AdminStudentSession;
}) {
  const status = sessionStatus(session);
  const ipAddress = session.ipAddress
    ? formatIpAddress(session.ipAddress)
    : undefined;

  return (
    <article className="admin-session-card">
      <div className="admin-session-compact-heading">
        <div>
          <span
            className={`badge ${status.className}`}
          >
            {status.label}
          </span>
          <strong>
            {authenticationMethodLabel(
              session.authenticationMethod,
            )}
          </strong>
        </div>
        <span className="admin-session-device">
          {sessionDeviceSummary(session)}
        </span>
      </div>

      <dl className="admin-session-summary admin-session-summary-compact">
        <div>
          <dt>Сеть</dt>
          <dd>
            {session.ipAddress && ipAddress ? (
              <CopyableIpAddress
                address={session.ipAddress}
                compactAddress={ipAddress.compact}
                version={ipAddress.version}
              />
            ) : (
              "IP не сохранён"
            )}
            <small>
              {joinTechnicalParts([
                countryLabel(session.countryCode),
                session.region,
                session.regionCode,
                session.city,
              ])}
            </small>
          </dd>
        </div>
        <div>
          <dt>Сессия создана</dt>
          <dd>
            <time dateTime={session.createdAt}>
              {formatAdminCompactDateTime(
                session.createdAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt>Истекает</dt>
          <dd>
            <time dateTime={session.expiresAt}>
              {formatAdminCompactDateTime(
                session.expiresAt,
                displayTimeZone,
              )}
            </time>
          </dd>
        </div>
      </dl>

      <details className="admin-session-more">
        <summary>Технические данные</summary>
        <SessionTechnicalDetails
          displayTimeZone={displayTimeZone}
          session={session}
        />
      </details>
    </article>
  );
}

export function AdminStudentSessionList({
  canRevokeSessions,
  displayTimeZone,
  isCurrentActor,
  student,
}: {
  canRevokeSessions: boolean;
  displayTimeZone: string;
  isCurrentActor: boolean;
  student: AdminStudentDetail;
}) {
  const sortedSessions = sortAdminStudentSessions(
    student.sessions,
  );
  const visibleSessions = sortedSessions.slice(0, 5);
  const additionalSessions = sortedSessions.slice(5);

  return (
    <section
      aria-labelledby="student-sessions-heading"
      className="admin-detail-section"
      id="sessions"
    >
      <div className="admin-section-title">
        <div>
          <h2 id="student-sessions-heading">Сессии</h2>
          <p>
            {formatRussianCount(
              student.sessionCount,
              sessionCountForms,
            )}
          </p>
        </div>
        {canRevokeSessions ? (
          <AdminRevokeSessionsDialog
            activeSessionCount={student.activeSessionCount}
            isCurrentActor={isCurrentActor}
            studentDisplayName={student.displayName}
            studentId={student.id}
          />
        ) : null}
      </div>
      <p className="admin-section-note">
        Обновление активности пока не подключено, поэтому показано
        время создания сессии. Технические сведения фиксируются при
        новом входе, токены не отображаются.
        {student.sessionsTruncated
          ? " Показаны последние 100 сессий."
          : ""}
      </p>

      {sortedSessions.length === 0 ? (
        <div className="admin-empty-state admin-empty-state-compact">
          <h3>Сессий нет</h3>
        </div>
      ) : (
        <>
          <div className="admin-session-list">
            {visibleSessions.map((session) => (
              <AdminStudentSessionCard
                displayTimeZone={displayTimeZone}
                key={session.id}
                session={session}
              />
            ))}
          </div>
          {additionalSessions.length > 0 ? (
            <details className="admin-session-overflow">
              <summary>
                Показать ещё{" "}
                {formatRussianCount(
                  additionalSessions.length,
                  sessionCountForms,
                )}
              </summary>
              <div className="admin-session-list">
                {additionalSessions.map((session) => (
                  <AdminStudentSessionCard
                    displayTimeZone={displayTimeZone}
                    key={session.id}
                    session={session}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
