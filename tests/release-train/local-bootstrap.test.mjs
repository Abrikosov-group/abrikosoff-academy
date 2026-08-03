import assert from "node:assert/strict";
import {
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ACADEMY_REPOSITORY,
  CURRENT_LIFECYCLE_APP,
  CURRENT_LIFECYCLE_OWNER_ID,
  PRODUCTION_ENVIRONMENT,
  TRAIN_OPEN_CONFIRMATION,
} from "../../scripts/release-train/config.mjs";
import {
  createGitHubAppJwt,
  createOrLoadOperationState,
  createScopedInstallationToken,
  inspectTrustedCheckout,
  parseLocalBootstrapArguments,
  runLocalBootstrap,
  validateAppIdentity,
  validateAppInstallation,
  validateEnvironmentBranchPolicyMode,
  validateInstallationTokenResponse,
  validateOwnerPlatformResponses,
  verifyScopedToken,
} from "../../scripts/release-train/local-bootstrap.mjs";

const MAIN_SHA = "a".repeat(40);
const SOURCE_SHA = "b".repeat(40);
const TRAIN_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-08-03T12:00:00.000Z");

function appIdentity() {
  return {
    client_id: CURRENT_LIFECYCLE_APP.clientId,
    id: CURRENT_LIFECYCLE_APP.id,
    owner: { login: CURRENT_LIFECYCLE_APP.owner },
    slug: CURRENT_LIFECYCLE_APP.slug,
  };
}

function installation() {
  return {
    account: { login: "Abrikosov-group" },
    app_id: CURRENT_LIFECYCLE_APP.id,
    events: [],
    id: 150950481,
    permissions: {
      actions: "read",
      administration: "write",
      contents: "write",
      metadata: "read",
    },
    repository_selection: "selected",
    suspended_at: null,
    target_type: "Organization",
  };
}

function tokenResponse(overrides = {}) {
  return {
    expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
    permissions: {
      actions: "read",
      administration: "write",
      contents: "write",
    },
    repositories: [
      {
        full_name: ACADEMY_REPOSITORY,
        private: true,
      },
    ],
    repository_selection: "selected",
    token: "test-installation-token-value-12345",
    ...overrides,
  };
}

test("CLI требует явный безопасный режим и точное подтверждение", () => {
  assert.deepEqual(
    parseLocalBootstrapArguments([
      "--verify",
      "--private-key",
      "/tmp/key.pem",
    ]),
    {
      confirmation: null,
      help: false,
      mode: "verify",
      privateKeyPath: "/tmp/key.pem",
    },
  );
  assert.equal(
    parseLocalBootstrapArguments([
      "--open",
      "--private-key",
      "/tmp/key.pem",
      "--confirmation",
      TRAIN_OPEN_CONFIRMATION,
    ]).mode,
    "open",
  );
  assert.throws(
    () =>
      parseLocalBootstrapArguments([
        "--open",
        "--private-key",
        "/tmp/key.pem",
        "--confirmation",
        "да",
      ]),
    { code: "TRAIN_OPEN_CONFIRMATION_INVALID" },
  );
  assert.throws(
    () => parseLocalBootstrapArguments(["--private-key", "/tmp/key.pem"]),
    { code: "LOCAL_MODE_REQUIRED" },
  );
});

test("GitHub App JWT подписывается RS256 и живёт меньше десяти минут", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwt = createGitHubAppJwt({ now: NOW, privateKey });
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(
    JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
    { alg: "RS256", typ: "JWT" },
  );
  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  assert.equal(claims.iss, CURRENT_LIFECYCLE_APP.clientId);
  assert.equal(claims.iat, Math.floor(NOW / 1_000) - 60);
  assert.equal(claims.exp, Math.floor(NOW / 1_000) + 9 * 60);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(
    verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    true,
  );
});

test("платформенный профиль привязан к владельцу, Team и private main", () => {
  const responses = {
    membership: { role: "admin", state: "active" },
    organization: { login: "Abrikosov-group", plan: { name: "team" } },
    repository: {
      default_branch: "main",
      full_name: ACADEMY_REPOSITORY,
      private: true,
      visibility: "private",
    },
    user: { id: Number(CURRENT_LIFECYCLE_OWNER_ID), login: "Etogerman" },
  };
  assert.equal(
    validateOwnerPlatformResponses(responses).actorId,
    CURRENT_LIFECYCLE_OWNER_ID,
  );
  assert.throws(
    () =>
      validateOwnerPlatformResponses({
        ...responses,
        organization: {
          ...responses.organization,
          plan: { name: "enterprise" },
        },
      }),
    { code: "TEAM_PRIVATE_PLAN_MISMATCH" },
  );
  assert.throws(
    () =>
      validateOwnerPlatformResponses({
        ...responses,
        user: { id: 1, login: "other" },
      }),
    { code: "TRUST_OWNER_MISMATCH" },
  );
});

