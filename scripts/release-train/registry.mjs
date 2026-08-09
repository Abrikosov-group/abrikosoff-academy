import {
  ENVIRONMENT_ADMIN_BYPASS_POLICIES,
  LIFECYCLE_INVOCATION_KINDS,
  REGISTRY_METADATA,
  REGISTRY_METADATA_PATH,
  REGISTRY_SCHEMA_VERSION,
} from "./config.mjs";
import { ReleaseGateError, assertGate } from "./errors.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_PATH_PATTERN = /^events\/(\d{8})-([a-z_]+)-([0-9a-f-]{36})\.json$/;
const SOURCE_BRANCH_PATTERN =
  /^codex\/(?:admin-operational-mvp|train-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const KNOWN_EVENTS = new Set(["train_opened"]);
const KNOWN_ENVIRONMENT_POLICIES = new Set(
  Object.values(ENVIRONMENT_ADMIN_BYPASS_POLICIES),
);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, code, context) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assertGate(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    code,
    `${context}: ожидались поля ${expected.join(", ")}, получены ${actual.join(", ")}`,
  );
}

function assertCommonEvent(event) {
  assertGate(isPlainObject(event), "REGISTRY_EVENT_INVALID", "Событие реестра должно быть объектом");
  assertGate(
    event.schema_version === REGISTRY_SCHEMA_VERSION,
    "REGISTRY_EVENT_SCHEMA_INVALID",
    "Событие реестра имеет неподдерживаемую версию схемы",
  );
  assertGate(
    Number.isSafeInteger(event.registry_sequence) && event.registry_sequence > 0,
    "REGISTRY_EVENT_SEQUENCE_INVALID",
    "Событие реестра имеет недопустимую последовательность",
  );
  assertGate(KNOWN_EVENTS.has(event.event), "REGISTRY_EVENT_TYPE_INVALID", "Неизвестный тип события реестра");
  assertGate(UUID_PATTERN.test(event.train_id ?? ""), "REGISTRY_TRAIN_ID_INVALID", "train_id должен быть UUID");
  assertGate(
    typeof event.occurred_at === "string" &&
      Number.isFinite(Date.parse(event.occurred_at)) &&
      event.occurred_at.endsWith("Z"),
    "REGISTRY_EVENT_TIME_INVALID",
    "occurred_at должен быть UTC-временем ISO 8601",
  );
  validateLifecycleInvocation(event.lifecycle_invocation);
  assertGate(
    KNOWN_ENVIRONMENT_POLICIES.has(event.environment_admin_bypass_policy),
    "REGISTRY_ENVIRONMENT_POLICY_INVALID",
    "Политика административного обхода Environment неизвестна",
  );
  if (event.lifecycle_invocation.kind === LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER) {
    assertGate(
      event.environment_admin_bypass_policy ===
        ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
      "REGISTRY_INVOCATION_POLICY_MISMATCH",
      "Локальная операция владельца должна фиксировать Team/private-профиль",
    );
  } else {
    assertGate(
      event.environment_admin_bypass_policy ===
        ENVIRONMENT_ADMIN_BYPASS_POLICIES.FORBIDDEN,
      "REGISTRY_INVOCATION_POLICY_MISMATCH",
      "GitHub Actions lifecycle не может принимать административный обход",
    );
  }
  assertGate(
    typeof event.actor_id === "string" && /^\d+$/.test(event.actor_id),
    "REGISTRY_ACTOR_ID_INVALID",
    "actor_id должен быть строкой цифр",
  );
  assertGate(
    typeof event.actor_login === "string" && /^[A-Za-z0-9-]{1,39}$/.test(event.actor_login),
    "REGISTRY_ACTOR_LOGIN_INVALID",
    "actor_login имеет недопустимый формат",
  );
}

export function validateLifecycleInvocation(invocation) {
  assertGate(
    isPlainObject(invocation),
    "REGISTRY_INVOCATION_INVALID",
    "Происхождение lifecycle-операции должно быть объектом",
  );
  if (invocation.kind === LIFECYCLE_INVOCATION_KINDS.GITHUB_ACTIONS) {
    assertExactKeys(
      invocation,
      ["kind", "run_attempt", "run_id"],
      "REGISTRY_INVOCATION_FIELDS_INVALID",
      "GitHub Actions lifecycle invocation",
    );
    assertGate(
      typeof invocation.run_id === "string" && /^\d+$/.test(invocation.run_id),
      "REGISTRY_RUN_ID_INVALID",
      "run_id должен быть строкой цифр",
    );
    assertGate(
      Number.isSafeInteger(invocation.run_attempt) &&
        invocation.run_attempt > 0,
      "REGISTRY_RUN_ATTEMPT_INVALID",
      "run_attempt должен быть положительным целым числом",
    );
    return invocation;
  }

  assertGate(
    invocation.kind === LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER,
    "REGISTRY_INVOCATION_KIND_INVALID",
    "Неизвестный вид происхождения lifecycle-операции",
  );
  assertExactKeys(
    invocation,
    ["kind", "operation_id"],
    "REGISTRY_INVOCATION_FIELDS_INVALID",
    "Локальная lifecycle invocation",
  );
  assertGate(
    UUID_PATTERN.test(invocation.operation_id ?? ""),
    "REGISTRY_OPERATION_ID_INVALID",
    "operation_id локальной операции должен быть UUID",
  );
  return invocation;
}

