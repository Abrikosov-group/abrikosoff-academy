import "server-only";

import {
  adminStudentAccessStates,
  adminStudentStatusFilters,
  type AdminStudentCursor,
  type AdminStudentListFilters,
} from "./student-read-model";
import {
  subscriptionPlanIds,
  type SubscriptionPlanId,
} from "@/modules/billing/domain/types";

type SearchParamValue = string | string[] | undefined;

export type AdminStudentListSearchParams = Record<
  string,
  SearchParamValue
>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function recognizedValue<const T extends readonly string[]>(
  value: SearchParamValue,
  allowed: T,
): T[number] | undefined {
  const candidate = firstValue(value);

  return candidate &&
    allowed.includes(candidate as T[number])
    ? (candidate as T[number])
    : undefined;
}

function validCalendarDate(value: SearchParamValue) {
  const candidate = firstValue(value);

  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return undefined;
  }

  const parsed = new Date(`${candidate}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== candidate
    ? undefined
    : candidate;
}

function parseLimit(value: SearchParamValue): 25 | 50 | 100 {
  const candidate = Number(firstValue(value));

  return candidate === 25 || candidate === 100 ? candidate : 50;
}

export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export function encodeAdminStudentCursor(
  cursor: AdminStudentCursor,
) {
  return Buffer.from(
    JSON.stringify([cursor.createdAt, cursor.id]),
    "utf8",
  ).toString("base64url");
}

export function decodeAdminStudentCursor(
  value: SearchParamValue,
): AdminStudentCursor | undefined {
  const encoded = firstValue(value);

  if (!encoded || encoded.length > 300) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );

    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !isUuid(parsed[1])
    ) {
      return undefined;
    }

    const createdAt = new Date(parsed[0]);

    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== parsed[0]
    ) {
      return undefined;
    }

    return {
      createdAt: parsed[0],
      id: parsed[1].toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

export function parseAdminStudentListQuery(
  searchParams: AdminStudentListSearchParams,
) {
  const rawQuery = firstValue(searchParams.q)?.trim() ?? "";
  const query = rawQuery.slice(0, 120);
  const plan = recognizedValue(
    searchParams.plan,
    subscriptionPlanIds,
  ) as SubscriptionPlanId | undefined;
  const filters: AdminStudentListFilters = {
    query,
    status: recognizedValue(
      searchParams.status,
      adminStudentStatusFilters,
    ),
    access: recognizedValue(
      searchParams.access,
      adminStudentAccessStates,
    ),
    source:
      firstValue(searchParams.source) === "paid"
        ? "paid"
        : undefined,
    plan,
    registeredFrom: validCalendarDate(searchParams.from),
    registeredTo: validCalendarDate(searchParams.to),
    limit: parseLimit(searchParams.limit),
  };

  return {
    filters,
    cursor: decodeAdminStudentCursor(searchParams.cursor),
  };
}
