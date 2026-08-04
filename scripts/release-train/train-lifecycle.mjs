import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  ACADEMY_REPOSITORY,
  CURRENT_BOOTSTRAP_TRAIN,
  CURRENT_LIFECYCLE_APP,
  CURRENT_LIFECYCLE_OWNER_ID,
  DEFAULT_BRANCH,
  ENVIRONMENT_ADMIN_BYPASS_POLICIES,
  LIFECYCLE_INVOCATION_KINDS,
  MAX_GITHUB_PAGES,
  MAX_REGISTRY_COMMITS,
  PRODUCTION_ENVIRONMENT,
  REGISTRY_BRANCH,
  REGISTRY_METADATA,
  REGISTRY_METADATA_PATH,
  SOURCE_BRANCH_REQUIRED_CHECKS,
  TRAIN_OPEN_CONFIRMATION,
} from "./config.mjs";
import { ReleaseGateError, assertGate, formatGateError } from "./errors.mjs";
import { GitHubApi, GitHubApiError } from "./github-api.mjs";
import {
  canonicalJson,
  createTrainOpenedEvent,
  eventPath,
  validateAppendOnlyHistory,
  validateEventFiles,
  validateLifecycleInvocation,
  validateRegistryEvents,
  validateRegistryMetadata,
} from "./registry.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const MAX_BLOB_BYTES = 64 * 1024;

function encodeBranch(branch) {
  return encodeURIComponent(branch);
}

function gitRefPath(branch) {
  return `heads/${branch}`;
}

function enabled(value) {
  return value?.enabled === true;
}

function disabled(value) {
  return value?.enabled === false;
}

function omittedOrNull(value) {
  return value === undefined || value === null;
}

function actorListEmpty(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  return ["apps", "teams", "users"].every(
    (key) => Array.isArray(value[key]) && value[key].length === 0,
  );
}

function sortedChecks(checks) {
  return checks
    .map((check) => ({
      app_id: Number(check.app_id),
      context: check.context,
    }))
    .sort((left, right) => left.context.localeCompare(right.context));
}

function sameChecks(actual, expected) {
  const left = sortedChecks(actual);
  const right = sortedChecks(expected);
  return (
    left.length === right.length &&
    left.every(
      (check, index) =>
        check.app_id === right[index].app_id &&
        check.context === right[index].context,
    )
  );
}

function sameContexts(actual, expectedChecks) {
  const left = [...actual].sort((a, b) => a.localeCompare(b));
  const right = expectedChecks
    .map((check) => check.context)
    .sort((a, b) => a.localeCompare(b));
  return (
    left.length === right.length &&
    left.every((context, index) => context === right[index])
  );
}

export function sourceBranchProtectionPayload() {
  return {
    allow_deletions: false,
    allow_force_pushes: false,
    allow_fork_syncing: false,
    block_creations: false,
    enforce_admins: true,
    lock_branch: false,
    required_conversation_resolution: true,
    required_linear_history: false,
    required_pull_request_reviews: {
      bypass_pull_request_allowances: {
        apps: [],
        teams: [],
        users: [],
      },
      dismiss_stale_reviews: true,
      dismissal_restrictions: {
        apps: [],
        teams: [],
        users: [],
      },
      require_code_owner_reviews: false,
      require_last_push_approval: false,
      required_approving_review_count: 0,
    },
    required_status_checks: {
      checks: SOURCE_BRANCH_REQUIRED_CHECKS,
      strict: true,
    },
    restrictions: null,
  };
}

export function registryBranchProtectionPayload(appSlug) {
  assertGate(
    APP_SLUG_PATTERN.test(appSlug ?? ""),
    "LIFECYCLE_APP_SLUG_INVALID",
    "Slug служебного GitHub App имеет недопустимый формат",
  );
  return {
    allow_deletions: false,
    allow_force_pushes: false,
    allow_fork_syncing: false,
    block_creations: true,
    enforce_admins: true,
    lock_branch: false,
    required_conversation_resolution: false,
    required_linear_history: true,
    required_pull_request_reviews: null,
    required_status_checks: null,
    restrictions: {
      apps: [appSlug],
      teams: [],
      users: [],
    },
  };
}

export function validateSourceBranchProtection(protection) {
  assertGate(enabled(protection?.enforce_admins), "SOURCE_PROTECTION_ADMINS", "Защита ветки не применяется к администраторам");
  assertGate(protection?.required_status_checks?.strict === true, "SOURCE_PROTECTION_STRICT", "Required checks не требуют актуальную базу");
  assertGate(
    sameChecks(protection?.required_status_checks?.checks ?? [], SOURCE_BRANCH_REQUIRED_CHECKS),
    "SOURCE_PROTECTION_CHECKS",
    "Набор обязательных CI-проверок ветки не совпадает с контрактом",
  );
  assertGate(
    sameContexts(
      protection?.required_status_checks?.contexts ?? [],
      SOURCE_BRANCH_REQUIRED_CHECKS,
    ),
    "SOURCE_PROTECTION_CONTEXTS",
    "Список required check contexts отличается от точного набора CI",
  );
  const reviews = protection?.required_pull_request_reviews;
  assertGate(reviews && typeof reviews === "object", "SOURCE_PROTECTION_PR", "Изменения ветки не требуют pull request");
  assertGate(reviews.dismiss_stale_reviews === true, "SOURCE_PROTECTION_STALE", "Устаревшие approvals не сбрасываются");
  assertGate(reviews.require_code_owner_reviews === false, "SOURCE_PROTECTION_CODEOWNERS", "Code Owner approval неожиданно включён");
  assertGate(reviews.require_last_push_approval === false, "SOURCE_PROTECTION_LAST_PUSH", "Настройка last-push approval отличается от контракта");
  assertGate(Number(reviews.required_approving_review_count) === 0, "SOURCE_PROTECTION_REVIEW_COUNT", "Число обязательных approvals отличается от контракта");
  assertGate(actorListEmpty(reviews.bypass_pull_request_allowances), "SOURCE_PROTECTION_BYPASS", "Обнаружен PR-bypass для ветки поезда");
  assertGate(omittedOrNull(protection?.restrictions), "SOURCE_PROTECTION_RESTRICTIONS", "Push restrictions ветки поезда отличаются от контракта");
  assertGate(enabled(protection?.required_conversation_resolution), "SOURCE_PROTECTION_CONVERSATIONS", "Не требуется закрытие обсуждений");
  assertGate(disabled(protection?.required_linear_history), "SOURCE_PROTECTION_LINEAR", "Линейная история блокирует обязательные sync merge-коммиты");
  assertGate(disabled(protection?.allow_force_pushes), "SOURCE_PROTECTION_FORCE_PUSH", "Force-push разрешён");
  assertGate(disabled(protection?.allow_deletions), "SOURCE_PROTECTION_DELETE", "Удаление ветки разрешено");
  assertGate(disabled(protection?.block_creations), "SOURCE_PROTECTION_CREATION", "Запрет создания веток несовместим с отключёнными push restrictions");
  assertGate(disabled(protection?.lock_branch), "SOURCE_PROTECTION_LOCK", "Ветка ошибочно заблокирована для PR-слияний");
  assertGate(disabled(protection?.allow_fork_syncing), "SOURCE_PROTECTION_FORK_SYNC", "Fork syncing неожиданно разрешён");
  return protection;
}