export function validateRegistryMetadata(metadata) {
  assertGate(isPlainObject(metadata), "REGISTRY_METADATA_INVALID", "Metadata реестра должна быть объектом");
  assertExactKeys(
    metadata,
    ["kind", "schema_version"],
    "REGISTRY_METADATA_FIELDS_INVALID",
    "Metadata реестра",
  );
  assertGate(
    metadata.kind === REGISTRY_METADATA.kind &&
      metadata.schema_version === REGISTRY_METADATA.schema_version,
    "REGISTRY_METADATA_MISMATCH",
    "Metadata не соответствует реестру релизных поездов Академии",
  );
  return metadata;
}

export function validateRegistryEvent(event) {
  assertCommonEvent(event);

  assertExactKeys(
    event,
    [
      "actor_id",
      "actor_login",
      "environment_admin_bypass_policy",
      "event",
      "lifecycle_invocation",
      "occurred_at",
      "opened_from_main_sha",
      "registry_sequence",
      "schema_version",
      "source_branch",
      "train_id",
    ],
    "REGISTRY_OPEN_FIELDS_INVALID",
    "train_opened",
  );
  assertGate(
    SHA_PATTERN.test(event.opened_from_main_sha ?? ""),
    "REGISTRY_OPEN_SHA_INVALID",
    "opened_from_main_sha должен содержать 40 шестнадцатеричных символов",
  );
  assertGate(
    SOURCE_BRANCH_PATTERN.test(event.source_branch ?? ""),
    "REGISTRY_SOURCE_BRANCH_INVALID",
    "source_branch не соответствует ветке интеграционного поезда",
  );
  if (event.source_branch.startsWith("codex/train-")) {
    assertGate(
      event.source_branch === `codex/train-${event.train_id}`,
      "REGISTRY_SOURCE_TRAIN_ID_MISMATCH",
      "UUID ветки поезда не совпадает с train_id события",
    );
  }

  return event;
}

export function eventPath(event) {
  validateRegistryEvent(event);
  return `events/${String(event.registry_sequence).padStart(8, "0")}-${event.event}-${event.train_id}.json`;
}

export function parseEventPath(path) {
  const match = EVENT_PATH_PATTERN.exec(path);
  assertGate(Boolean(match), "REGISTRY_EVENT_PATH_INVALID", `Недопустимый путь события: ${path}`);
  return {
    event: match[2],
    registrySequence: Number(match[1]),
    trainId: match[3],
  };
}

export function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

export function createTrainOpenedEvent({
  actorId,
  actorLogin,
  environmentAdminBypassPolicy,
  lifecycleInvocation,
  occurredAt,
  openedFromMainSha,
  registrySequence,
  sourceBranch,
  trainId,
}) {
  return validateRegistryEvent({
    actor_id: actorId,
    actor_login: actorLogin,
    environment_admin_bypass_policy: environmentAdminBypassPolicy,
    event: "train_opened",
    lifecycle_invocation: { ...lifecycleInvocation },
    occurred_at: occurredAt,
    opened_from_main_sha: openedFromMainSha,
    registry_sequence: registrySequence,
    schema_version: REGISTRY_SCHEMA_VERSION,
    source_branch: sourceBranch,
    train_id: trainId,
  });
}

export function validateRegistryEvents(events) {
  const trains = new Map();

  events.forEach((rawEvent, index) => {
    const event = validateRegistryEvent(rawEvent);
    const expectedSequence = index + 1;
    assertGate(
      event.registry_sequence === expectedSequence,
      "REGISTRY_SEQUENCE_GAP",
      `Ожидалась последовательность ${expectedSequence}, получена ${event.registry_sequence}`,
    );

    assertGate(
      !trains.has(event.train_id),
      "REGISTRY_TRAIN_DUPLICATED",
      `Поезд ${event.train_id} открыт повторно`,
    );
    trains.set(event.train_id, { openEvent: event });
  });

  const active = [...trains.values()];
  assertGate(
    active.length <= 1,
    "REGISTRY_MULTIPLE_ACTIVE_TRAINS",
    "В реестре одновременно существует больше одного активного поезда",
  );

  return {
    activeTrain: active[0]?.openEvent ?? null,
    trains,
  };
}

