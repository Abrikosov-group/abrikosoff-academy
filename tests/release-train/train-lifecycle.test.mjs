import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_REPOSITORY,
  SOURCE_BRANCH_REQUIRED_CHECKS,
  TRAIN_OPEN_CONFIRMATION,
} from "../../scripts/release-train/config.mjs";
import {
  productionEnvironmentUpdatePayload,
  registryBranchProtectionPayload,
  retainedEnvironmentProtections,
  runTrainOpen,
  sourceBranchProtectionPayload,
  validateEnvironment,
  validateEnvironmentProtectionsPreserved,
  validatePreTokenInvocation,
  validateRegistryBranchProtection,
  validateRegistryTreeEntries,
  validateSourceBranchProtection,
  validateTrustedInvocation,
} from "../../scripts/release-train/train-lifecycle.mjs";

const MAIN_SHA = "a".repeat(40);
const SOURCE_SHA = "b".repeat(40);
const TRAIN_ID = "11111111-1111-4111-8111-111111111111";
const APP_SLUG = "abrikosoff-release-lifecycle";

function trustedEnv(overrides = {}) {
  return {
    GITHUB_ACTOR: "owner",
    GITHUB_ACTOR_ID: "123456",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: ACADEMY_REPOSITORY,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "987654",
    GITHUB_SHA: MAIN_SHA,
    GITHUB_TRIGGERING_ACTOR: "owner",
    GITHUB_WORKFLOW_REF: `${ACADEMY_REPOSITORY}/.github/workflows/train-lifecycle.yml@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: MAIN_SHA,
    TRAIN_CONFIRMATION: TRAIN_OPEN_CONFIRMATION,
    TRAIN_LIFECYCLE_APP_SLUG: APP_SLUG,
    TRAIN_LIFECYCLE_OWNER_ID: "123456",
    TRAIN_LIFECYCLE_TOKEN: "test-token",
    TRAIN_OPEN_MODE: "register_existing",
    ...overrides,
  };
}

function sourceProtectionResponse() {
  return {
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_fork_syncing: { enabled: false },
    block_creations: { enabled: true },
    enforce_admins: { enabled: true },
    lock_branch: { enabled: false },
    required_conversation_resolution: { enabled: true },
    required_linear_history: { enabled: false },
    required_pull_request_reviews: {
      bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
      required_approving_review_count: 0,
    },
    required_status_checks: {
      checks: SOURCE_BRANCH_REQUIRED_CHECKS,
      contexts: SOURCE_BRANCH_REQUIRED_CHECKS.map((check) => check.context),
      strict: true,
    },
    restrictions: null,
  };
}

function registryProtectionResponse() {
  return {
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_fork_syncing: { enabled: false },
    block_creations: { enabled: true },
    enforce_admins: { enabled: true },
    lock_branch: { enabled: false },
    required_conversation_resolution: { enabled: false },
    required_linear_history: { enabled: true },
    required_pull_request_reviews: null,
    required_status_checks: null,
    restrictions: {
      apps: [{ slug: APP_SLUG }],
      teams: [],
      users: [],
    },
  };
}

test("trusted invocation привязан к main, владельцу и точному workflow SHA", () => {
  const preflight = validatePreTokenInvocation(
    trustedEnv({
      TRAIN_LIFECYCLE_APP_SLUG: undefined,
      TRAIN_LIFECYCLE_TOKEN: undefined,
    }),
  );
  assert.equal(preflight.mainSha, MAIN_SHA);

  const result = validateTrustedInvocation(trustedEnv());
  assert.equal(result.mainSha, MAIN_SHA);
  assert.equal(result.actorId, "123456");

  assert.throws(
    () => validateTrustedInvocation(trustedEnv({ GITHUB_ACTOR_ID: "999" })),
    { code: "TRUST_OWNER_MISMATCH" },
  );
  assert.throws(
    () =>
      validateTrustedInvocation(
        trustedEnv({ GITHUB_WORKFLOW_SHA: "c".repeat(40) }),
      ),
    { code: "TRUST_WORKFLOW_SHA_MISMATCH" },
  );
  assert.throws(
    () =>
      validateTrustedInvocation(
        trustedEnv({ GITHUB_TRIGGERING_ACTOR: "another-user" }),
      ),
    { code: "TRUST_RERUN_ACTOR_MISMATCH" },
  );
  assert.throws(
    () =>
      validateTrustedInvocation(
        trustedEnv({ TRAIN_LIFECYCLE_TOKEN: undefined }),
      ),
    { code: "LIFECYCLE_TOKEN_MISSING" },
  );
});

test("payload защиты ветки требует PR, четыре CI и не включает linear history", () => {
  const payload = sourceBranchProtectionPayload();
  assert.equal(payload.enforce_admins, true);
  assert.equal(payload.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(payload.required_status_checks.checks.length, 4);
  assert.deepEqual(payload.required_status_checks.contexts, []);
  assert.equal(payload.required_linear_history, false);
  assert.deepEqual(validateSourceBranchProtection(sourceProtectionResponse()), sourceProtectionResponse());

  const unsafe = sourceProtectionResponse();
  unsafe.allow_force_pushes.enabled = true;
  assert.throws(() => validateSourceBranchProtection(unsafe), {
    code: "SOURCE_PROTECTION_FORCE_PUSH",
  });
});

test("ветка реестра разрешает запись только отдельному GitHub App", () => {
  const payload = registryBranchProtectionPayload(APP_SLUG);
  assert.deepEqual(payload.restrictions.apps, [APP_SLUG]);
  assert.equal(payload.required_linear_history, true);
  assert.deepEqual(
    validateRegistryBranchProtection(registryProtectionResponse(), APP_SLUG),
    registryProtectionResponse(),
  );

  const unsafe = registryProtectionResponse();
  unsafe.restrictions.users.push({ login: "owner" });
  assert.throws(
    () => validateRegistryBranchProtection(unsafe, APP_SLUG),
    { code: "REGISTRY_PROTECTION_USERS" },
  );
});

test("Git tree реестра отклоняет посторонние пустые директории", () => {
  assert.deepEqual(
    validateRegistryTreeEntries([
      { mode: "100644", path: "registry.json", type: "blob" },
      { mode: "040000", path: "events", type: "tree" },
      {
        mode: "100644",
        path: "events/00000001-train_opened-example.json",
        type: "blob",
      },
    ]).map((entry) => entry.path),
    ["registry.json", "events/00000001-train_opened-example.json"],
  );
  assert.throws(
    () =>
      validateRegistryTreeEntries([
        { mode: "100644", path: "registry.json", type: "blob" },
        { mode: "040000", path: "hidden", type: "tree" },
      ]),
    { code: "REGISTRY_TREE_STRUCTURE_INVALID" },
  );
});

test("production Environment допускает только main и запрещает admin bypass", () => {
  const environment = {
    can_admins_bypass: false,
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
    name: "production",
  };
  assert.doesNotThrow(() =>
    validateEnvironment(environment, [{ name: "main", type: "branch" }]),
  );
  assert.throws(
    () => validateEnvironment({ ...environment, can_admins_bypass: true }, []),
    { code: "ENVIRONMENT_ADMIN_BYPASS_ENABLED" },
  );
  assert.throws(
    () =>
      validateEnvironment(environment, [
        { name: "main", type: "branch" },
        { name: "codex/*", type: "branch" },
      ]),
    { code: "ENVIRONMENT_MAIN_POLICY_INVALID" },
  );
});

test("изменение branch policy сохраняет wait timer и required reviewers", () => {
  const before = {
    protection_rules: [
      { type: "branch_policy" },
      { type: "wait_timer", wait_timer: 15 },
      {
        prevent_self_review: true,
        reviewers: [
          { reviewer: { id: 20 }, type: "Team" },
          { reviewer: { id: 10 }, type: "User" },
        ],
        type: "required_reviewers",
      },
    ],
  };
  assert.deepEqual(retainedEnvironmentProtections(before), {
    requiredReviewers: {
      preventSelfReview: true,
      reviewers: [
        { id: 20, type: "Team" },
        { id: 10, type: "User" },
      ],
    },
    waitTimer: 15,
  });
  assert.deepEqual(productionEnvironmentUpdatePayload(before), {
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
    prevent_self_review: true,
    reviewers: [
      { id: 20, type: "Team" },
      { id: 10, type: "User" },
    ],
    wait_timer: 15,
  });

  const after = {
    protection_rules: [
      {
        prevent_self_review: true,
        reviewers: [
          { reviewer: { id: 10 }, type: "User" },
          { reviewer: { id: 20 }, type: "Team" },
        ],
        type: "required_reviewers",
      },
      { type: "wait_timer", wait_timer: 15 },
      { type: "branch_policy" },
    ],
  };
  assert.equal(validateEnvironmentProtectionsPreserved(before, after), after);
  assert.throws(
    () =>
      retainedEnvironmentProtections({
        protection_rules: [{ type: "custom_protection_rule" }],
      }),
    { code: "ENVIRONMENT_PROTECTION_RULE_UNSUPPORTED" },
  );
  assert.throws(
    () =>
      validateEnvironmentProtectionsPreserved(before, {
        protection_rules: [{ type: "branch_policy" }],
      }),
    { code: "ENVIRONMENT_PROTECTIONS_CHANGED" },
  );
});

function orchestrationServices(trace, overrides = {}) {
  return {
    async appendOpenedEvent(_api, registry, event) {
      trace.push("append");
      assert.equal(registry.events.length, 0);
      assert.equal(event.event, "train_opened");
      assert.equal(event.train_id, TRAIN_ID);
    },
    async applyBranchProtection(_api, branch, payload) {
      trace.push("protect-source");
      assert.equal(branch, "codex/admin-operational-mvp");
      assert.equal(payload.enforce_admins, true);
      return sourceProtectionResponse();
    },
    async assertAppRepositoryScope() {
      trace.push("app-scope");
    },
    async configureProductionEnvironment() {
      trace.push("environment");
    },
    async ensureRegistry() {
      trace.push("registry");
      return {
        events: [],
        headSha: "c".repeat(40),
        headTreeSha: "d".repeat(40),
        state: { activeTrain: null },
      };
    },
    async getBranchProtection() {
      trace.push("verify-source-protection");
      return sourceProtectionResponse();
    },
    async getRef(_api, branch) {
      trace.push(`ref:${branch}`);
      return {
        sha: branch === "main" ? MAIN_SHA : SOURCE_SHA,
      };
    },
    async prepareSourceBranch() {
      trace.push("prepare-source");
      return {
        openedFromMainSha: "e".repeat(40),
        sourceBranch: "codex/admin-operational-mvp",
        sourceSha: SOURCE_SHA,
      };
    },
    ...overrides,
  };
}

test("train_opened записывается последним после повторной проверки main и защиты", async () => {
  const trace = [];
  const result = await runTrainOpen(trustedEnv(), {
    api: {},
    now: () => "2026-08-02T12:00:00.000Z",
    randomUUID: () => TRAIN_ID,
    services: orchestrationServices(trace),
    skipOutput: true,
  });

  assert.equal(result.trainId, TRAIN_ID);
  assert.equal(trace.at(-1), "append");
  assert.ok(trace.indexOf("environment") < trace.indexOf("append"));
  assert.ok(trace.indexOf("protect-source") < trace.indexOf("append"));
  assert.ok(trace.lastIndexOf("ref:main") < trace.indexOf("append"));
});

test("ошибка production Environment не создаёт train_opened", async () => {
  const trace = [];
  const services = orchestrationServices(trace, {
    async configureProductionEnvironment() {
      trace.push("environment-failed");
      throw new Error("environment failed");
    },
  });

  await assert.rejects(
    runTrainOpen(trustedEnv(), {
      api: {},
      randomUUID: () => TRAIN_ID,
      services,
      skipOutput: true,
    }),
    /environment failed/,
  );
  assert.equal(trace.includes("append"), false);
});
