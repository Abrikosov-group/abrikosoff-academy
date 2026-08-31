import type { SubscriptionPlanId } from "@/modules/billing/domain/types";

export const adminAccessSources = ["paid", "manual", "grace"] as const;
export type AdminAccessSource = (typeof adminAccessSources)[number];
export const adminAccessStates = [
  "active",
  "scheduled",
  "expired",
  "revoked",
] as const;
export type AdminAccessState = (typeof adminAccessStates)[number];

export type AdminAccessListItem = {
  id: string;
  customerId: string;
  customerDisplayName: string;
  source: AdminAccessSource;
  state: AdminAccessState;
  periodStart: string;
  periodEnd: string;
  planId?: SubscriptionPlanId;
  grantReason?: string;
  grantedAt?: string;
  revokedAt?: string;
  revokeReason?: string;
  overlapsAnotherManualGrant: boolean;
  accessRemainsAfterRevoke: boolean;
  canRevoke: boolean;
};

export type AdminAccessCursor = {
  sortAt: string;
  source: AdminAccessSource;
  id: string;
};

export type AdminAccessListPage = {
  items: readonly AdminAccessListItem[];
  nextCursor?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function encodeAdminAccessCursor(cursor: AdminAccessCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeAdminAccessCursor(value: string | undefined) {
  if (!value || value.length > 500) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<AdminAccessCursor>;
    if (
      typeof parsed.sortAt !== "string" ||
      !adminAccessSources.includes(parsed.source as AdminAccessSource) ||
      typeof parsed.id !== "string" ||
      !uuidPattern.test(parsed.id)
    ) {
      return undefined;
    }
    const sortAt = new Date(parsed.sortAt);
    if (!Number.isFinite(sortAt.getTime())) return undefined;
    return {
      sortAt: sortAt.toISOString(),
      source: parsed.source as AdminAccessSource,
      id: parsed.id.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}
