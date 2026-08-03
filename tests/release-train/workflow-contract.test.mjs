import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

function topLevelSectionKeys(source, sectionName) {
  const lines = source.split("\n");
  const sectionIndex = lines.findIndex((line) => line === `${sectionName}:`);
  assert.notEqual(sectionIndex, -1, `Не найден раздел ${sectionName}`);

  const keys = [];
  for (const line of lines.slice(sectionIndex + 1)) {
    if (/^[^\s#]/.test(line)) {
      break;
    }

    const key = /^ {2}([^\s:#][^:]*):(?:\s.*)?$/.exec(line)?.[1];
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

test("train-lifecycle на Team/private не получает private key и останавливается", async () => {
  const workflow = await read(".github/workflows/train-lifecycle.yml");
  const lifecycle = await read("scripts/release-train/train-lifecycle.mjs");
  assert.deepEqual(topLevelSectionKeys(workflow, "on"), ["workflow_dispatch"]);
  assert.doesNotMatch(workflow, /create_new/);
  assert.match(workflow, /group: production-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /environment:/);
  assert.doesNotMatch(workflow, /create-github-app-token/);
  assert.doesNotMatch(workflow, /PRIVATE_KEY|private-key|secrets\./);
  assert.match(workflow, /GitHub Team\/private/);
  assert.match(workflow, /docs\/operations\/release-train\.md/);
  assert.equal((workflow.match(/exit 1/g) ?? []).length, 2);
  assert.match(lifecycle, /ACTIONS_LIFECYCLE_DISABLED/);
  assert.doesNotMatch(
    lifecycle.slice(lifecycle.indexOf("if (isDirectRun)")),
    /runTrainOpen\(/,
  );
});

test("release сначала классифицирует main SHA и не строит infrastructure PR", async () => {
  const workflow = await read(".github/workflows/release.yml");
  assert.match(workflow, /group: production-release/);
  assert.match(workflow, /node-version: 24\.18\.0/);
  assert.match(workflow, /classify:\n\s+name: Классифицировать production-выпуск/);
  assert.equal(
    (workflow.match(/if: needs\.classify\.outputs\.should_deploy == 'true'/g) ?? [])
      .length,
    3,
  );
  assert.match(
    workflow,
    /deploy:[\s\S]*?needs:\n\s+- build\n\s+- classify/,
  );
  const deployJob = workflow.slice(workflow.indexOf("  deploy:"));
  assert.doesNotMatch(deployJob, /\n\s+- build-telegram-egress/);
  assert.match(workflow, /node scripts\/release-train\/release-classifier\.mjs/);
});

test("CI публикует отдельный обязательный контекст начального шлюза", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /name: Начальный шлюз релизного поезда/);
  assert.match(workflow, /node --test tests\/release-train\/\*\.test\.mjs/);
  assert.match(workflow, /node --check "\$script"/);
  const gateJob = workflow.slice(workflow.indexOf("  release-train-gate:"));
  assert.match(gateJob, /persist-credentials: false/);
});

test("release-классификатор содержит явный ref guard и закрытый allowlist", async () => {
  const classifier = await read("scripts/release-train/release-classifier.mjs");
  const config = await read("scripts/release-train/config.mjs");
  assert.match(classifier, /ref === `refs\/heads\/\$\{DEFAULT_BRANCH\}`/);
  assert.match(classifier, /INFRASTRUCTURE_NO_DEPLOY_PATHS\.has\(file\.filename\)/);
  assert.match(classifier, /api\.request\("\/graphql"/);
  assert.match(classifier, /mergeCommit \{\s+oid/);
  assert.match(classifier, /pullRequest\.merge_commit_sha === sha/);
  assert.match(config, /"release:infrastructure-no-deploy"/);
  assert.doesNotMatch(config, /src\/\*\*/);
});
