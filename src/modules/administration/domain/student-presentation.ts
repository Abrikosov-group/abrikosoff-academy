import type { IdentityMethodType } from "@/modules/identity/domain/types";
import type {
  AdminStudentAccessState,
  AdminStudentIdentityMethod,
  AdminStudentPaidGrant,
  AdminStudentSession,
  AdminStudentStatus,
  AdminStudentTelegramProfile,
} from "./student-read-model";
import { telegramProfileMetadataVersion } from "@/modules/identity/domain/telegram-profile";

function compactIdentifier(value: string) {
  if (value.length <= 4) {
    return "••••";
  }

  return `${value.slice(0, 2)}…${value.slice(-2)}`;
}

function maskEmail(value: string) {
  const separator = value.lastIndexOf("@");

  if (separator <= 0 || separator === value.length - 1) {
    return compactIdentifier(value);
  }

  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);

  return `${local.slice(0, 1)}•••@${domain}`;
}

function maskPhone(value: string) {
  const visibleSuffix = value.replace(/\D/g, "").slice(-2);

  return visibleSuffix
    ? `••••••••${visibleSuffix}`
    : compactIdentifier(value);
}

export function formatIpAddress(address: string) {
  const version = address.includes(":") ? "IPv6" : "IPv4";
  const groups = address.split(":");
  const compact =
    version === "IPv6" &&
    address.length > 24 &&
    groups.length >= 6
      ? `${groups.slice(0, 3).join(":")}:…:${groups
          .slice(-2)
          .join(":")}`
      : address;

  return {
    compact,
    version,
  } as const;
}

export function maskIdentityIdentifier(
  type: IdentityMethodType,
  identifier: string,
) {
  switch (type) {
    case "email":
      return maskEmail(identifier);
    case "phone":
      return maskPhone(identifier);
    case "telegram":
      return compactIdentifier(identifier);
  }
}

export function formatPrimaryIdentityMethod(input: {
  type: IdentityMethodType | null;
  identifier?: string | null;
  telegramUsername?: string | null;
}) {
  if (!input.type || !input.identifier) {
    return "Способ входа не найден";
  }

  if (input.type === "telegram" && input.telegramUsername) {
    return `Telegram · @${compactIdentifier(
      input.telegramUsername.replace(/^@/, ""),
    )}`;
  }

  const labels: Record<IdentityMethodType, string> = {
    telegram: "Telegram",
    email: "Email",
    phone: "Телефон",
  };

  return `${labels[input.type]} · ${maskIdentityIdentifier(
    input.type,
    input.identifier,
  )}`;
}

export function deriveEffectivePaidAccess(
  grants: readonly Omit<
    AdminStudentPaidGrant,
    "effectiveNow"
  >[],
  at: Date,
) {
  const atTime = at.getTime();
  const granted = grants.filter(
    (grant) => grant.status === "granted",
  );
  const active = granted.filter(
    (grant) =>
      Date.parse(grant.periodStart) <= atTime &&
      Date.parse(grant.periodEnd) > atTime,
  );
  const scheduled = granted.filter(
    (grant) => Date.parse(grant.periodStart) > atTime,
  );
  const expired = granted.filter(
    (grant) => Date.parse(grant.periodEnd) <= atTime,
  );
  const maxDate = (
    items: readonly Omit<
      AdminStudentPaidGrant,
      "effectiveNow"
    >[],
    field: "periodEnd",
  ) =>
    items
      .map((item) => item[field])
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const minStart = scheduled
    .map((grant) => grant.periodStart)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  let continuousActiveUntil = maxDate(active, "periodEnd");

  while (continuousActiveUntil) {
    const currentEnd = Date.parse(continuousActiveUntil);
    const extendingGrant = granted
      .filter(
        (grant) =>
          Date.parse(grant.periodStart) <= currentEnd &&
          Date.parse(grant.periodEnd) > currentEnd,
      )
      .map((grant) => grant.periodEnd)
      .sort(
        (left, right) => Date.parse(right) - Date.parse(left),
      )[0];

    if (!extendingGrant) {
      break;
    }

    continuousActiveUntil = extendingGrant;
  }

  let state: AdminStudentAccessState = "none";

  if (active.length > 0) {
    state = "active";
  } else if (scheduled.length > 0) {
    state = "scheduled";
  } else if (expired.length > 0) {
    state = "expired";
  } else if (grants.length > 0) {
    state = "revoked";
  }

  return {
    summary: {
      state,
      activeUntil: continuousActiveUntil,
      scheduledFrom: minStart,
      mostRecentEnd: maxDate(expired, "periodEnd"),
    },
    grants: grants.map((grant) => ({
      ...grant,
      effectiveNow:
        grant.status === "granted" &&
        Date.parse(grant.periodStart) <= atTime &&
        Date.parse(grant.periodEnd) > atTime,
    })),
  };
}

export function adminStudentStatusLabel(
  status: AdminStudentStatus,
) {
  return {
    active: "Активен",
    blocked: "Заблокирован",
    deleted: "Удалён",
  }[status];
}