export function validateRegistryBranchProtection(protection, appSlug) {
  assertGate(enabled(protection?.enforce_admins), "REGISTRY_PROTECTION_ADMINS", "Защита реестра не применяется к администраторам");
  assertGate(omittedOrNull(protection?.required_status_checks), "REGISTRY_PROTECTION_CHECKS", "Реестр не должен зависеть от CI ветки данных");
  assertGate(omittedOrNull(protection?.required_pull_request_reviews), "REGISTRY_PROTECTION_PR", "Реестр должен изменяться только служебным App, без PR");
  assertGate(enabled(protection?.required_linear_history), "REGISTRY_PROTECTION_LINEAR", "Реестр не требует линейную историю");
  assertGate(disabled(protection?.allow_force_pushes), "REGISTRY_PROTECTION_FORCE_PUSH", "Force-push в реестр разрешён");
  assertGate(disabled(protection?.allow_deletions), "REGISTRY_PROTECTION_DELETE", "Удаление реестра разрешено");
  assertGate(enabled(protection?.block_creations), "REGISTRY_PROTECTION_CREATION", "Повторное создание ветки реестра не заблокировано");
  assertGate(disabled(protection?.required_conversation_resolution), "REGISTRY_PROTECTION_CONVERSATIONS", "Реестр ошибочно зависит от PR-обсуждений");
  assertGate(disabled(protection?.lock_branch), "REGISTRY_PROTECTION_LOCK", "Ветка реестра заблокирована для служебной записи");
  assertGate(disabled(protection?.allow_fork_syncing), "REGISTRY_PROTECTION_FORK_SYNC", "Fork syncing реестра неожиданно разрешён");
  const restrictions = protection?.restrictions;
  assertGate(restrictions && typeof restrictions === "object", "REGISTRY_PROTECTION_RESTRICTIONS", "У реестра отсутствуют push restrictions");
  assertGate(Array.isArray(restrictions.users) && restrictions.users.length === 0, "REGISTRY_PROTECTION_USERS", "Пользователь может писать в реестр");
  assertGate(Array.isArray(restrictions.teams) && restrictions.teams.length === 0, "REGISTRY_PROTECTION_TEAMS", "Команда может писать в реестр");
  assertGate(
    Array.isArray(restrictions.apps) &&
      restrictions.apps.length === 1 &&
      restrictions.apps[0]?.slug === appSlug,
    "REGISTRY_PROTECTION_APP",
    "Право записи в реестр не ограничено точным служебным GitHub App",
  );
  return protection;
}