function normalizeTreeEntries(entries) {
  const result = new Map();
  for (const entry of entries) {
    assertGate(
      entry &&
        typeof entry.path === "string" &&
        typeof entry.mode === "string" &&
        typeof entry.sha === "string" &&
        typeof entry.type === "string",
      "REGISTRY_TREE_ENTRY_INVALID",
      "Git tree реестра содержит неполную запись",
    );
    assertGate(!result.has(entry.path), "REGISTRY_TREE_PATH_DUPLICATED", `Путь ${entry.path} повторяется в Git tree`);
    result.set(entry.path, {
      mode: entry.mode,
      sha: entry.sha,
      type: entry.type,
    });
  }
  return result;
}

function sameTreeEntry(left, right) {
  return (
    left?.mode === right?.mode &&
    left?.sha === right?.sha &&
    left?.type === right?.type
  );
}

export function validateAppendOnlyHistory(snapshots) {
  assertGate(snapshots.length > 0, "REGISTRY_HISTORY_EMPTY", "История реестра пуста");

  let previous = null;
  const newEventPaths = [];
  snapshots.forEach((snapshot, index) => {
    assertGate(SHA_PATTERN.test(snapshot.sha ?? ""), "REGISTRY_COMMIT_SHA_INVALID", "Коммит реестра имеет недопустимый SHA");
    const entries = normalizeTreeEntries(snapshot.entries ?? []);

    if (index === 0) {
      assertGate(snapshot.parentSha === null, "REGISTRY_ROOT_HAS_PARENT", "Корневой коммит реестра имеет родителя");
      assertGate(
        entries.size === 1 && entries.has(REGISTRY_METADATA_PATH),
        "REGISTRY_ROOT_TREE_INVALID",
        "Корневой коммит реестра должен содержать только registry.json",
      );
      const metadataEntry = entries.get(REGISTRY_METADATA_PATH);
      assertGate(
        metadataEntry.mode === "100644" && metadataEntry.type === "blob",
        "REGISTRY_METADATA_ENTRY_INVALID",
        "registry.json должен быть обычным Git blob",
      );
      previous = { entries, sha: snapshot.sha };
      return;
    }

    assertGate(
      snapshot.parentSha === previous.sha,
      "REGISTRY_HISTORY_NOT_LINEAR",
      "История реестра не является однородительской линейной цепочкой",
    );
    assertGate(
      entries.size === previous.entries.size + 1,
      "REGISTRY_COMMIT_NOT_APPEND_ONLY",
      "Каждый коммит реестра должен добавлять ровно один файл",
    );
    for (const [path, entry] of previous.entries) {
      assertGate(
        sameTreeEntry(entry, entries.get(path)),
        "REGISTRY_EXISTING_ENTRY_CHANGED",
        `Существующая запись ${path} была изменена или удалена`,
      );
    }

    const addedPaths = [...entries.keys()].filter((path) => !previous.entries.has(path));
    assertGate(addedPaths.length === 1, "REGISTRY_APPEND_COUNT_INVALID", "Коммит должен добавлять один путь");
    const addedPath = addedPaths[0];
    const addedEntry = entries.get(addedPath);
    parseEventPath(addedPath);
    assertGate(
      addedEntry.mode === "100644" && addedEntry.type === "blob",
      "REGISTRY_EVENT_ENTRY_INVALID",
      `Событие ${addedPath} должно быть обычным Git blob`,
    );
    newEventPaths.push(addedPath);
    previous = { entries, sha: snapshot.sha };
  });

  return {
    eventPaths: newEventPaths,
    headSha: snapshots.at(-1).sha,
    rootSha: snapshots[0].sha,
  };
}

export function validateEventFiles({ eventFiles, expectedPaths }) {
  assertGate(
    eventFiles.size === expectedPaths.length,
    "REGISTRY_EVENT_FILE_COUNT_MISMATCH",
    "Число событий в дереве не совпадает с append-only историей",
  );

  const events = [];
  expectedPaths.forEach((path, index) => {
    const raw = eventFiles.get(path);
    assertGate(typeof raw === "string", "REGISTRY_EVENT_FILE_MISSING", `Не найдено содержимое ${path}`);
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new ReleaseGateError("REGISTRY_EVENT_JSON_INVALID", `Файл ${path} содержит некорректный JSON`);
    }
    const pathData = parseEventPath(path);
    validateRegistryEvent(event);
    assertGate(
      event.registry_sequence === index + 1 &&
        event.registry_sequence === pathData.registrySequence &&
        event.event === pathData.event &&
        event.train_id === pathData.trainId &&
        eventPath(event) === path,
      "REGISTRY_EVENT_PATH_MISMATCH",
      `Содержимое ${path} не совпадает с его путём`,
    );
    events.push(event);
  });

  validateRegistryEvents(events);
  return events;
}
