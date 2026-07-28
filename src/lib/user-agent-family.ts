const maximumFamilyLength = 80;

function safeFamily(value: string) {
  const normalized = value.trim().slice(0, maximumFamilyLength);

  return normalized && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : undefined;
}

export function normalizeUserAgentFamily(
  userAgent: string | null | undefined,
) {
  if (!userAgent) {
    return undefined;
  }

  if (/\bEdgA?\//u.test(userAgent)) {
    return "Microsoft Edge";
  }

  if (/\bOPR\//u.test(userAgent)) {
    return "Opera";
  }

  if (/\b(?:Chrome|CriOS)\//u.test(userAgent)) {
    return "Google Chrome";
  }

  if (/\b(?:Firefox|FxiOS)\//u.test(userAgent)) {
    return "Mozilla Firefox";
  }

  if (
    /\bSafari\//u.test(userAgent) &&
    /\bVersion\//u.test(userAgent)
  ) {
    return "Safari";
  }

  if (/\bTelegramBot\b/iu.test(userAgent)) {
    return "Telegram";
  }

  return safeFamily("Другой браузер");
}