export function validatePreTokenInvocation(env) {
  assertGate(
    env.GITHUB_REPOSITORY === ACADEMY_REPOSITORY,
    "TRUST_REPOSITORY_MISMATCH",
    "Lifecycle запущен не в доверенном репозитории",
  );
  assertGate(
    env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "TRUST_EVENT_REJECTED",
    "Начальный open разрешён только через workflow_dispatch",
  );
  assertGate(
    env.GITHUB_REF === `refs/heads/${DEFAULT_BRANCH}`,
    "TRUST_REF_REJECTED",
    `Lifecycle должен выполняться из refs/heads/${DEFAULT_BRANCH}`,
  );
  assertGate(
    SHA_PATTERN.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA,
    "TRUST_WORKFLOW_SHA_MISMATCH",
    "Workflow и checkout должны происходить из одного точного SHA main",
  );
  assertGate(
    env.GITHUB_WORKFLOW_REF ===
      `${ACADEMY_REPOSITORY}/.github/workflows/train-lifecycle.yml@refs/heads/${DEFAULT_BRANCH}`,
    "TRUST_WORKFLOW_REF_MISMATCH",
    "Определение lifecycle загружено не из доверенного workflow ветки main",
  );
  assertGate(
    typeof env.TRAIN_LIFECYCLE_OWNER_ID === "string" &&
      /^\d+$/.test(env.TRAIN_LIFECYCLE_OWNER_ID) &&
      env.GITHUB_ACTOR_ID === env.TRAIN_LIFECYCLE_OWNER_ID,
    "TRUST_OWNER_MISMATCH",
    "Lifecycle запущен не владельцем с зафиксированным GitHub actor ID",
  );
  assertGate(
    env.GITHUB_ACTOR === env.GITHUB_TRIGGERING_ACTOR,
    "TRUST_RERUN_ACTOR_MISMATCH",
    "Повторный запуск выполнен другим GitHub actor",
  );
  assertGate(
    typeof env.GITHUB_ACTOR === "string" &&
      /^[A-Za-z0-9-]{1,39}$/.test(env.GITHUB_ACTOR),
    "TRUST_ACTOR_INVALID",
    "GitHub actor имеет недопустимый формат",
  );
  assertGate(
    typeof env.GITHUB_RUN_ID === "string" && /^\d+$/.test(env.GITHUB_RUN_ID),
    "TRUST_RUN_ID_INVALID",
    "GITHUB_RUN_ID имеет недопустимый формат",
  );
  assertGate(
    typeof env.GITHUB_RUN_ATTEMPT === "string" &&
      /^\d+$/.test(env.GITHUB_RUN_ATTEMPT) &&
      Number(env.GITHUB_RUN_ATTEMPT) > 0,
    "TRUST_RUN_ATTEMPT_INVALID",
    "GITHUB_RUN_ATTEMPT имеет недопустимый формат",
  );
  assertGate(
    env.TRAIN_OPEN_MODE === "register_existing",
    "TRAIN_OPEN_MODE_INVALID",
    "Начальный lifecycle разрешает только регистрацию существующего поезда",
  );
  assertGate(
    env.TRAIN_CONFIRMATION === TRAIN_OPEN_CONFIRMATION,
    "TRAIN_OPEN_CONFIRMATION_INVALID",
    "Текст явного подтверждения не совпадает",
  );
  return {
    actorId: env.GITHUB_ACTOR_ID,
    actorLogin: env.GITHUB_ACTOR,
    environmentAdminBypassPolicy:
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.FORBIDDEN,
    lifecycleInvocation: {
      kind: LIFECYCLE_INVOCATION_KINDS.GITHUB_ACTIONS,
      run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
      run_id: env.GITHUB_RUN_ID,
    },
    mainSha: env.GITHUB_SHA,
  };
}

export function validateTrustedInvocation(env) {
  const invocation = validatePreTokenInvocation(env);
  assertGate(
    APP_SLUG_PATTERN.test(env.TRAIN_LIFECYCLE_APP_SLUG ?? "") &&
      env.TRAIN_LIFECYCLE_APP_SLUG !== "github-actions",
    "LIFECYCLE_APP_SLUG_INVALID",
    "Не задан отдельный служебный GitHub App",
  );
  assertGate(
    typeof env.TRAIN_LIFECYCLE_TOKEN === "string" &&
      env.TRAIN_LIFECYCLE_TOKEN.length > 0,
    "LIFECYCLE_TOKEN_MISSING",
    "Не создан installation token служебного GitHub App",
  );
  return {
    ...invocation,
    appSlug: env.TRAIN_LIFECYCLE_APP_SLUG,
  };
}

export function validateTeamPrivatePlatformContext(context) {
  assertGate(
    context?.organizationPlan === "team",
    "TEAM_PRIVATE_PLAN_MISMATCH",
    "Локальный профиль разрешён только для организации на плане GitHub Team",
  );
  assertGate(
    context?.repository === ACADEMY_REPOSITORY &&
      context?.repositoryVisibility === "private" &&
      context?.defaultBranch === DEFAULT_BRANCH,
    "TEAM_PRIVATE_REPOSITORY_MISMATCH",
    "Локальный профиль разрешён только для private-репозитория Академии с main по умолчанию",
  );
  return context;
}

export function validateLocalOwnerInvocation(invocation) {
  assertGate(
    invocation?.actorId === CURRENT_LIFECYCLE_OWNER_ID,
    "TRUST_OWNER_MISMATCH",
    "Локальный lifecycle запущен не зафиксированным владельцем",
  );
  assertGate(
    typeof invocation?.actorLogin === "string" &&
      /^[A-Za-z0-9-]{1,39}$/.test(invocation.actorLogin),
    "TRUST_ACTOR_INVALID",
    "GitHub actor локальной операции имеет недопустимый формат",
  );
  assertGate(
    SHA_PATTERN.test(invocation?.mainSha ?? ""),
    "TRUST_MAIN_SHA_INVALID",
    "Локальная операция не привязана к точному SHA main",
  );
  assertGate(
    invocation?.appSlug === CURRENT_LIFECYCLE_APP.slug,
    "LIFECYCLE_APP_SLUG_INVALID",
    "Локальная операция использует не тот служебный GitHub App",
  );
  assertGate(
    invocation?.environmentAdminBypassPolicy ===
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
    "ENVIRONMENT_ADMIN_BYPASS_POLICY_INVALID",
    "Локальная операция не содержит точный Team/private-профиль",
  );
  validateLifecycleInvocation(invocation?.lifecycleInvocation);
  assertGate(
    invocation.lifecycleInvocation.kind ===
      LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER,
    "TRUST_INVOCATION_KIND_INVALID",
    "Локальный шлюз принимает только происхождение local_owner",
  );
  validateTeamPrivatePlatformContext(invocation.platformContext);
  return invocation;
}

