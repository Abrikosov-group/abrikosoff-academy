import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CURRENT_LIFECYCLE_OWNER_ID,
  GITHUB_ACTIONS_APP_ID,
  LOCAL_PRODUCTION_RELEASE_CONFIRMATION,
  SOURCE_BRANCH_REQUIRED_CHECKS,
} from "../../scripts/release-train/config.mjs";
import {
  executeProductionRelease,
  parseLocalReleaseArguments,
  runLocalRelease,
  validateMergedByOwner,
  validateRegistryTokenBuffer,
  validateRequiredCheckRuns,
  verifyRegistryToken,
} from "../../scripts/release-train/local-release.mjs";

const REPOSITORY = "Abrikosov-group/abrikosoff-academy";
const SHA = "a".repeat(40);
const TOKEN = "ghp_test_registry_token_value_1234567890";

function pullRequest(overrides = {}) {
  return {
    base: { ref: "main" },
    head: { ref: "codex/hotfix-release", repo: { full_name: REPOSITORY } },
    labels: [],
    merge_commit_sha: SHA,
    merged_at: "2026-08-06T12:00:00Z",
    merged_by: {
      id: Number(CURRENT_LIFECYCLE_OWNER_ID),
      login: "Etogerman",
    },
    number: 56,
    ...overrides,
  };
}

function successfulCheckRuns() {
  return SOURCE_BRANCH_REQUIRED_CHECKS.map((required, index) => ({
    app: { id: required.app_id },
    conclusion: "success",
    head_sha: SHA,
    id: 100 + index,
    name: required.context,
    status: "completed",
  }));
}

function apiForCandidate({ infrastructure = false, checkRuns } = {}) {
  const pr = pullRequest(
    infrastructure
      ? {
          head: {
            ref: "agent/protect-production-release",
            repo: { full_name: REPOSITORY },
          },
          labels: [{ name: "release:infrastructure-no-deploy" }],
        }
      : {},
  );
  return {
    repoPath: (path) => `/repos/${REPOSITORY}${path}`,
    async request(path) {
      if (path.includes(`/commits/${SHA}/pulls`)) {
        return { data: [{ number: 56 }] };
      }
      if (path === `/repos/${REPOSITORY}/pulls/56`) {
        return { data: pr };
      }
      if (path === "/graphql") {
        return {
          data: {
            data: {
              repository: {
                pullRequest: {
                  baseRefName: "main",
                  mergeCommit: { oid: SHA },
                  merged: true,
                  mergedAt: pr.merged_at,
                  number: 56,
                },
              },
            },
          },
        };
      }
      if (path.includes("/pulls/56/files")) {
        return {
          data: infrastructure
            ? [
                {
                  filename: "scripts/release-train/local-release.mjs",
                  status: "added",
                },
              ]
            : [{ filename: "src/app/page.tsx", status: "modified" }],
        };
      }
      if (path.includes(`/commits/${SHA}/check-runs`)) {
        return { data: { check_runs: checkRuns ?? successfulCheckRuns() } };
      }
      assert.fail(`Неожиданный API path: ${path}`);
    },
  };
}

function platformDependencies(overrides = {}) {
  return {
    api: apiForCandidate(),
    inspectCheckout: async () => ({ mainSha: SHA, repositoryRoot: "/tmp/repo" }),
    inspectPlatform: async () => ({
      actorId: CURRENT_LIFECYCLE_OWNER_ID,
      actorLogin: "Etogerman",
    }),
    inspectTools: async () => undefined,
    ...overrides,
  };
}