test("локальный checkout обязан быть чистым актуальным main доверенного origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "academy-train-checkout-"));
  const calls = [];
  const outputs = new Map([
    ["rev-parse --show-toplevel", root],
    ["status --porcelain=v1 --untracked-files=all", ""],
    ["branch --show-current", "main"],
    [
      "remote get-url origin",
      "https://github.com/Abrikosov-group/abrikosoff-academy.git",
    ],
    [
      "fetch --no-tags origin refs/heads/main:refs/remotes/origin/main",
      "",
    ],
    ["rev-parse HEAD^{commit}", MAIN_SHA],
    ["rev-parse origin/main^{commit}", MAIN_SHA],
    ["rev-parse --git-dir", ".git"],
  ]);
  const runCommand = async (command, args) => {
    assert.equal(command, "git");
    const key = args.join(" ");
    calls.push(key);
    assert.equal(outputs.has(key), true, `неожиданная git-команда ${key}`);
    return { stdout: `${outputs.get(key)}\n` };
  };
  try {
    const checkout = await inspectTrustedCheckout({ cwd: root, runCommand });
    assert.equal(checkout.mainSha, MAIN_SHA);
    assert.equal(
      calls.includes(
        "fetch --no-tags origin refs/heads/main:refs/remotes/origin/main",
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("локальный operation ID сохраняется до мутаций и повторно используется", async () => {
  const root = await mkdtemp(join(tmpdir(), "academy-train-state-"));
  const gitDirectory = join(root, ".git");
  await mkdir(gitDirectory);
  try {
    const first = await createOrLoadOperationState({
      actorId: CURRENT_LIFECYCLE_OWNER_ID,
      actorLogin: "Etogerman",
      gitDirectory,
      mainSha: MAIN_SHA,
      now: () => "2026-08-03T12:00:00.000Z",
      operationId: () => OPERATION_ID,
    });
    const second = await createOrLoadOperationState({
      actorId: CURRENT_LIFECYCLE_OWNER_ID,
      actorLogin: "Etogerman",
      gitDirectory,
      mainSha: MAIN_SHA,
      operationId() {
        assert.fail("повтор не должен создавать новый operation ID");
      },
    });
    assert.equal(second.state.operation_id, OPERATION_ID);
    assert.equal((await stat(first.statePath)).mode & 0o077, 0);
    assert.equal(
      (await readFile(first.statePath, "utf8")).endsWith("\n"),
      true,
    );
    await assert.rejects(
      createOrLoadOperationState({
        actorId: CURRENT_LIFECYCLE_OWNER_ID,
        actorLogin: "Etogerman",
        gitDirectory,
        mainSha: "c".repeat(40),
      }),
      { code: "LOCAL_OPERATION_STATE_MISMATCH" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("конкурентное создание operation state публикует один целый файл", async () => {
  const root = await mkdtemp(join(tmpdir(), "academy-train-state-race-"));
  const gitDirectory = join(root, ".git");
  await mkdir(gitDirectory);
  const input = {
    actorId: CURRENT_LIFECYCLE_OWNER_ID,
    actorLogin: "Etogerman",
    gitDirectory,
    mainSha: MAIN_SHA,
    now: () => "2026-08-03T12:00:00.000Z",
  };
  try {
    const [first, second] = await Promise.all([
      createOrLoadOperationState({
        ...input,
        operationId: () => OPERATION_ID,
      }),
      createOrLoadOperationState({
        ...input,
        operationId: () => SECOND_OPERATION_ID,
      }),
    ]);
    assert.equal(first.state.operation_id, second.state.operation_id);
    assert.deepEqual(await readdir(gitDirectory), [
      "abrikosoff-release-train-bootstrap.json",
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(first.statePath, "utf8")),
      first.state,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("App и installation принимаются только с точной identity и permissions", () => {
  assert.equal(validateAppIdentity(appIdentity()).id, CURRENT_LIFECYCLE_APP.id);
  assert.equal(validateAppInstallation(installation()).id, 150950481);
  assert.equal(
    validateInstallationTokenResponse(tokenResponse(), NOW).token,
    "test-installation-token-value-12345",
  );
  assert.throws(
    () => validateAppIdentity({ ...appIdentity(), id: 1 }),
    { code: "LOCAL_APP_IDENTITY_MISMATCH" },
  );
  assert.throws(
    () =>
      validateAppInstallation({
        ...installation(),
        permissions: { ...installation().permissions, issues: "write" },
      }),
    { code: "LOCAL_INSTALLATION_PERMISSIONS_INVALID" },
  );
  assert.throws(
    () =>
      validateInstallationTokenResponse(
        tokenResponse({
          repositories: [
            { full_name: ACADEMY_REPOSITORY, private: true },
            { full_name: "Abrikosov-group/other", private: true },
          ],
        }),
        NOW,
      ),
    { code: "LOCAL_INSTALLATION_TOKEN_SCOPE_INVALID" },
  );
  assert.throws(
    () =>
      validateInstallationTokenResponse(
        tokenResponse({
          permissions: {
            administration: "write",
            contents: "write",
          },
        }),
        NOW,
      ),
    { code: "LOCAL_INSTALLATION_TOKEN_PERMISSIONS_INVALID" },
  );
});

test("production Environment допускает только два взаимоисключающих branch-policy режима", () => {
  assert.equal(
    validateEnvironmentBranchPolicyMode({
      deployment_branch_policy: {
        custom_branch_policies: false,
        protected_branches: true,
      },
    }),
    "protected",
  );
  assert.equal(
    validateEnvironmentBranchPolicyMode({
      deployment_branch_policy: {
        custom_branch_policies: true,
        protected_branches: false,
      },
    }),
    "custom",
  );
  for (const deploymentBranchPolicy of [
    undefined,
    { custom_branch_policies: false, protected_branches: false },
    { custom_branch_policies: true, protected_branches: true },
  ]) {
    assert.throws(
      () =>
        validateEnvironmentBranchPolicyMode({
          deployment_branch_policy: deploymentBranchPolicy,
        }),
      { code: "LOCAL_ENVIRONMENT_BRANCH_MODE_INVALID" },
    );
  }
});

test("scope-проверка читает список policies только в custom-режиме", async () => {
  const requests = [];
  const environmentPath = `/repos/${ACADEMY_REPOSITORY}/environments/${PRODUCTION_ENVIRONMENT}`;
  const policiesPath =
    `${environmentPath}/deployment-branch-policies?per_page=1&page=1`;
  const api = {
    repoPath(path) {
      return `/repos/${ACADEMY_REPOSITORY}${path}`;
    },
    async request(path) {
      requests.push(path);
      if (path === "/installation/repositories?per_page=100") {
        return {
          data: {
            repositories: [{ full_name: ACADEMY_REPOSITORY }],
            total_count: 1,
          },
        };
      }
      if (path === `/repos/${ACADEMY_REPOSITORY}/git/ref/heads/main`) {
        return {
          data: {
            object: { sha: MAIN_SHA },
            ref: "refs/heads/main",
          },
        };
      }
      if (path === environmentPath) {
        return {
          data: {
            deployment_branch_policy: {
              custom_branch_policies: true,
              protected_branches: false,
            },
            name: PRODUCTION_ENVIRONMENT,
          },
        };
      }
      if (path === policiesPath) {
        return { data: { branch_policies: [] } };
      }
      assert.fail(`неожиданный API path ${path}`);
    },
  };

  await verifyScopedToken(api, MAIN_SHA);

  assert.equal(requests.includes(policiesPath), true);
});

test("installation token запрашивается только для одного repo и минимальных прав", async () => {
  const requests = [];
  const responseByPath = new Map([
    ["/app", { body: appIdentity(), status: 200 }],
    [
      `/repos/${ACADEMY_REPOSITORY}/installation`,
      { body: installation(), status: 200 },
    ],
    [
      "/app/installations/150950481/access_tokens",
      { body: tokenResponse(), status: 201 },
    ],
  ]);
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ body: options.body, method: options.method, path });
    const fixture = responseByPath.get(path);
    assert.ok(fixture, `неожиданный API path ${path}`);
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status,
    });
  };

  const response = await createScopedInstallationToken({
    fetchImpl,
    jwt: "signed.jwt.value",
    now: NOW,
  });
  assert.equal(response.token, "test-installation-token-value-12345");
  assert.deepEqual(JSON.parse(requests[2].body), {
    permissions: {
      actions: "read",
      administration: "write",
      contents: "write",
    },
    repositories: ["abrikosoff-academy"],
  });
});

test("не прошедший scope-проверку installation token немедленно отзывается", async () => {
  let revoked = false;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/app") {
      return new Response(JSON.stringify(appIdentity()), { status: 200 });
    }
    if (path === `/repos/${ACADEMY_REPOSITORY}/installation`) {
      return new Response(JSON.stringify(installation()), { status: 200 });
    }
    if (path === "/app/installations/150950481/access_tokens") {
      return new Response(
        JSON.stringify(
          tokenResponse({
            repositories: [
              { full_name: "Abrikosov-group/other", private: true },
            ],
          }),
        ),
        { status: 201 },
      );
    }
    if (path === "/installation/token") {
      assert.equal(options.method, "DELETE");
      revoked = true;
      return new Response(null, { status: 204 });
    }
    assert.fail(`неожиданный API path ${path}`);
  };

  await assert.rejects(
    createScopedInstallationToken({
      fetchImpl,
      jwt: "signed.jwt.value",
      now: NOW,
    }),
    { code: "LOCAL_INSTALLATION_TOKEN_SCOPE_INVALID" },
  );
  assert.equal(revoked, true);
});

test("verify не создаёт operation state и всегда отзывает installation token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const raw = Buffer.from("sensitive-private-key-material");
  let operationCalls = 0;
  let revokeCalls = 0;
  const verifyRequests = [];
  const environmentPath = `/repos/${ACADEMY_REPOSITORY}/environments/${PRODUCTION_ENVIRONMENT}`;
  const result = await runLocalBootstrap(
    {
      confirmation: null,
      mode: "verify",
      privateKeyPath: "/private/key.pem",
    },
    {
      async createOrLoadOperationState() {
        operationCalls += 1;
      },
      async createScopedInstallationToken() {
        return tokenResponse();
      },
      currentTime: NOW,
      async inspectOwnerPlatformContext() {
        return {
          actorId: CURRENT_LIFECYCLE_OWNER_ID,
          actorLogin: "Etogerman",
          platformContext: {
            defaultBranch: "main",
            organizationPlan: "team",
            repository: ACADEMY_REPOSITORY,
            repositoryVisibility: "private",
          },
        };
      },
      async inspectTrustedCheckout() {
        return {
          gitDirectory: "/repo/.git",
          mainSha: MAIN_SHA,
          repositoryRoot: "/repo",
        };
      },
      installationApi: {
        repoPath(path) {
          return `/repos/${ACADEMY_REPOSITORY}${path}`;
        },
        async request(path) {
          verifyRequests.push(path);
          if (path === "/installation/repositories?per_page=100") {
            return {
              data: {
                repositories: [{ full_name: ACADEMY_REPOSITORY }],
                total_count: 1,
              },
            };
          }
          if (path === `/repos/${ACADEMY_REPOSITORY}/git/ref/heads/main`) {
            return {
              data: {
                object: { sha: MAIN_SHA },
                ref: "refs/heads/main",
              },
            };
          }
          if (path === environmentPath) {
            return {
              data: {
                deployment_branch_policy: {
                  custom_branch_policies: false,
                  protected_branches: true,
                },
                name: PRODUCTION_ENVIRONMENT,
              },
            };
          }
          assert.fail(`неожиданный API path ${path}`);
        },
      },
      async readPrivateKeyFile() {
        return { privateKey, raw };
      },
      async revokeInstallationToken() {
        revokeCalls += 1;
      },
    },
  );
  assert.equal(result.mode, "verify");
  assert.equal(operationCalls, 0);
  assert.equal(revokeCalls, 1);
  assert.deepEqual(verifyRequests, [
    "/installation/repositories?per_page=100",
    `/repos/${ACADEMY_REPOSITORY}/git/ref/heads/main`,
    environmentPath,
  ]);
  assert.deepEqual(raw, Buffer.alloc(raw.length));
});

test("open передаёт стабильный local_owner operation ID в lifecycle", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let observedInvocation;
  const result = await runLocalBootstrap(
    {
      confirmation: TRAIN_OPEN_CONFIRMATION,
      mode: "open",
      privateKeyPath: "/private/key.pem",
    },
    {
      async createOrLoadOperationState() {
        return {
          state: { operation_id: OPERATION_ID },
          statePath: "/repo/.git/bootstrap.json",
        };
      },
      async createScopedInstallationToken() {
        return tokenResponse();
      },
      currentTime: NOW,
      async inspectOwnerPlatformContext() {
        return {
          actorId: CURRENT_LIFECYCLE_OWNER_ID,
          actorLogin: "Etogerman",
          platformContext: {
            defaultBranch: "main",
            organizationPlan: "team",
            repository: ACADEMY_REPOSITORY,
            repositoryVisibility: "private",
          },
        };
      },
      async inspectTrustedCheckout() {
        return {
          gitDirectory: "/repo/.git",
          mainSha: MAIN_SHA,
          repositoryRoot: "/repo",
        };
      },
      installationApi: {},
      async readPrivateKeyFile() {
        return { privateKey, raw: Buffer.from("secret") };
      },
      async revokeInstallationToken() {},
      async runLocalTrainOpen(invocation) {
        observedInvocation = invocation;
        return {
          openedFromMainSha: "c".repeat(40),
          sourceBranch: "codex/admin-operational-mvp",
          sourceSha: SOURCE_SHA,
          trainId: TRAIN_ID,
        };
      },
      async verifyScopedToken() {},
    },
  );
  assert.equal(
    observedInvocation.lifecycleInvocation.operation_id,
    OPERATION_ID,
  );
  assert.equal(observedInvocation.lifecycleInvocation.kind, "local_owner");
  assert.equal(result.trainId, TRAIN_ID);
});

test("ошибка lifecycle не отменяет отзыв созданного installation token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let revoked = false;
  await assert.rejects(
    runLocalBootstrap(
      {
        confirmation: TRAIN_OPEN_CONFIRMATION,
        mode: "open",
        privateKeyPath: "/private/key.pem",
      },
      {
        async createOrLoadOperationState() {
          return {
            state: { operation_id: OPERATION_ID },
            statePath: "/repo/.git/bootstrap.json",
          };
        },
        async createScopedInstallationToken() {
          return tokenResponse();
        },
        currentTime: NOW,
        async inspectOwnerPlatformContext() {
          return {
            actorId: CURRENT_LIFECYCLE_OWNER_ID,
            actorLogin: "Etogerman",
            platformContext: {
              defaultBranch: "main",
              organizationPlan: "team",
              repository: ACADEMY_REPOSITORY,
              repositoryVisibility: "private",
            },
          };
        },
        async inspectTrustedCheckout() {
          return {
            gitDirectory: "/repo/.git",
            mainSha: MAIN_SHA,
            repositoryRoot: "/repo",
          };
        },
        installationApi: {},
        async readPrivateKeyFile() {
          return { privateKey, raw: Buffer.from("secret") };
        },
        async revokeInstallationToken() {
          revoked = true;
        },
        async runLocalTrainOpen() {
          throw new Error("lifecycle failed");
        },
        async verifyScopedToken() {},
      },
    ),
    /lifecycle failed/,
  );
  assert.equal(revoked, true);
});

test("двойной сбой сохраняет ошибки проверки и отзыва installation token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const raw = Buffer.from("sensitive-private-key-material");
  const primaryError = new Error("verify failed");
  const revocationError = new Error("revoke failed");
  await assert.rejects(
    runLocalBootstrap(
      {
        confirmation: null,
        mode: "verify",
        privateKeyPath: "/private/key.pem",
      },
      {
        async createScopedInstallationToken() {
          return tokenResponse();
        },
        currentTime: NOW,
        async inspectOwnerPlatformContext() {
          return {
            actorId: CURRENT_LIFECYCLE_OWNER_ID,
            actorLogin: "Etogerman",
            platformContext: {
              defaultBranch: "main",
              organizationPlan: "team",
              repository: ACADEMY_REPOSITORY,
              repositoryVisibility: "private",
            },
          };
        },
        async inspectTrustedCheckout() {
          return {
            gitDirectory: "/repo/.git",
            mainSha: MAIN_SHA,
            repositoryRoot: "/repo",
          };
        },
        installationApi: {},
        async readPrivateKeyFile() {
          return { privateKey, raw };
        },
        async revokeInstallationToken() {
          throw revocationError;
        },
        async verifyScopedToken() {
          throw primaryError;
        },
      },
    ),
    (error) => {
      assert.equal(error.code, "LOCAL_INSTALLATION_TOKEN_REVOCATION_FAILED");
      assert.ok(error.cause instanceof AggregateError);
      assert.deepEqual(error.cause.errors, [primaryError, revocationError]);
      return true;
    },
  );
  assert.deepEqual(raw, Buffer.alloc(raw.length));
});

test("private key с групповым чтением отклоняется", async () => {
  const root = await mkdtemp(join(tmpdir(), "academy-train-key-"));
  const path = join(root, "app.pem");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(
    path,
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  try {
    await chmod(path, 0o640);
    await assert.rejects(
      runLocalBootstrap(
        {
          confirmation: null,
          mode: "verify",
          privateKeyPath: path,
        },
        {
          async inspectOwnerPlatformContext() {
            return {};
          },
          async inspectTrustedCheckout() {
            return {};
          },
        },
      ),
      { code: "LOCAL_PRIVATE_KEY_PERMISSIONS_INVALID" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