async function getRef(api, branch, { allowMissing = false } = {}) {
  try {
    const response = await api.request(
      api.repoPath(`/git/ref/${gitRefPath(branch)}`),
    );
    const sha = response.data?.object?.sha;
    assertGate(
      response.data?.ref === `refs/heads/${branch}` && SHA_PATTERN.test(sha ?? ""),
      "GIT_REF_INVALID",
      `GitHub API вернул некорректную ссылку ветки ${branch}`,
    );
    return { ref: response.data.ref, sha };
  } catch (error) {
    if (allowMissing && error instanceof GitHubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getBranchProtection(api, branch) {
  const response = await api.request(
    api.repoPath(`/branches/${encodeBranch(branch)}/protection`),
  );
  return response.data;
}

async function applyBranchProtection(api, branch, payload) {
  await api.request(
    api.repoPath(`/branches/${encodeBranch(branch)}/protection`),
    { body: payload, expectedStatuses: [200], method: "PUT" },
  );
  return getBranchProtection(api, branch);
}

async function assertAppRepositoryScope(api) {
  const response = await api.request("/installation/repositories?per_page=100");
  assertGate(
    Number(response.data?.total_count) === 1 &&
      Array.isArray(response.data?.repositories) &&
      response.data.repositories.length === 1 &&
      response.data.repositories[0]?.full_name === ACADEMY_REPOSITORY,
    "LIFECYCLE_APP_SCOPE_INVALID",
    "Installation token служебного GitHub App не ограничен одним репозиторием Академии",
  );
}

async function readBlob(api, sha, path) {
  const response = await api.request(api.repoPath(`/git/blobs/${sha}`));
  assertGate(
    response.data?.encoding === "base64" &&
      typeof response.data?.content === "string" &&
      Number.isSafeInteger(response.data?.size) &&
      response.data.size >= 0 &&
      response.data.size <= MAX_BLOB_BYTES,
    "REGISTRY_BLOB_INVALID",
    `Git blob ${path} имеет недопустимый формат или размер`,
  );
  const buffer = Buffer.from(response.data.content.replace(/\s/g, ""), "base64");
  assertGate(
    buffer.length === response.data.size,
    "REGISTRY_BLOB_SIZE_MISMATCH",
    `Размер Git blob ${path} не совпадает с заявленным`,
  );
  return buffer.toString("utf8");
}

export function validateRegistryTreeEntries(entries) {
  assertGate(
    Array.isArray(entries),
    "REGISTRY_TREE_INVALID",
    "GitHub API вернул некорректный Git tree реестра",
  );
  const blobs = entries.filter((entry) => entry?.type !== "tree");
  const trees = entries.filter((entry) => entry?.type === "tree");
  const hasEvents = blobs.some((entry) => entry?.path?.startsWith("events/"));
  assertGate(
    trees.length === (hasEvents ? 1 : 0) &&
      (!hasEvents ||
        (trees[0]?.path === "events" && trees[0]?.mode === "040000")),
    "REGISTRY_TREE_STRUCTURE_INVALID",
    "Git tree реестра содержит постороннюю или отсутствующую директорию",
  );
  return blobs;
}

async function loadRegistry(api) {
  const registryRef = await getRef(api, REGISTRY_BRANCH, { allowMissing: true });
  if (!registryRef) {
    return null;
  }

  const newestFirst = [];
  let commitSha = registryRef.sha;
  for (let index = 0; index < MAX_REGISTRY_COMMITS; index += 1) {
    const commitResponse = await api.request(
      api.repoPath(`/git/commits/${commitSha}`),
    );
    const commit = commitResponse.data;
    assertGate(
      commit?.sha === commitSha && SHA_PATTERN.test(commit?.tree?.sha ?? ""),
      "REGISTRY_COMMIT_INVALID",
      `Коммит ${commitSha} реестра имеет недопустимый формат`,
    );
    assertGate(
      Array.isArray(commit.parents) && commit.parents.length <= 1,
      "REGISTRY_HISTORY_NOT_LINEAR",
      `Коммит ${commitSha} имеет больше одного родителя`,
    );

    const treeResponse = await api.request(
      api.repoPath(`/git/trees/${commit.tree.sha}?recursive=1`),
    );
    assertGate(
      treeResponse.data?.truncated === false && Array.isArray(treeResponse.data?.tree),
      "REGISTRY_TREE_TRUNCATED",
      `Git tree коммита ${commitSha} неполон`,
    );
    const entries = validateRegistryTreeEntries(treeResponse.data.tree);
    newestFirst.push({
      entries,
      parentSha: commit.parents[0]?.sha ?? null,
      sha: commitSha,
      treeSha: commit.tree.sha,
    });

    if (commit.parents.length === 0) {
      break;
    }
    assertGate(
      index < MAX_REGISTRY_COMMITS - 1,
      "REGISTRY_HISTORY_LIMIT_EXCEEDED",
      `История реестра превышает ${MAX_REGISTRY_COMMITS} коммитов`,
    );
    commitSha = commit.parents[0].sha;
  }

  const snapshots = newestFirst.reverse();
  const history = validateAppendOnlyHistory(snapshots);
  assertGate(
    history.headSha === registryRef.sha,
    "REGISTRY_HEAD_MISMATCH",
    "Проверенная история не заканчивается текущим head реестра",
  );

  const rootMetadataEntry = snapshots[0].entries.find(
    (entry) => entry.path === REGISTRY_METADATA_PATH,
  );
  const metadataRaw = await readBlob(
    api,
    rootMetadataEntry.sha,
    REGISTRY_METADATA_PATH,
  );
  let metadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    throw new ReleaseGateError(
      "REGISTRY_METADATA_JSON_INVALID",
      "registry.json содержит некорректный JSON",
    );
  }
  validateRegistryMetadata(metadata);
  assertGate(
    metadataRaw === canonicalJson(metadata),
    "REGISTRY_METADATA_NOT_CANONICAL",
    "registry.json записан не в каноническом формате",
  );

  const latestEntries = new Map(
    snapshots.at(-1).entries.map((entry) => [entry.path, entry]),
  );
  const eventFiles = new Map();
  for (const path of history.eventPaths) {
    const entry = latestEntries.get(path);
    assertGate(
      entry?.type === "blob" && entry.mode === "100644",
      "REGISTRY_EVENT_ENTRY_INVALID",
      `Событие ${path} отсутствует в итоговом Git tree`,
    );
    const raw = await readBlob(api, entry.sha, path);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ReleaseGateError(
        "REGISTRY_EVENT_JSON_INVALID",
        `Файл ${path} содержит некорректный JSON`,
      );
    }
    assertGate(
      raw === canonicalJson(parsed),
      "REGISTRY_EVENT_NOT_CANONICAL",
      `Событие ${path} записано не в каноническом формате`,
    );
    eventFiles.set(path, raw);
  }

  const events = validateEventFiles({
    eventFiles,
    expectedPaths: history.eventPaths,
  });
  const state = validateRegistryEvents(events);
  return {
    events,
    headSha: registryRef.sha,
    headTreeSha: snapshots.at(-1).treeSha,
    state,
  };
}

async function createBlob(api, content) {
  const response = await api.request(api.repoPath("/git/blobs"), {
    body: { content, encoding: "utf-8" },
    expectedStatuses: [201],
    method: "POST",
  });
  assertGate(
    SHA_PATTERN.test(response.data?.sha ?? ""),
    "GIT_BLOB_CREATE_INVALID",
    "GitHub API не вернул SHA созданного blob",
  );
  return response.data.sha;
}

async function createTree(api, { baseTree, entries }) {
  const body = { tree: entries };
  if (baseTree) {
    body.base_tree = baseTree;
  }
  const response = await api.request(api.repoPath("/git/trees"), {
    body,
    expectedStatuses: [201],
    method: "POST",
  });
  assertGate(
    SHA_PATTERN.test(response.data?.sha ?? ""),
    "GIT_TREE_CREATE_INVALID",
    "GitHub API не вернул SHA созданного tree",
  );
  return response.data.sha;
}

async function createCommit(api, { message, parents, tree }) {
  const response = await api.request(api.repoPath("/git/commits"), {
    body: { message, parents, tree },
    expectedStatuses: [201],
    method: "POST",
  });
  assertGate(
    SHA_PATTERN.test(response.data?.sha ?? ""),
    "GIT_COMMIT_CREATE_INVALID",
    "GitHub API не вернул SHA созданного коммита",
  );
  return response.data.sha;
}

async function initializeRegistry(api, appSlug) {
  assertGate(
    !(await getRef(api, REGISTRY_BRANCH, { allowMissing: true })),
    "REGISTRY_ALREADY_EXISTS",
    "Ветка реестра появилась во время инициализации",
  );
  const metadataBlob = await createBlob(api, canonicalJson(REGISTRY_METADATA));
  const rootTree = await createTree(api, {
    entries: [
      {
        mode: "100644",
        path: REGISTRY_METADATA_PATH,
        sha: metadataBlob,
        type: "blob",
      },
    ],
  });
  const rootCommit = await createCommit(api, {
    message: "Инициализировать append-only реестр релизных поездов",
    parents: [],
    tree: rootTree,
  });
  await api.request(api.repoPath("/git/refs"), {
    body: { ref: `refs/heads/${REGISTRY_BRANCH}`, sha: rootCommit },
    expectedStatuses: [201],
    method: "POST",
  });
  const protection = await applyBranchProtection(
    api,
    REGISTRY_BRANCH,
    registryBranchProtectionPayload(appSlug),
  );
  validateRegistryBranchProtection(protection, appSlug);
  return loadRegistry(api);
}

export async function ensureRegistry(api, appSlug, dependencies = {}) {
  const services = {
    applyBranchProtection,
    getBranchProtection,
    initializeRegistry,
    loadRegistry,
    ...dependencies,
  };
  let registry = await services.loadRegistry(api);
  if (!registry) {
    registry = await services.initializeRegistry(api, appSlug);
  } else if (registry.events.length === 0) {
    let protection;
    try {
      protection = await services.getBranchProtection(api, REGISTRY_BRANCH);
      validateRegistryBranchProtection(protection, appSlug);
    } catch (error) {
      const repairable =
        (error instanceof GitHubApiError && error.status === 404) ||
        (error instanceof ReleaseGateError &&
          error.code.startsWith("REGISTRY_PROTECTION_"));
      if (!repairable) {
        throw error;
      }
      protection = await services.applyBranchProtection(
        api,
        REGISTRY_BRANCH,
        registryBranchProtectionPayload(appSlug),
      );
      validateRegistryBranchProtection(protection, appSlug);
      const verified = await services.loadRegistry(api);
      assertGate(
        verified?.headSha === registry.headSha &&
          verified.events.length === 0 &&
          verified.state.activeTrain === null,
        "REGISTRY_CHANGED_DURING_PROTECTION_REPAIR",
        "Пустой реестр изменился во время восстановления защиты",
      );
      registry = verified;
    }
  } else {
    validateRegistryBranchProtection(
      await services.getBranchProtection(api, REGISTRY_BRANCH),
      appSlug,
    );
  }
  assertGate(registry, "REGISTRY_INITIALIZATION_FAILED", "Реестр не создан");
  return registry;
}

async function listEnvironmentBranchPolicies(api) {
  const policies = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const response = await api.request(
      api.repoPath(
        `/environments/${PRODUCTION_ENVIRONMENT}/deployment-branch-policies?per_page=100&page=${page}`,
      ),
    );
    assertGate(
      Array.isArray(response.data?.branch_policies),
      "ENVIRONMENT_POLICIES_INVALID",
      "GitHub API вернул некорректный список deployment branch policies",
    );
    policies.push(...response.data.branch_policies);
    if (response.data.branch_policies.length < 100) {
      return policies;
    }
  }
  throw new ReleaseGateError(
    "ENVIRONMENT_POLICIES_LIMIT_EXCEEDED",
    "Число deployment branch policies превышает безопасный предел",
  );
}

