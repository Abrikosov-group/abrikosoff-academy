import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_REPOSITORY,
  CURRENT_BOOTSTRAP_TRAIN,
  CURRENT_LIFECYCLE_APP,
  CURRENT_LIFECYCLE_OWNER_ID,
  ENVIRONMENT_ADMIN_BYPASS_POLICIES,
  LIFECYCLE_INVOCATION_KINDS,
  SOURCE_BRANCH_REQUIRED_CHECKS,
  TRAIN_OPEN_CONFIRMATION,
} from "../../scripts/release-train/config.mjs";
import { GitHubApiError } from "../../scripts/release-train/github-api.mjs";
import {
  ensureRegistry,
  productionEnvironmentUpdatePayload,
  registryBranchProtectionPayload,
  retainedEnvironmentProtections,
  runTrainOpen,
  runLocalTrainOpen,
  sourceBranchProtectionPayload,
  validateEnvironment,
  validateEnvironmentProtectionsPreserved,
  validateLocalOwnerInvocation,
  validatePreTokenInvocation,
  validateRegistryBranchProtection,
  validateRegistryTreeEntries,
  validateSourceBranchProtection,
  validateTrustedInvocation,
} from "../../scripts/release-train/train-lifecycle.mjs";
import { createTrainOpenedEvent } from "../../scripts/release-train/registry.mjs";

const MAIN_SHA = "a".repeat(40);
const SOURCE_SHA = "b".repeat(40);
const TRAIN_ID = "11111111-1111-4111-8111-111111111111";
const APP_SLUG = "abrikosoff-release-lifecycle";

function trainOpenedEvent(overrides = {}) {
  return createTrainOpenedEvent({
    actorId: "123456",
    actorLogin: "owner",
    environmentAdminBypassPolicy:
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.FORBIDDEN,
    lifecycleInvocation: {
      kind: LIFECYCLE_INVOCATION_KINDS.GITHUB_ACTIONS,
      run_attempt: 1,
      run_id: "987654",
    },
    occurredAt: "2026-08-02T12:00:00.000Z",
    openedFromMainSha: CURRENT_BOOTSTRAP_TRAIN.openedFromMainSha,
    registrySequence: 1,
    sourceBranch: CURRENT_BOOTSTRAP_TRAIN.sourceBranch,
    trainId: TRAIN_ID,
    ...overrides,
  });
}

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

test("локальный invocation принимает только зафиксированного владельца и Team/private", () => {
  const invocation = {
    actorId: CURRENT_LIFECYCLE_OWNER_ID,
    actorLogin: "Etogerman",
    appSlug: CURRENT_LIFECYCLE_APP.slug,
    environmentAdminBypassPolicy:
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
    lifecycleInvocation: {
      kind: LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER,
      operation_id: "33333333-3333-4333-8333-333333333333",
    },
    mainSha: MAIN_SHA,
    platformContext: {
      defaultBranch: "main",
      organizationPlan: "team",
      repository: ACADEMY_REPOSITORY,
      repositoryVisibility: "private",
    },
  };
  assert.equal(validateLocalOwnerInvocation(invocation), invocation);
  assert.throws(
    () => validateLocalOwnerInvocation({ ...invocation, actorId: "999" }),
    { code: "TRUST_OWNER_MISMATCH" },
  );
  assert.throws(
    () =>
      validateLocalOwnerInvocation({
        ...invocation,
        platformContext: {
          ...invocation.platformContext,
          organizationPlan: "enterprise",
        },
      }),
    { code: "TEAM_PRIVATE_PLAN_MISMATCH" },
  );
});