test("CLI разделяет read-only проверку и явно подтверждённый выпуск", () => {
  assert.deepEqual(parseLocalReleaseArguments(["--verify"]), {
    confirmation: null,
    help: false,
    host: null,
    knownHostsPath: null,
    mode: "verify",
    port: null,
    sshKeyPath: null,
    user: null,
  });

  const release = parseLocalReleaseArguments([
    "--release",
    "--host",
    "production.example.com",
    "--port",
    "2222",
    "--user",
    "deploy",
    "--ssh-key",
    "/tmp/release-key",
    "--known-hosts",
    "/tmp/known_hosts",
    "--confirmation",
    `${LOCAL_PRODUCTION_RELEASE_CONFIRMATION} ${SHA}`,
  ]);
  assert.equal(release.mode, "release");
  assert.equal(release.port, "2222");

  assert.throws(
    () => parseLocalReleaseArguments(["--verify", "--host", "example.com"]),
    { code: "LOCAL_RELEASE_VERIFY_ARGUMENTS_FORBIDDEN" },
  );
  assert.throws(
    () =>
      parseLocalReleaseArguments([
        "--release",
        "--host",
        "production.example.com;touch-pwned",
        "--port",
        "22",
        "--user",
        "deploy",
        "--ssh-key",
        "/tmp/key",
        "--known-hosts",
        "/tmp/known_hosts",
        "--confirmation",
        "x",
      ]),
    { code: "LOCAL_RELEASE_HOST_INVALID" },
  );
});

test("production-кандидат должен быть слит точным владельцем", () => {
  assert.equal(validateMergedByOwner(pullRequest()).id, CURRENT_LIFECYCLE_OWNER_ID);
  assert.throws(
    () =>
      validateMergedByOwner(
        pullRequest({ merged_by: { id: 268953403, login: "intern" } }),
      ),
    { code: "LOCAL_RELEASE_MERGER_NOT_OWNER" },
  );
});

test("обязательные checks привязаны к точному SHA и GitHub Actions App", () => {
  assert.equal(
    validateRequiredCheckRuns({ checkRuns: successfulCheckRuns(), sha: SHA })
      .length,
    4,
  );

  const wrongApp = successfulCheckRuns();
  wrongApp[0] = { ...wrongApp[0], app: { id: GITHUB_ACTIONS_APP_ID + 1 } };
  assert.throws(
    () => validateRequiredCheckRuns({ checkRuns: wrongApp, sha: SHA }),
    { code: "LOCAL_RELEASE_REQUIRED_CHECK_MISSING" },
  );

  const latestFailed = successfulCheckRuns();
  latestFailed.push({
    ...latestFailed[0],
    conclusion: "failure",
    id: 999,
  });
  assert.throws(
    () => validateRequiredCheckRuns({ checkRuns: latestFailed, sha: SHA }),
    { code: "LOCAL_RELEASE_REQUIRED_CHECK_FAILED" },
  );
});

test("GHCR token принадлежит владельцу и имеет только пакетные права", async () => {
  const token = Buffer.from(TOKEN);
  const result = await verifyRegistryToken({
    fetchImpl: async () => ({
      headers: new Headers({
        "x-oauth-scopes": "read:packages, write:packages",
      }),
      json: async () => ({
        id: Number(CURRENT_LIFECYCLE_OWNER_ID),
        login: "Etogerman",
      }),
      ok: true,
      status: 200,
    }),
    token,
  });
  assert.deepEqual(result.scopes, ["read:packages", "write:packages"]);
  assert.equal(validateRegistryTokenBuffer(token), token);

  await assert.rejects(
    verifyRegistryToken({
      fetchImpl: async () => ({
        headers: new Headers({
          "x-oauth-scopes": "repo, write:packages",
        }),
        json: async () => ({
          id: Number(CURRENT_LIFECYCLE_OWNER_ID),
          login: "Etogerman",
        }),
        ok: true,
        status: 200,
      }),
      token,
    }),
    { code: "LOCAL_RELEASE_REGISTRY_TOKEN_SCOPE_EXCESSIVE" },
  );
});

test("--verify выдаёт точное подтверждение и ничего не развёртывает", async () => {
  let executed = false;
  const result = await runLocalRelease(
    { mode: "verify" },
    platformDependencies({
      executeRelease: async () => {
        executed = true;
      },
    }),
  );
  assert.equal(executed, false);
  assert.equal(result.deploymentRequired, true);
  assert.equal(
    result.confirmation,
    `${LOCAL_PRODUCTION_RELEASE_CONFIRMATION} ${SHA}`,
  );
  assert.equal(result.requiredChecks.length, 4);
});

