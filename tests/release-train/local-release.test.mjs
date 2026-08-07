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
  parseBuildMetadata,
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
const APPLICATION_DIGEST = `sha256:${"b".repeat(64)}`;
const TELEGRAM_EGRESS_DIGEST = `sha256:${"c".repeat(64)}`;

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
  await assert.rejects(
    verifyRegistryToken({
      fetchImpl: async () => ({
        headers: new Headers({
          "x-oauth-scopes": "admin:public_key, write:packages",
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

test("Buildx metadata принимает только согласованный sha256 digest", () => {
  assert.equal(
    parseBuildMetadata(
      JSON.stringify({
        "containerimage.descriptor": { digest: APPLICATION_DIGEST },
        "containerimage.digest": APPLICATION_DIGEST,
      }),
    ),
    APPLICATION_DIGEST,
  );
  assert.throws(
    () =>
      parseBuildMetadata(
        JSON.stringify({ "containerimage.digest": `sha256:${"z".repeat(64)}` }),
      ),
    { code: "LOCAL_RELEASE_BUILD_DIGEST_INVALID" },
  );
  assert.throws(
    () =>
      parseBuildMetadata(
        JSON.stringify({
          "containerimage.descriptor": { digest: TELEGRAM_EGRESS_DIGEST },
          "containerimage.digest": APPLICATION_DIGEST,
        }),
      ),
    { code: "LOCAL_RELEASE_BUILD_DIGEST_MISMATCH" },
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
  const events = [];
  let dockerConfig;
  const result = await executeProductionRelease({
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
      events.push(command === "docker" && args.includes("build")
        ? `build:${args.at(-1)}`
        : command);
      if (command === "docker" && args.includes("login")) {
        dockerConfig = options.env.DOCKER_CONFIG;
      }
      if (command === "docker" && args.includes("build")) {
        const metadataPath = args[args.indexOf("--metadata-file") + 1];
        const digest = args.at(-1) === "."
          ? APPLICATION_DIGEST
          : TELEGRAM_EGRESS_DIGEST;
        await writeFile(
          metadataPath,
          JSON.stringify({
            "containerimage.descriptor": { digest },
            "containerimage.digest": digest,
          }),
          "utf8",
        );
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
    verifyCurrentMain: async () => {
      events.push("verify-main");
    },
  });

  assert.equal(calls.length, 6);
  assert.equal(calls.filter((call) => call.command === "docker").length, 3);
  assert.equal(calls.filter((call) => call.command === "ssh").length, 2);
  assert.equal(calls.some((call) => call.args.includes("--push")), true);
  assert.equal(result.applicationDigest, APPLICATION_DIGEST);
  assert.equal(result.telegramEgressDigest, TELEGRAM_EGRESS_DIGEST);
  assert.equal(
    calls.some((call) =>
      call.args.includes(
        `ghcr.io/abrikosov-group/abrikosoff-academy:${SHA}`,
      ),
    ),
    true,
  );
  const deployCall = calls.find(
    (call) =>
      call.command === "ssh" &&
      call.args.some((argument) => argument.startsWith("deploy ")),
  );
  assert.equal(
    deployCall.args.at(-1),
    `deploy ${SHA} ghcr.io/abrikosov-group/abrikosoff-academy@${APPLICATION_DIGEST} Etogerman`,
  );
  const mainVerificationIndexes = events
    .map((event, index) => (event === "verify-main" ? index : -1))
    .filter((index) => index >= 0);
  assert.equal(mainVerificationIndexes.length, 2);
  assert.ok(mainVerificationIndexes[0] < events.indexOf("build:./deploy/telegram-egress"));
  assert.ok(mainVerificationIndexes[1] > events.indexOf("build:."));
  assert.ok(mainVerificationIndexes[1] < events.indexOf("tar"));
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

test("изменение main после сборок запрещает любой SSH-вызов", async () => {
  const commands = [];
  let mainVerifications = 0;
  await assert.rejects(
    executeProductionRelease({
      actorLogin: "Etogerman",
      cwd: "/tmp/repo",
      host: "production.example.com",
      knownHostsPath: "/tmp/known_hosts",
      port: "22",
      runProcess: async (command, args) => {
        commands.push(command);
        if (command === "docker" && args.includes("build")) {
          const metadataPath = args[args.indexOf("--metadata-file") + 1];
          const digest = args.at(-1) === "."
            ? APPLICATION_DIGEST
            : TELEGRAM_EGRESS_DIGEST;
          await writeFile(
            metadataPath,
            JSON.stringify({ "containerimage.digest": digest }),
            "utf8",
          );
        }
        return { stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) };
      },
      sha: SHA,
      sshKeyPath: "/tmp/key",
      token: Buffer.from(TOKEN),
      user: "deploy",
      verifyCurrentMain: async () => {
        mainVerifications += 1;
        if (mainVerifications === 2) {
          throw new Error("main изменился");
        }
      },
    }),
    /main изменился/,
  );
  assert.equal(commands.filter((command) => command === "docker").length, 3);
  assert.equal(mainVerifications, 2);
  assert.equal(commands.includes("tar"), false);
  assert.equal(commands.includes("ssh"), false);
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
  let checkoutInspections = 0;
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
        executeRelease: async ({ actorLogin, token, verifyCurrentMain }) => {
          executed = true;
          assert.equal(actorLogin, "Etogerman");
          assert.equal(token.toString("utf8"), TOKEN);
          await verifyCurrentMain();
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
        inspectCheckout: async () => {
          checkoutInspections += 1;
          return { mainSha: SHA, repositoryRoot: "/tmp/repo" };
        },
        verifyHealth: async ({ sha }) => {
          assert.equal(sha, SHA);
          healthChecked = true;
        },
      }),
    );
    assert.equal(result.deployed, true);
    assert.equal(executed, true);
    assert.equal(healthChecked, true);
    assert.equal(checkoutInspections, 3);
    assert.equal(suppliedToken.every((byte) => byte === 0), true);

    const changedToken = Buffer.from(TOKEN);
    let changedCheckoutInspections = 0;
    let changedReleaseExecuted = false;
    await assert.rejects(
      runLocalRelease(
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
          executeRelease: async () => {
            changedReleaseExecuted = true;
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
          inspectCheckout: async () => {
            changedCheckoutInspections += 1;
            return {
              mainSha: changedCheckoutInspections === 1 ? SHA : "d".repeat(40),
              repositoryRoot: "/tmp/repo",
            };
          },
          readRegistryToken: async () => changedToken,
        }),
      ),
      { code: "LOCAL_RELEASE_MAIN_CHANGED" },
    );
    assert.equal(changedReleaseExecuted, false);
    assert.equal(changedToken.every((byte) => byte === 0), true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