function validateEnvironmentAdminBypass(environment, context) {
  const policy =
    context?.environmentAdminBypassPolicy ??
    ENVIRONMENT_ADMIN_BYPASS_POLICIES.FORBIDDEN;
  if (policy === ENVIRONMENT_ADMIN_BYPASS_POLICIES.FORBIDDEN) {
    assertGate(
      environment?.can_admins_bypass === false,
      "ENVIRONMENT_ADMIN_BYPASS_ENABLED",
      "Для production Environment не отключён административный обход",
    );
    return policy;
  }

  assertGate(
    policy ===
      ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
    "ENVIRONMENT_ADMIN_BYPASS_POLICY_INVALID",
    "Неизвестная политика административного обхода Environment",
  );
  validateTeamPrivatePlatformContext(context?.platformContext);
  assertGate(
    environment?.can_admins_bypass === true,
    "TEAM_PRIVATE_ADMIN_BYPASS_STATE_MISMATCH",
    "Team/private-профиль ожидает недоступное для отключения значение admin bypass",
  );
  return policy;
}

export function validateEnvironment(environment, policies, context = {}) {
  assertGate(
    environment?.name === PRODUCTION_ENVIRONMENT,
    "ENVIRONMENT_INVALID",
    "GitHub API вернул не production Environment",
  );
  validateEnvironmentAdminBypass(environment, context);
  assertGate(
    environment.deployment_branch_policy?.protected_branches === false &&
      environment.deployment_branch_policy?.custom_branch_policies === true,
    "ENVIRONMENT_BRANCH_MODE_INVALID",
    "Production Environment не использует custom deployment branch policies",
  );
  assertGate(
    policies.length === 1 &&
      policies[0]?.name === DEFAULT_BRANCH &&
      policies[0]?.type === "branch",
    "ENVIRONMENT_MAIN_POLICY_INVALID",
    "Production Environment должен разрешать только точную ветку main",
  );
}

