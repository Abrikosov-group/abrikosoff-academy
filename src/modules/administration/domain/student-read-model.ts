import type {
  IdentityMethodType,
  SessionAuthenticationMethod,
  SessionDeviceType,
} from "@/modules/identity/domain/types";
import type { SubscriptionPlanId } from "@/modules/billing/domain/types";

export const adminStudentStatuses = [
  "active",
  "blocked",
  "deleted",
] as const;

export type AdminStudentStatus =
  (typeof adminStudentStatuses)[number];

export const adminStudentAccessStates = [
  "active",
  "scheduled",
  "expired",
  "revoked",
  "none",
] as const;

export type AdminStudentAccessState =
  (typeof adminStudentAccessStates)[number];

export type AdminStudentAccessFilter =
  | "active"
  | "scheduled"
  | "expired"
  | "revoked"
  | "none";

export type AdminStudentAccessSource = "paid";

export type AdminStudentCursor = {
  createdAt: string;
  id: string;
};

export type AdminStudentListFilters = {
  query: string;
  status?: AdminStudentStatus;
  access?: AdminStudentAccessFilter;
  source?: AdminStudentAccessSource;
  plan?: SubscriptionPlanId;
  registeredFrom?: string;
  registeredTo?: string;
  limit: 25 | 50 | 100;
};

export type AdminStudentPrimaryMethod = {
  type: IdentityMethodType | null;
  label: string;
};

export type AdminStudentListItem = {
  id: string;
  displayName: string;
  status: AdminStudentStatus;
  primaryMethod: AdminStudentPrimaryMethod;
  accessState: AdminStudentAccessState;
  accessUntil?: string;
  scheduledFrom?: string;
  registeredAt: string;
  lastSessionCreatedAt?: string;
  hasPayments: boolean;
  latestPaidPlan?: SubscriptionPlanId;
};

export type AdminStudentListPage = {
  items: readonly AdminStudentListItem[];
  nextCursor?: string;
};

export type AdminStudentTelegramProfile = {
  subject: string;
  metadataVersion?: number;
  userId?: string;
  profileName?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  requestedScopes: readonly string[];
  tokenIssuedAt?: string;
  tokenExpiresAt?: string;
};

export type AdminStudentIdentityMethod = {
  id: string;
  type: IdentityMethodType;
  maskedIdentifier: string;
  verifiedAt: string;
  telegramUsername?: string;
  telegramProfile?: AdminStudentTelegramProfile;
};

export type AdminStudentSession = {
  id: string;
  state: "active" | "expired" | "revoked";
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
  authenticationMethod?: SessionAuthenticationMethod;
  userAgentFamily?: string;
  browserVersion?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  deviceType?: SessionDeviceType;
  deviceVendor?: string;
  deviceModel?: string;
  architecture?: string;
  bitness?: string;
  ipAddress?: string;
  countryCode?: string;
  region?: string;
  regionCode?: string;
  city?: string;
  timezone?: string;
  preferredLanguage?: string;
  rawUserAgent?: string;
  cloudflareRayId?: string;
};

export type AdminStudentPaidGrant = {
  source: "paid";
  orderId?: string;
  planId: SubscriptionPlanId;
  status: "granted" | "revoked";
  periodStart: string;
  periodEnd: string;
  grantedAt: string;
  revokedAt?: string;
  effectiveNow: boolean;
};

export type AdminStudentEffectiveAccess = {
  state: AdminStudentAccessState;
  activeUntil?: string;
  scheduledFrom?: string;
  mostRecentEnd?: string;
};

export type AdminStudentDetail = {
  id: string;
  displayName: string;
  paymentContextVisible: boolean;
  billingContextVisible: boolean;
  receiptEmail?: string;
  status: AdminStudentStatus;
  createdAt: string;
  methods: readonly AdminStudentIdentityMethod[];
  sessions: readonly AdminStudentSession[];
  sessionCount: number;
  sessionsTruncated: boolean;
  paidGrants: readonly AdminStudentPaidGrant[];
  effectiveAccess: AdminStudentEffectiveAccess;
  paymentCount?: number;
};
