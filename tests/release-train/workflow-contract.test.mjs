import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("train-lifecycle загружается из main и предоставляет только ручной open", async () => {
  const workflow = await read(".github/workflows/train-lifecycle.yml");
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /create_new/);
  assert.match(workflow, /TRAIN_OPEN_MODE: register_existing/);
  assert.match(workflow, /group: production-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: release-train-lifecycle/);
  assert.match(workflow, /node-version: 24\.18\.0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(
    workflow,
    /actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/,
  );
  assert.match(workflow, /client-id: \$\{\{ vars\.TRAIN_LIFECYCLE_APP_CLIENT_ID \}\}/);
  assert.doesNotMatch(workflow, /\n\s+app-id:/);
  assert.match(workflow, /permission-administration: write/);
  assert.match(workflow, /permission-actions: read/);
  assert.match(workflow, /permission-contents: write/);
  assert.match(workflow, /TRAIN_LIFECYCLE_TOKEN: \$\{\{ steps\.lifecycle-token\.outputs\.token \}\}/);
  const preflightIndex = workflow.indexOf(
    "node scripts/release-train/train-lifecycle.mjs --preflight",
  );
  const tokenIndex = workflow.indexOf("actions/create-github-app-token@");
  assert.ok(preflightIndex >= 0 && preflightIndex < tokenIndex);
  assert.doesNotMatch(workflow, /environment:\n\s+name: production/);
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
  assert.match(classifier, /pullRequest\.merge_commit_sha === sha/);
  assert.match(config, /"release:infrastructure-no-deploy"/);
  assert.doesNotMatch(config, /src\/\*\*/);
});