function normalizeEnvironmentReviewers(reviewers) {
  assertGate(
    Array.isArray(reviewers) && reviewers.length > 0 && reviewers.length <= 6,
    "ENVIRONMENT_REVIEWERS_INVALID",
    "Required reviewers production Environment имеют недопустимый формат",
  );
  const normalized = reviewers.map((entry) => {
    const type = entry?.type;
    const id = entry?.reviewer?.id;
    assertGate(
      (type === "User" || type === "Team") &&
        Number.isSafeInteger(id) &&
        id > 0,
      "ENVIRONMENT_REVIEWER_INVALID",
      "Required reviewer production Environment не содержит допустимые type и ID",
    );
    return { id, type };
  });
  normalized.sort(
    (left, right) =>
      left.type.localeCompare(right.type) || left.id - right.id,
  );
  assertGate(
    normalized.every(
      (entry, index) =>
        index === 0 ||
        entry.type !== normalized[index - 1].type ||
        entry.id !== normalized[index - 1].id,
    ),
    "ENVIRONMENT_REVIEWER_DUPLICATED",
    "Required reviewers production Environment содержат повтор",
  );
  return normalized;
}

export function retainedEnvironmentProtections(environment) {
  assertGate(
    Array.isArray(environment?.protection_rules),
    "ENVIRONMENT_PROTECTION_RULES_INVALID",
    "GitHub API не вернул protection rules production Environment",
  );

  let requiredReviewers = null;
  let waitTimer = null;
  for (const rule of environment.protection_rules) {
    if (rule?.type === "branch_policy") {
      continue;
    }
    if (rule?.type === "wait_timer") {
      assertGate(
        waitTimer === null &&
          Number.isSafeInteger(rule.wait_timer) &&
          rule.wait_timer >= 0 &&
          rule.wait_timer <= 43_200,
        "ENVIRONMENT_WAIT_TIMER_INVALID",
        "Wait timer production Environment отсутствует, повторяется или недопустим",
      );
      waitTimer = rule.wait_timer;
      continue;
    }
    if (rule?.type === "required_reviewers") {
      assertGate(
        requiredReviewers === null &&
          typeof rule.prevent_self_review === "boolean",
        "ENVIRONMENT_REQUIRED_REVIEWERS_INVALID",
        "Required reviewers production Environment повторяются или неполны",
      );
      requiredReviewers = {
        preventSelfReview: rule.prevent_self_review,
        reviewers: normalizeEnvironmentReviewers(rule.reviewers),
      };
      continue;
    }
    throw new ReleaseGateError(
      "ENVIRONMENT_PROTECTION_RULE_UNSUPPORTED",
      `Нельзя безопасно сохранить protection rule типа ${rule?.type ?? "<пусто>"}`,
    );
  }

  return { requiredReviewers, waitTimer };
}

export function productionEnvironmentUpdatePayload(environment) {
  const retained = retainedEnvironmentProtections(environment);
  const payload = {
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
  };
  if (retained.waitTimer !== null) {
    payload.wait_timer = retained.waitTimer;
  }
  if (retained.requiredReviewers !== null) {
    payload.prevent_self_review = retained.requiredReviewers.preventSelfReview;
    payload.reviewers = retained.requiredReviewers.reviewers;
  }
  return payload;
}

export function validateEnvironmentProtectionsPreserved(before, after) {
  const expected = retainedEnvironmentProtections(before);
  const actual = retainedEnvironmentProtections(after);
  assertGate(
    JSON.stringify(actual) === JSON.stringify(expected),
    "ENVIRONMENT_PROTECTIONS_CHANGED",
    "Wait timer или required reviewers production Environment изменились",
  );
  return after;
}

