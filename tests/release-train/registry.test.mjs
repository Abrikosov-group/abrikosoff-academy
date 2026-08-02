import assert from "node:assert/strict";
import test from "node:test";

import { REGISTRY_METADATA } from "../../scripts/release-train/config.mjs";
import {
  canonicalJson,
  createTrainOpenedEvent,
  eventPath,
  validateAppendOnlyHistory,
  validateEventFiles,
  validateRegistryEvents,
  validateRegistryMetadata,
} from "../../scripts/release-train/registry.mjs";

const TRAIN_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_TRAIN_ID = "22222222-2222-4222-8222-222222222222";
const MAIN_SHA = "a".repeat(40);

function openedEvent({ sequence = 1, trainId = TRAIN_ID } = {}) {
  return createTrainOpenedEvent({
    actorId: "123456",
    actorLogin: "owner",
    lifecycleRunAttempt: 1,
    lifecycleRunId: "987654",
    occurredAt: "2026-08-02T12:00:00.000Z",
    openedFromMainSha: MAIN_SHA,
    registrySequence: sequence,
    sourceBranch: "codex/admin-operational-mvp",
    trainId,
  });
}

function blob(path, sha) {
  return { mode: "100644", path, sha, type: "blob" };
}

test("metadata реестра принимается только при точном контракте", () => {
  assert.deepEqual(validateRegistryMetadata(REGISTRY_METADATA), REGISTRY_METADATA);
  assert.throws(
    () => validateRegistryMetadata({ ...REGISTRY_METADATA, extra: true }),
    { code: "REGISTRY_METADATA_FIELDS_INVALID" },
  );
});

test("train_opened получает детерминированный путь и канонический JSON", () => {
  const event = openedEvent();
  assert.equal(
    eventPath(event),
    `events/00000001-train_opened-${TRAIN_ID}.json`,
  );
  assert.equal(canonicalJson(event), `${JSON.stringify(event)}\n`);
});

test("реестр запрещает два одновременно активных поезда", () => {
  assert.throws(
    () =>
      validateRegistryEvents([
        openedEvent(),
        openedEvent({ sequence: 2, trainId: SECOND_TRAIN_ID }),
      ]),
    { code: "REGISTRY_MULTIPLE_ACTIVE_TRAINS" },
  );
});

test("append-only история допускает только корень и один новый event на коммит", () => {
  const path = eventPath(openedEvent());
  const history = validateAppendOnlyHistory([
    {
      entries: [blob("registry.json", "1".repeat(40))],
      parentSha: null,
      sha: "a".repeat(40),
    },
    {
      entries: [
        blob("registry.json", "1".repeat(40)),
        blob(path, "2".repeat(40)),
      ],
      parentSha: "a".repeat(40),
      sha: "b".repeat(40),
    },
  ]);

  assert.deepEqual(history.eventPaths, [path]);
  assert.equal(history.headSha, "b".repeat(40));
});

test("изменение существующего blob отклоняется", () => {
  assert.throws(
    () =>
      validateAppendOnlyHistory([
        {
          entries: [blob("registry.json", "1".repeat(40))],
          parentSha: null,
          sha: "a".repeat(40),
        },
        {
          entries: [
            blob("registry.json", "9".repeat(40)),
            blob(eventPath(openedEvent()), "2".repeat(40)),
          ],
          parentSha: "a".repeat(40),
          sha: "b".repeat(40),
        },
      ]),
    { code: "REGISTRY_EXISTING_ENTRY_CHANGED" },
  );
});

test("несовпадающий родитель в истории реестра отклоняется", () => {
  assert.throws(
    () =>
      validateAppendOnlyHistory([
        {
          entries: [blob("registry.json", "1".repeat(40))],
          parentSha: null,
          sha: "a".repeat(40),
        },
        {
          entries: [
            blob("registry.json", "1".repeat(40)),
            blob(eventPath(openedEvent()), "2".repeat(40)),
          ],
          parentSha: "f".repeat(40),
          sha: "b".repeat(40),
        },
      ]),
    { code: "REGISTRY_HISTORY_NOT_LINEAR" },
  );
});

test("содержимое event обязано совпадать с последовательностью и путём", () => {
  const event = openedEvent();
  const path = eventPath(event);
  assert.deepEqual(
    validateEventFiles({
      eventFiles: new Map([[path, canonicalJson(event)]]),
      expectedPaths: [path],
    }),
    [event],
  );

  assert.throws(
    () =>
      validateEventFiles({
        eventFiles: new Map([
          [path, canonicalJson({ ...event, registry_sequence: 2 })],
        ]),
        expectedPaths: [path],
      }),
    { code: "REGISTRY_EVENT_PATH_MISMATCH" },
  );
});