test("payload защиты ветки требует PR, четыре CI и не включает linear history", () => {
  const payload = sourceBranchProtectionPayload();
  assert.equal(payload.enforce_admins, true);
  assert.equal(payload.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(payload.required_status_checks.checks.length, 4);
  assert.equal(
    Object.hasOwn(payload.required_status_checks, "contexts"),
    false,
  );
  assert.equal(payload.required_linear_history, false);
  assert.deepEqual(validateSourceBranchProtection(sourceProtectionResponse()), sourceProtectionResponse());

  const missingResponseContexts = sourceProtectionResponse();
  delete missingResponseContexts.required_status_checks.contexts;
  assert.throws(
    () => validateSourceBranchProtection(missingResponseContexts),
    { code: "SOURCE_PROTECTION_CONTEXTS" },
  );

  const unsafe = sourceProtectionResponse();
  unsafe.allow_force_pushes.enabled = true;
  assert.throws(() => validateSourceBranchProtection(unsafe), {
    code: "SOURCE_PROTECTION_FORCE_PUSH",
  });
});

test("защита ветки поезда требует явного отключения опасных параметров", () => {
  const disabledFields = [
    ["required_linear_history", "SOURCE_PROTECTION_LINEAR"],
    ["allow_force_pushes", "SOURCE_PROTECTION_FORCE_PUSH"],
    ["allow_deletions", "SOURCE_PROTECTION_DELETE"],
    ["lock_branch", "SOURCE_PROTECTION_LOCK"],
    ["allow_fork_syncing", "SOURCE_PROTECTION_FORK_SYNC"],
  ];

  for (const [field, code] of disabledFields) {
    const missing = sourceProtectionResponse();
    delete missing[field];
    assert.throws(() => validateSourceBranchProtection(missing), { code });

    const nullValue = sourceProtectionResponse();
    nullValue[field] = null;
    assert.throws(() => validateSourceBranchProtection(nullValue), { code });
  }
});

test("отсутствующий PR-bypass допустим, а некорректный тип отклоняется", () => {
  const omitted = sourceProtectionResponse();
  delete omitted.required_pull_request_reviews.bypass_pull_request_allowances;
  assert.doesNotThrow(() => validateSourceBranchProtection(omitted));

  const malformed = sourceProtectionResponse();
  malformed.required_pull_request_reviews.bypass_pull_request_allowances =
    "unknown";
  assert.throws(() => validateSourceBranchProtection(malformed), {
    code: "SOURCE_PROTECTION_BYPASS",
  });
});

test("защита ветки поезда принимает пропущенные отключённые push restrictions", () => {
  const response = sourceProtectionResponse();
  delete response.restrictions;

  assert.doesNotThrow(() => validateSourceBranchProtection(response));

  const enabledRestrictions = sourceProtectionResponse();
  enabledRestrictions.restrictions = { apps: [], teams: [], users: [] };
  assert.throws(() => validateSourceBranchProtection(enabledRestrictions), {
    code: "SOURCE_PROTECTION_RESTRICTIONS",
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

test("защита реестра принимает пропущенные GitHub поля отключённых правил", () => {
  const response = registryProtectionResponse();
  delete response.required_status_checks;
  delete response.required_pull_request_reviews;

  assert.doesNotThrow(() =>
    validateRegistryBranchProtection(response, APP_SLUG),
  );

  const enabledChecks = registryProtectionResponse();
  enabledChecks.required_status_checks = { strict: true };
  assert.throws(
    () => validateRegistryBranchProtection(enabledChecks, APP_SLUG),
    { code: "REGISTRY_PROTECTION_CHECKS" },
  );

  const enabledReviews = registryProtectionResponse();
  enabledReviews.required_pull_request_reviews = {
    required_approving_review_count: 1,
  };
  assert.throws(
    () => validateRegistryBranchProtection(enabledReviews, APP_SLUG),
    { code: "REGISTRY_PROTECTION_PR" },
  );
});

test("защита реестра требует явного отключения неприменимых параметров", () => {
  const disabledFields = [
    ["allow_force_pushes", "REGISTRY_PROTECTION_FORCE_PUSH"],
    ["allow_deletions", "REGISTRY_PROTECTION_DELETE"],
    [
      "required_conversation_resolution",
      "REGISTRY_PROTECTION_CONVERSATIONS",
    ],
    ["lock_branch", "REGISTRY_PROTECTION_LOCK"],
    ["allow_fork_syncing", "REGISTRY_PROTECTION_FORK_SYNC"],
  ];

  for (const [field, code] of disabledFields) {
    const missing = registryProtectionResponse();
    delete missing[field];
    assert.throws(
      () => validateRegistryBranchProtection(missing, APP_SLUG),
      { code },
    );

    const nullValue = registryProtectionResponse();
    nullValue[field] = null;
    assert.throws(
      () => validateRegistryBranchProtection(nullValue, APP_SLUG),
      { code },
    );
  }
});

test("повтор open восстанавливает защиту корректного пустого реестра", async () => {
  const emptyRegistry = {
    events: [],
    headSha: "c".repeat(40),
    headTreeSha: "d".repeat(40),
    state: { activeTrain: null },
  };
  let applyCount = 0;
  let loadCount = 0;

  const result = await ensureRegistry({}, APP_SLUG, {
    async applyBranchProtection(_api, branch, payload) {
      applyCount += 1;
      assert.equal(branch, "release-train-registry");
      assert.deepEqual(payload.restrictions.apps, [APP_SLUG]);
      return registryProtectionResponse();
    },
    async getBranchProtection() {
      throw new GitHubApiError({
        body: { message: "Not Found" },
        method: "GET",
        path: "/branches/release-train-registry/protection",
        response: { headers: new Headers(), status: 404 },
      });
    },
    async initializeRegistry() {
      assert.fail("существующий реестр не должен инициализироваться повторно");
    },
    async loadRegistry() {
      loadCount += 1;
      return emptyRegistry;
    },
  });

  assert.equal(result, emptyRegistry);
  assert.equal(applyCount, 1);
  assert.equal(loadCount, 2);
});

test("повтор open принимает уже защищённый пустой реестр с пропущенными полями", async () => {
  const emptyRegistry = {
    events: [],
    headSha: "c".repeat(40),
    headTreeSha: "d".repeat(40),
    state: { activeTrain: null },
  };
  const protection = registryProtectionResponse();
  delete protection.required_status_checks;
  delete protection.required_pull_request_reviews;

  const result = await ensureRegistry({}, APP_SLUG, {
    async applyBranchProtection() {
      assert.fail("корректную существующую защиту нельзя применять повторно");
    },
    async getBranchProtection() {
      return protection;
    },
    async initializeRegistry() {
      assert.fail("существующий реестр не должен инициализироваться повторно");
    },
    async loadRegistry() {
      return emptyRegistry;
    },
  });

  assert.equal(result, emptyRegistry);
});

test("защита непустого реестра не исправляется автоматически", async () => {
  let applyCount = 0;
  const activeTrain = trainOpenedEvent();
  const unsafe = registryProtectionResponse();
  unsafe.allow_force_pushes.enabled = true;

  await assert.rejects(
    ensureRegistry({}, APP_SLUG, {
      async applyBranchProtection() {
        applyCount += 1;
        return registryProtectionResponse();
      },
      async getBranchProtection() {
        return unsafe;
      },
      async loadRegistry() {
        return {
          events: [activeTrain],
          headSha: "c".repeat(40),
          headTreeSha: "d".repeat(40),
          state: { activeTrain },
        };
      },
    }),
    { code: "REGISTRY_PROTECTION_FORCE_PUSH" },
  );
  assert.equal(applyCount, 0);
});

test("восстановление защиты отклоняет изменение пустого реестра", async () => {
  const original = {
    events: [],
    headSha: "c".repeat(40),
    headTreeSha: "d".repeat(40),
    state: { activeTrain: null },
  };
  let loadCount = 0;

  await assert.rejects(
    ensureRegistry({}, APP_SLUG, {
      async applyBranchProtection() {
        return registryProtectionResponse();
      },
      async getBranchProtection() {
        throw new GitHubApiError({
          body: { message: "Not Found" },
          method: "GET",
          path: "/branches/release-train-registry/protection",
          response: { headers: new Headers(), status: 404 },
        });
      },
      async loadRegistry() {
        loadCount += 1;
        return loadCount === 1
          ? original
          : { ...original, headSha: "e".repeat(40) };
      },
    }),
    { code: "REGISTRY_CHANGED_DURING_PROTECTION_REPAIR" },
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

test("Team/private-профиль принимает неизбежный admin bypass только локально", () => {
  const environment = {
    can_admins_bypass: true,
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
    name: "production",
  };
  const context = {
    environmentAdminBypassPolicy:
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
    platformContext: {
      defaultBranch: "main",
      organizationPlan: "team",
      repository: ACADEMY_REPOSITORY,
      repositoryVisibility: "private",
    },
  };
  assert.doesNotThrow(() =>
    validateEnvironment(
      environment,
      [{ name: "main", type: "branch" }],
      context,
    ),
  );
  assert.throws(
    () =>
      validateEnvironment(environment, [{ name: "main", type: "branch" }], {
        ...context,
        platformContext: {
          ...context.platformContext,
          repositoryVisibility: "public",
        },
      }),
    { code: "TEAM_PRIVATE_REPOSITORY_MISMATCH" },
  );
  assert.throws(
    () =>
      validateEnvironment(
        { ...environment, can_admins_bypass: false },
        [{ name: "main", type: "branch" }],
        context,
      ),
    { code: "TEAM_PRIVATE_ADMIN_BYPASS_STATE_MISMATCH" },
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
    async getBranchProtection(_api, branch) {
      trace.push(`verify-protection:${branch}`);
      return branch === "release-train-registry"
        ? registryProtectionResponse()
        : sourceProtectionResponse();
    },
    async getRef(_api, branch) {
      trace.push(`ref:${branch}`);
      return {
        sha: branch === "main" ? MAIN_SHA : SOURCE_SHA,
      };
    },
    async loadRegistry() {
      trace.push("load-registry");
      return null;
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

test("локальный open пишет честное происхождение операции и Team/private-политику", async () => {
  const trace = [];
  const invocation = {
    actorId: CURRENT_LIFECYCLE_OWNER_ID,
    actorLogin: "Etogerman",
    appSlug: CURRENT_LIFECYCLE_APP.slug,
    environmentAdminBypassPolicy:
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
    lifecycleInvocation: {
      kind: LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER,
      operation_id: "33333333-3333-4333-8333-333333333333",
    },
    mainSha: MAIN_SHA,
    platformContext: {
      defaultBranch: "main",
      organizationPlan: "team",
      repository: ACADEMY_REPOSITORY,
      repositoryVisibility: "private",
    },
  };
  const services = orchestrationServices(trace, {
    async appendOpenedEvent(_api, _registry, event) {
      trace.push("append");
      assert.deepEqual(event.lifecycle_invocation, invocation.lifecycleInvocation);
      assert.equal(
        event.environment_admin_bypass_policy,
        ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
      );
    },
    async configureProductionEnvironment(_api, context) {
      trace.push("environment");
      assert.deepEqual(context, {
        environmentAdminBypassPolicy:
          ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
        platformContext: invocation.platformContext,
      });
    },
  });

  const result = await runLocalTrainOpen(invocation, {
    api: {},
    now: () => "2026-08-03T12:00:00.000Z",
    randomUUID: () => TRAIN_ID,
    services,
  });
  assert.equal(result.trainId, TRAIN_ID);
  assert.equal(trace.at(-1), "append");
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

test("повтор того же lifecycle run подтверждает уже записанный train_opened", async () => {
  const trace = [];
  const activeTrain = trainOpenedEvent();
  const services = orchestrationServices(trace, {
    async ensureRegistry() {
      assert.fail("для подтверждения записанного события мутации не нужны");
    },
    async loadRegistry() {
      trace.push("load-registry-active");
      return {
        events: [activeTrain],
        headSha: "c".repeat(40),
        headTreeSha: "d".repeat(40),
        state: { activeTrain },
      };
    },
  });

  const result = await runTrainOpen(
    trustedEnv({ GITHUB_RUN_ATTEMPT: "2" }),
    {
      api: {},
      randomUUID() {
        assert.fail("при подтверждении существующего события новый UUID не нужен");
      },
      services,
      skipOutput: true,
    },
  );

  assert.deepEqual(result, {
    openedFromMainSha: CURRENT_BOOTSTRAP_TRAIN.openedFromMainSha,
    sourceBranch: CURRENT_BOOTSTRAP_TRAIN.sourceBranch,
    sourceSha: CURRENT_BOOTSTRAP_TRAIN.expectedHeadSha,
    trainId: TRAIN_ID,
  });
  assert.deepEqual(trace, [
    "app-scope",
    "load-registry-active",
    "verify-protection:release-train-registry",
    "load-registry-active",
  ]);
});

test("активный поезд другого lifecycle run остаётся блокирующим", async () => {
  const trace = [];
  const activeTrain = trainOpenedEvent({
    lifecycleInvocation: {
      kind: LIFECYCLE_INVOCATION_KINDS.GITHUB_ACTIONS,
      run_attempt: 1,
      run_id: "111111",
    },
  });
  const services = orchestrationServices(trace, {
    async loadRegistry() {
      return {
        events: [activeTrain],
        headSha: "c".repeat(40),
        headTreeSha: "d".repeat(40),
        state: { activeTrain },
      };
    },
  });

  await assert.rejects(
    runTrainOpen(trustedEnv(), {
      api: {},
      randomUUID: () => TRAIN_ID,
      services,
      skipOutput: true,
    }),
    { code: "TRAIN_ALREADY_ACTIVE" },
  );
  assert.equal(trace.includes("append"), false);
});

test("событие того же lifecycle run с другим actor не подтверждается", async () => {
  const trace = [];
  const activeTrain = trainOpenedEvent({ actorId: "999999" });
  const services = orchestrationServices(trace, {
    async loadRegistry() {
      return {
        events: [activeTrain],
        headSha: "c".repeat(40),
        headTreeSha: "d".repeat(40),
        state: { activeTrain },
      };
    },
  });

  await assert.rejects(
    runTrainOpen(trustedEnv({ GITHUB_RUN_ATTEMPT: "2" }), {
      api: {},
      randomUUID: () => TRAIN_ID,
      services,
      skipOutput: true,
    }),
    { code: "TRAIN_OPEN_REPLAY_MISMATCH" },
  );
  assert.equal(trace.includes("append"), false);
});