async function configureProductionEnvironment(api, context = {}) {
  const before = await api.request(
    api.repoPath(`/environments/${PRODUCTION_ENVIRONMENT}`),
  );
  validateEnvironmentAdminBypass(before.data, context);

  const updatePayload = productionEnvironmentUpdatePayload(before.data);

  await api.request(api.repoPath(`/environments/${PRODUCTION_ENVIRONMENT}`), {
    body: updatePayload,
    expectedStatuses: [200],
    method: "PUT",
  });

  const policies = await listEnvironmentBranchPolicies(api);
  let exactMain = policies.find(
    (policy) => policy?.name === DEFAULT_BRANCH && policy?.type === "branch",
  );
  for (const policy of policies) {
    if (policy !== exactMain) {
      assertGate(
        Number.isSafeInteger(policy?.id),
        "ENVIRONMENT_POLICY_ID_INVALID",
        "Deployment branch policy не содержит целочисленный ID",
      );
      await api.request(
        api.repoPath(
          `/environments/${PRODUCTION_ENVIRONMENT}/deployment-branch-policies/${policy.id}`,
        ),
        { expectedStatuses: [204], method: "DELETE" },
      );
    }
  }
  if (!exactMain) {
    const created = await api.request(
      api.repoPath(
        `/environments/${PRODUCTION_ENVIRONMENT}/deployment-branch-policies`,
      ),
      {
        body: { name: DEFAULT_BRANCH, type: "branch" },
        expectedStatuses: [200],
        method: "POST",
      },
    );
    exactMain = created.data;
  }

  const after = await api.request(
    api.repoPath(`/environments/${PRODUCTION_ENVIRONMENT}`),
  );
  const afterPolicies = await listEnvironmentBranchPolicies(api);
  validateEnvironment(after.data, afterPolicies, context);
  validateEnvironmentProtectionsPreserved(before.data, after.data);
}

async function assertAncestor(api, baseSha, headSha, context) {
  const response = await api.request(
    api.repoPath(`/compare/${baseSha}...${headSha}`),
  );
  assertGate(
    (response.data?.status === "ahead" || response.data?.status === "identical") &&
      response.data?.merge_base_commit?.sha === baseSha,
    "TRAIN_ANCESTRY_INVALID",
    `${context}: ${baseSha} не является предком ${headSha}`,
  );
}

async function prepareSourceBranch({ api, mainSha }) {
  const sourceBranch = CURRENT_BOOTSTRAP_TRAIN.sourceBranch;
  const sourceRef = await getRef(api, sourceBranch);
  assertGate(
    sourceRef.sha === CURRENT_BOOTSTRAP_TRAIN.expectedHeadSha,
    "TRAIN_BOOTSTRAP_HEAD_MISMATCH",
    "Head существующей интеграционной ветки не совпадает с принятым процессным SHA",
  );
  await assertAncestor(
    api,
    CURRENT_BOOTSTRAP_TRAIN.openedFromMainSha,
    mainSha,
    "Происхождение исторической точки от main",
  );
  await assertAncestor(
    api,
    CURRENT_BOOTSTRAP_TRAIN.openedFromMainSha,
    sourceRef.sha,
    "Происхождение существующей интеграционной ветки",
  );
  return {
    openedFromMainSha: CURRENT_BOOTSTRAP_TRAIN.openedFromMainSha,
    sourceBranch,
    sourceSha: sourceRef.sha,
  };
}

async function appendOpenedEvent(api, registry, event) {
  const path = eventPath(event);
  const blob = await createBlob(api, canonicalJson(event));
  const tree = await createTree(api, {
    baseTree: registry.headTreeSha,
    entries: [
      {
        mode: "100644",
        path,
        sha: blob,
        type: "blob",
      },
    ],
  });
  const commit = await createCommit(api, {
    message: `Открыть релизный поезд ${event.train_id}`,
    parents: [registry.headSha],
    tree,
  });
  await api.request(
    api.repoPath(`/git/refs/${gitRefPath(REGISTRY_BRANCH)}`),
    {
      body: { force: false, sha: commit },
      expectedStatuses: [200],
      method: "PATCH",
    },
  );
  const verified = await loadRegistry(api);
  assertGate(
    verified?.headSha === commit &&
      verified.events.length === registry.events.length + 1 &&
      verified.events.at(-1)?.train_id === event.train_id,
    "REGISTRY_APPEND_VERIFICATION_FAILED",
    "Добавленная запись train_opened не подтверждена повторным чтением реестра",
  );
  return verified;
}

function sameLifecycleInvocation(recorded, current) {
  validateLifecycleInvocation(recorded);
  validateLifecycleInvocation(current);
  if (recorded.kind !== current.kind) {
    return false;
  }
  if (recorded.kind === LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER) {
    return recorded.operation_id === current.operation_id;
  }
  return (
    recorded.run_id === current.run_id &&
    recorded.run_attempt <= current.run_attempt
  );
}

function recoveredOpenResult(registry, invocation) {
  const activeTrain = registry?.state.activeTrain;
  if (
    !activeTrain ||
    !sameLifecycleInvocation(
      activeTrain.lifecycle_invocation,
      invocation.lifecycleInvocation,
    )
  ) {
    return null;
  }
  assertGate(
    activeTrain.actor_id === invocation.actorId &&
      activeTrain.source_branch === CURRENT_BOOTSTRAP_TRAIN.sourceBranch &&
      activeTrain.opened_from_main_sha ===
        CURRENT_BOOTSTRAP_TRAIN.openedFromMainSha &&
      activeTrain.environment_admin_bypass_policy ===
        invocation.environmentAdminBypassPolicy,
    "TRAIN_OPEN_REPLAY_MISMATCH",
    "Существующая запись этого lifecycle run не совпадает с доверенным open",
  );
  return {
    openedFromMainSha: activeTrain.opened_from_main_sha,
    sourceBranch: activeTrain.source_branch,
    sourceSha: CURRENT_BOOTSTRAP_TRAIN.expectedHeadSha,
    trainId: activeTrain.train_id,
  };
}