export function adminAccessStateLabel(
  state: AdminStudentAccessState,
) {
  return {
    active: "Доступ активен",
    scheduled: "Ожидает начала",
    expired: "Доступ завершён",
    revoked: "Доступ отозван",
    none: "Доступа нет",
  }[state];
}

export function identityMethodLabel(type: IdentityMethodType) {
  return {
    telegram: "Telegram",
    email: "Email",
    phone: "Телефон",
  }[type];
}

export function formatAdminDateTime(
  value: string,
  timeZone: string,
) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatAdminDate(
  value: string,
  timeZone: string,
) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

export function formatAdminCompactDateTime(
  value: string,
  timeZone: string,
) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function formatRussianCount(
  count: number,
  forms: readonly [string, string, string],
) {
  const absolute = Math.abs(count);
  const lastTwoDigits = absolute % 100;
  const lastDigit = absolute % 10;
  const form =
    lastTwoDigits >= 11 && lastTwoDigits <= 14
      ? forms[2]
      : lastDigit === 1
        ? forms[0]
        : lastDigit >= 2 && lastDigit <= 4
          ? forms[1]
          : forms[2];

  return `${count} ${form}`;
}

export function sortAdminStudentSessions(
  sessions: readonly AdminStudentSession[],
) {
  const statePriority: Record<AdminStudentSession["state"], number> =
    {
      active: 0,
      expired: 1,
      revoked: 2,
    };

  return [...sessions].sort((left, right) => {
    const stateDifference =
      statePriority[left.state] - statePriority[right.state];

    if (stateDifference !== 0) {
      return stateDifference;
    }

    const lastSeenDifference =
      Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);

    return lastSeenDifference !== 0
      ? lastSeenDifference
      : Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export function selectPrimaryTelegramMethod(
  methods: readonly AdminStudentIdentityMethod[],
) {
  return methods
    .filter(
      (
        method,
      ): method is AdminStudentIdentityMethod & {
        telegramProfile: NonNullable<
          AdminStudentIdentityMethod["telegramProfile"]
        >;
      } => Boolean(method.telegramProfile),
    )
    .sort(
      (left, right) =>
        Date.parse(right.verifiedAt) -
        Date.parse(left.verifiedAt),
    )[0];
}

export function hasLegacyTelegramProfileMetadata(
  profile: AdminStudentTelegramProfile,
) {
  return (
    profile.metadataVersion !== telegramProfileMetadataVersion
  );
}

export function formatStudentSummaryIdentity(
  methods: readonly AdminStudentIdentityMethod[],
) {
  const telegramMethod = methods
    .filter(
      (method) =>
        method.type === "telegram" &&
        Boolean(method.telegramUsername),
    )
    .sort(
      (left, right) =>
        Date.parse(right.verifiedAt) -
        Date.parse(left.verifiedAt),
    )[0];

  if (telegramMethod?.telegramUsername) {
    return `@${telegramMethod.telegramUsername.replace(/^@/, "")}`;
  }

  const latestMethod = [...methods].sort(
    (left, right) =>
      Date.parse(right.verifiedAt) -
      Date.parse(left.verifiedAt),
  )[0];

  return latestMethod
    ? `${identityMethodLabel(latestMethod.type)} · ${latestMethod.maskedIdentifier}`
    : "Способы входа не подключены";
}

export function hasNoSessionTechnicalContext(
  session: AdminStudentSession,
) {
  return ![
    session.authenticationMethod,
    session.userAgentFamily,
    session.browserVersion,
    session.operatingSystem,
    session.operatingSystemVersion,
    session.deviceType,
    session.deviceVendor,
    session.deviceModel,
    session.architecture,
    session.bitness,
    session.ipAddress,
    session.countryCode,
    session.region,
    session.regionCode,
    session.city,
    session.timezone,
    session.preferredLanguage,
    session.rawUserAgent,
    session.cloudflareRayId,
  ].some(Boolean);
}

export function normalizeTelegramUsername(
  username: string | undefined,
) {
  if (!username) {
    return undefined;
  }

  const normalized = username.replace(/^@/, "");

  return /^[A-Za-z0-9_]{5,32}$/.test(normalized)
    ? normalized
    : undefined;
}

export function telegramProfileUrl(
  username: string | undefined,
) {
  const normalized = normalizeTelegramUsername(username);

  return normalized
    ? `https://t.me/${normalized}`
    : undefined;
}

export function normalizeAdminStudentsReturnTo(
  value: string | string[] | undefined,
) {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !candidate.startsWith("/")) {
    return "/admin/students";
  }

  try {
    const parsed = new URL(candidate, "https://academy.invalid");

    return parsed.origin === "https://academy.invalid" &&
      parsed.pathname === "/admin/students" &&
      !parsed.hash
      ? `${parsed.pathname}${parsed.search}`
      : "/admin/students";
  } catch {
    return "/admin/students";
  }
}
