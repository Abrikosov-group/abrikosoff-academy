export function normalizeUserAvatarUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) {
    return undefined;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function getAvatarUrlFromMetadata(
  metadata: Record<string, unknown>,
) {
  return normalizeUserAvatarUrl(metadata.photoUrl);
}

export function getUserInitials(displayName: string) {
  const initials = displayName
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((part): part is string => Boolean(part))
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("ru-RU");

  return initials || "А";
}