async function writeLifecycleResult(result, env) {
  assertGate(env.GITHUB_OUTPUT, "GITHUB_OUTPUT_MISSING", "GITHUB_OUTPUT не задан");
  await appendFile(
    env.GITHUB_OUTPUT,
    [
      `opened_from_main_sha=${result.openedFromMainSha}`,
      `source_branch=${result.sourceBranch}`,
      `source_sha=${result.sourceSha}`,
      `train_id=${result.trainId}`,
      "",
    ].join("\n"),
    "utf8",
  );
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      [
        "### Релизный поезд открыт",
        "",
        `- Train ID: \`${result.trainId}\``,
        `- Ветка: \`${result.sourceBranch}\``,
        `- Точка происхождения: \`${result.openedFromMainSha}\``,
        `- Зафиксированный head: \`${result.sourceSha}\``,
        "- Реестр: append-only запись `train_opened` подтверждена повторным чтением",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

async function executeTrainOpen({ env, invocation }, dependencies = {}) {
  const api =
    dependencies.api ??
    new GitHubApi({
      apiUrl: env.GITHUB_API_URL,
      repository: env.GITHUB_REPOSITORY,
      token: env.TRAIN_LIFECYCLE_TOKEN,
    });
  const services = {
    appendOpenedEvent,
    applyBranchProtection,
    assertAppRepositoryScope,
    configureProductionEnvironment,
    ensureRegistry,
    getBranchProtection,
    getRef,
    loadRegistry,
    prepareSourceBranch,
    ...dependencies.services,
  };

  await services.assertAppRepositoryScope(api);
  const observedRegistry = await services.loadRegistry(api);
  if (observedRegistry?.state.activeTrain) {
    validateRegistryBranchProtection(
      await services.getBranchProtection(api, REGISTRY_BRANCH),
      invocation.appSlug,
    );
    const verifiedRegistry = await services.loadRegistry(api);
    assertGate(
      verifiedRegistry?.headSha === observedRegistry.headSha,
      "REGISTRY_CHANGED_DURING_OPEN_RECOVERY",
      "Реестр изменился во время подтверждения существующего train_opened",
    );
    const observedResult = recoveredOpenResult(verifiedRegistry, invocation);
    if (observedResult) {
      if (!dependencies.skipOutput) {
        await writeLifecycleResult(observedResult, env);
      }
      return observedResult;
    }
    throw new ReleaseGateError(
      "TRAIN_ALREADY_ACTIVE",
      `Уже активен поезд ${verifiedRegistry.state.activeTrain?.train_id ?? "<неизвестно>"}`,
    );
  }

  const mainRef = await services.getRef(api, DEFAULT_BRANCH);
  assertGate(
    mainRef.sha === invocation.mainSha,
    "TRUST_MAIN_MOVED",
    "Head main изменился после запуска lifecycle",
  );

  const registry = await services.ensureRegistry(api, invocation.appSlug);
  const concurrentResult = recoveredOpenResult(registry, invocation);
  if (concurrentResult) {
    if (!dependencies.skipOutput) {
      await writeLifecycleResult(concurrentResult, env);
    }
    return concurrentResult;
  }
  assertGate(
    registry.state.activeTrain === null,
    "TRAIN_ALREADY_ACTIVE",
    `Уже активен поезд ${registry.state.activeTrain?.train_id ?? "<неизвестно>"}`,
  );

  const uuid = dependencies.randomUUID?.() ?? randomUUID();
  assertGate(
    UUID_PATTERN.test(uuid),
    "TRAIN_ID_INVALID",
    "Генератор не вернул допустимый UUID для train_id",
  );

  await services.configureProductionEnvironment(api, {
    environmentAdminBypassPolicy:
      invocation.environmentAdminBypassPolicy,
    platformContext: invocation.platformContext,
  });
  const source = await services.prepareSourceBranch({
    api,
    mainSha: invocation.mainSha,
  });
  const protection = await services.applyBranchProtection(
    api,
    source.sourceBranch,
    sourceBranchProtectionPayload(),
  );
  validateSourceBranchProtection(protection);

  const frozenSourceRef = await services.getRef(api, source.sourceBranch);
  assertGate(
    frozenSourceRef.sha === source.sourceSha,
    "TRAIN_SOURCE_MOVED",
    "Head ветки поезда изменился до регистрации",
  );
  validateSourceBranchProtection(
    await services.getBranchProtection(api, source.sourceBranch),
  );
  const finalMainRef = await services.getRef(api, DEFAULT_BRANCH);
  assertGate(
    finalMainRef.sha === invocation.mainSha,
    "TRUST_MAIN_MOVED",
    "Head main изменился до регистрации поезда",
  );

  const event = createTrainOpenedEvent({
    actorId: invocation.actorId,
    actorLogin: invocation.actorLogin,
    environmentAdminBypassPolicy:
      invocation.environmentAdminBypassPolicy,
    lifecycleInvocation: invocation.lifecycleInvocation,
    occurredAt: dependencies.now?.() ?? new Date().toISOString(),
    openedFromMainSha: source.openedFromMainSha,
    registrySequence: registry.events.length + 1,
    sourceBranch: source.sourceBranch,
    trainId: uuid,
  });
  await services.appendOpenedEvent(api, registry, event);

  const result = {
    openedFromMainSha: source.openedFromMainSha,
    sourceBranch: source.sourceBranch,
    sourceSha: source.sourceSha,
    trainId: uuid,
  };
  if (!dependencies.skipOutput) {
    await writeLifecycleResult(result, env);
  }
  return result;
}

export async function runTrainOpen(env = process.env, dependencies = {}) {
  return executeTrainOpen(
    { env, invocation: validateTrustedInvocation(env) },
    dependencies,
  );
}

export async function runLocalTrainOpen(invocation, dependencies = {}) {
  return executeTrainOpen(
    { env: {}, invocation: validateLocalOwnerInvocation(invocation) },
    { ...dependencies, skipOutput: true },
  );
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  Promise.reject(
    new ReleaseGateError(
      "ACTIONS_LIFECYCLE_DISABLED",
      "Actions lifecycle отключён для GitHub Team/private; используйте локальный шлюз по runbook",
    ),
  ).catch((error) => {
    console.error(formatGateError(error));
    process.exitCode = 1;
  });
}
