import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
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
  const directRunIndex = lifecycle.indexOf("if (isDirectRun)");
  assert.notEqual(directRunIndex, -1, "Не найден прямой CLI-вход lifecycle");
  assert.doesNotMatch(
    lifecycle.slice(directRunIndex),
    /runTrainOpen\(/,
  );
});

test("GitHub Actions не содержит production-выпуск, secrets или запись в packages", async () => {
  await assert.rejects(
    access(new URL(".github/workflows/release.yml", ROOT)),
    { code: "ENOENT" },
  );
  const workflowDirectory = new URL(".github/workflows/", ROOT);
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) =>
    /\.ya?ml$/.test(file),
  );
  assert.deepEqual(workflowFiles.sort(), ["ci.yml", "train-lifecycle.yml"]);
  for (const workflowFile of workflowFiles) {
    const workflow = await read(`.github/workflows/${workflowFile}`);
    assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
    assert.doesNotMatch(workflow, /packages:\s*write/);
    assert.doesNotMatch(workflow, /environment:\s*(?:\n\s+name:\s*)?production/);
    assert.doesNotMatch(workflow, /docker\/login-action/);
    assert.doesNotMatch(workflow, /\bssh\b/);
  }
});

test("CI публикует отдельный обязательный контекст начального шлюза", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /name: Начальный шлюз релизного поезда/);
  assert.match(workflow, /node --test tests\/release-train\/\*\.test\.mjs/);
  assert.match(workflow, /node --check "\$script"/);
  const gateJob = workflow.slice(workflow.indexOf("  release-train-gate:"));
  assert.match(gateJob, /persist-credentials: false/);
  assert.match(workflow, /shellcheck deploy\/server\/academy-task/);
  assert.match(
    workflow,
    /for wrapper_name in academy-admin academy-release academy-task/,
  );
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

test("локальный выпуск закрыт точным owner, SHA, checks и stdin-секретом", async () => {
  const decision = await read(
    "docs/decisions/0011-owner-local-production-release.md",
  );
  const localRelease = await read("scripts/release-train/local-release.mjs");
  const adminWrapper = await read("deploy/server/academy-admin");
  const releaseWrapper = await read("deploy/server/academy-release");
  const taskWrapper = await read("deploy/server/academy-task");
  assert.match(localRelease, /inspectTrustedCheckout/);
  assert.match(localRelease, /inspectOwnerPlatformContext/);
  assert.match(localRelease, /CURRENT_LIFECYCLE_OWNER_ID/);
  assert.match(localRelease, /SOURCE_BRANCH_REQUIRED_CHECKS/);
  assert.match(localRelease, /pullRequest\?\.merged_by\?\.id/);
  assert.match(localRelease, /--password-stdin/);
  assert.match(localRelease, /StrictHostKeyChecking=yes/);
  assert.match(localRelease, /UserKnownHostsFile=/);
  assert.match(localRelease, /linux\/amd64/);
  assert.match(localRelease, /--metadata-file/);
  assert.match(localRelease, /PRODUCTION_APPLICATION_IMAGE\}@\$\{applicationDigest\}/);
  assert.match(localRelease, /ALLOWED_REGISTRY_TOKEN_SCOPES/);
  assert.match(localRelease, /await verifyCurrentMain\(\)/);
  assert.doesNotMatch(localRelease, /process\.env\.[A-Z_]*(?:TOKEN|SECRET|PASSWORD)/);
  assert.match(decision, /отключает наследование доступа от\s+репозитория/);
  assert.match(decision, /удаляет доступ Actions на запись/);
  assert.match(decision, /package-роли `Write` или\s+`Admin`/);
  for (const wrapper of [adminWrapper, releaseWrapper, taskWrapper]) {
    assert.match(wrapper, /@\$\{image_digest\}|sha256:\[0-9a-f\]\{64\}/);
    assert.doesNotMatch(wrapper, /image_prefix/);
  }
  for (const runtimeWrapper of [adminWrapper, taskWrapper]) {
    assert.match(runtimeWrapper, /org\.opencontainers\.image\.revision/);
    assert.match(runtimeWrapper, /active_revision.*app_version/s);
  }
  assert.match(releaseWrapper, /legacy tag; завершите digest-cutover/);
  assert.match(releaseWrapper, /previous_revision.*previous_version/s);
});