test("изменяющие команды не получают GHCR token через args или environment", async () => {
  const token = Buffer.from(TOKEN);
  const calls = [];
  let dockerConfig;
  await executeProductionRelease({
    actorLogin: "Etogerman",
    cwd: "/tmp/repo",
    host: "production.example.com",
    knownHostsPath: "/tmp/known_hosts",
    port: "22",
    runProcess: async (command, args, options = {}) => {
      const input = Buffer.isBuffer(options.input)
        ? Buffer.from(options.input)
        : options.input;
      calls.push({ command, args: [...args], env: options.env, input });
      if (command === "docker" && args.includes("login")) {
        dockerConfig = options.env.DOCKER_CONFIG;
      }
      if (command === "tar") {
        return { stderr: Buffer.alloc(0), stdout: Buffer.from("archive") };
      }
      return { stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) };
    },
    sha: SHA,
    sshKeyPath: "/tmp/key",
    token,
    user: "deploy",
  });

  assert.equal(calls.length, 6);
  assert.equal(calls.filter((call) => call.command === "docker").length, 3);
  assert.equal(calls.filter((call) => call.command === "ssh").length, 2);
  assert.equal(calls.some((call) => call.args.includes("--push")), true);
  assert.equal(
    calls.some((call) =>
      call.args.includes(
        `ghcr.io/abrikosov-group/abrikosoff-academy:${SHA}`,
      ),
    ),
    true,
  );
  for (const call of calls) {
    assert.doesNotMatch(JSON.stringify(call.args), new RegExp(TOKEN));
    assert.doesNotMatch(JSON.stringify(call.env ?? {}), new RegExp(TOKEN));
  }
  assert.equal(
    calls.filter((call) => call.input?.includes(Buffer.from(TOKEN))).length,
    2,
  );
  await assert.rejects(access(dockerConfig), { code: "ENOENT" });
});

test("infrastructure-no-deploy успешно проверяется, но не выпускается", async () => {
  const dependencies = platformDependencies({
    api: apiForCandidate({ infrastructure: true }),
  });
  const result = await runLocalRelease({ mode: "verify" }, dependencies);
  assert.equal(result.deploymentRequired, false);
  await assert.rejects(
    runLocalRelease(
      {
        confirmation: `${LOCAL_PRODUCTION_RELEASE_CONFIRMATION} ${SHA}`,
        host: "production.example.com",
        knownHostsPath: "/tmp/known_hosts",
        mode: "release",
        port: "22",
        sshKeyPath: "/tmp/key",
        user: "deploy",
      },
      dependencies,
    ),
    { code: "LOCAL_RELEASE_DEPLOYMENT_NOT_REQUIRED" },
  );
});

test("--release проверяет секреты до передачи и обнуляет token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "academy-local-release-test-"));
  const sshKeyPath = join(directory, "key");
  const knownHostsPath = join(directory, "known_hosts");
  await writeFile(sshKeyPath, "private-key-placeholder\n", "utf8");
  await writeFile(knownHostsPath, "host ssh-ed25519 public-key\n", "utf8");
  await chmod(sshKeyPath, 0o600);
  await chmod(knownHostsPath, 0o600);
  const suppliedToken = Buffer.from(TOKEN);
  let executed = false;
  let healthChecked = false;
  try {
    const result = await runLocalRelease(
      {
        confirmation: `${LOCAL_PRODUCTION_RELEASE_CONFIRMATION} ${SHA}`,
        host: "production.example.com",
        knownHostsPath,
        mode: "release",
        port: "22",
        sshKeyPath,
        user: "deploy",
      },
      platformDependencies({
        executeRelease: async ({ actorLogin, token }) => {
          executed = true;
          assert.equal(actorLogin, "Etogerman");
          assert.equal(token.toString("utf8"), TOKEN);
        },
        fetchImpl: async () => ({
          headers: new Headers({
            "x-oauth-scopes": "read:packages, write:packages",
          }),
          json: async () => ({
            id: Number(CURRENT_LIFECYCLE_OWNER_ID),
            login: "Etogerman",
          }),
          ok: true,
          status: 200,
        }),
        readRegistryToken: async () => suppliedToken,
        verifyHealth: async ({ sha }) => {
          assert.equal(sha, SHA);
          healthChecked = true;
        },
      }),
    );
    assert.equal(result.deployed, true);
    assert.equal(executed, true);
    assert.equal(healthChecked, true);
    assert.equal(suppliedToken.every((byte) => byte === 0), true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
