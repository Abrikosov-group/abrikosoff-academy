import { execFile } from "node:child_process";
import {
  createPrivateKey,
  createSign,
  randomUUID,
} from "node:crypto";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  ACADEMY_REPOSITORY,
  ACADEMY_REPOSITORY_NAME,
  CURRENT_LIFECYCLE_APP,
  CURRENT_LIFECYCLE_OWNER_ID,
  DEFAULT_BRANCH,
  ENVIRONMENT_ADMIN_BYPASS_POLICIES,
  GITHUB_ORGANIZATION,
  LIFECYCLE_INVOCATION_KINDS,
  LOCAL_BOOTSTRAP_STATE_FILE,
  PRODUCTION_ENVIRONMENT,
  TRAIN_OPEN_CONFIRMATION,
} from "./config.mjs";
import { ReleaseGateError, assertGate, formatGateError } from "./errors.mjs";
import { GitHubApi } from "./github-api.mjs";
import { runLocalTrainOpen } from "./train-lifecycle.mjs";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PRIVATE_KEY_BYTES = 32 * 1024;
const EXPECTED_INSTALLATION_PERMISSIONS = Object.freeze({
  actions: "read",
  administration: "write",
  contents: "write",
  metadata: "read",
});
const EXPECTED_TOKEN_PERMISSIONS = Object.freeze({
  actions: "read",
  administration: "write",
  contents: "write",
  metadata: "read",
});
const REQUESTED_TOKEN_PERMISSIONS = Object.freeze({
  actions: "read",
  administration: "write",
  contents: "write",
});
const TRUSTED_ORIGIN_URLS = new Set([
  `https://github.com/${ACADEMY_REPOSITORY}.git`,
  `git@github.com:${ACADEMY_REPOSITORY}.git`,
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, code, context) {
  assertGate(isPlainObject(value), code, `${context} должен быть объектом`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assertGate(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    code,
    `${context}: ожидались поля ${expected.join(", ")}, получены ${actual.join(", ")}`,
  );
}

function samePermissions(actual, expected) {
  if (!isPlainObject(actual)) {
    return false;
  }
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([key, value], index) =>
        key === expectedEntries[index][0] && value === expectedEntries[index][1],
    )
  );
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createGitHubAppJwt({
  clientId = CURRENT_LIFECYCLE_APP.clientId,
  now = Date.now(),
  privateKey,
}) {
  assertGate(
    typeof clientId === "string" && /^Iv[0-9A-Za-z]+$/.test(clientId),
    "LOCAL_APP_CLIENT_ID_INVALID",
    "Client ID служебного GitHub App имеет недопустимый формат",
  );
  assertGate(
    Number.isFinite(now) && now > 0,
    "LOCAL_JWT_TIME_INVALID",
    "Время создания GitHub App JWT недопустимо",
  );
  const nowSeconds = Math.floor(now / 1_000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    exp: nowSeconds + 9 * 60,
    iat: nowSeconds - 60,
    iss: clientId,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function parseLocalBootstrapArguments(args) {
  const parsed = {
    confirmation: null,
    help: false,
    mode: null,
    privateKeyPath: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--verify" || argument === "--open") {
      assertGate(
        parsed.mode === null,
        "LOCAL_MODE_DUPLICATED",
        "Режим локального шлюза указан больше одного раза",
      );
      parsed.mode = argument.slice(2);
      continue;
    }
    if (argument === "--private-key" || argument === "--confirmation") {
      const value = args[index + 1];
      assertGate(
        typeof value === "string" && value.length > 0 && !value.startsWith("--"),
        "LOCAL_ARGUMENT_VALUE_MISSING",
        `После ${argument} не задано значение`,
      );
      index += 1;
      if (argument === "--private-key") {
        assertGate(
          parsed.privateKeyPath === null,
          "LOCAL_PRIVATE_KEY_DUPLICATED",
          "Путь к private key указан больше одного раза",
        );
        parsed.privateKeyPath = value;
      } else {
        assertGate(
          parsed.confirmation === null,
          "LOCAL_CONFIRMATION_DUPLICATED",
          "Подтверждение указано больше одного раза",
        );
        parsed.confirmation = value;
      }
      continue;
    }
    throw new ReleaseGateError(
      "LOCAL_ARGUMENT_UNKNOWN",
      `Неизвестный аргумент локального шлюза: ${argument}`,
    );
  }

  if (parsed.help) {
    assertGate(
      args.length === 1,
      "LOCAL_HELP_ARGUMENTS_INVALID",
      "--help нельзя совмещать с другими аргументами",
    );
    return parsed;
  }
  assertGate(
    parsed.mode === "verify" || parsed.mode === "open",
    "LOCAL_MODE_REQUIRED",
    "Укажите ровно один режим: --verify или --open",
  );
  assertGate(
    typeof parsed.privateKeyPath === "string",
    "LOCAL_PRIVATE_KEY_REQUIRED",
    "Укажите путь к private key через --private-key",
  );
  if (parsed.mode === "open") {
    assertGate(
      parsed.confirmation === TRAIN_OPEN_CONFIRMATION,
      "TRAIN_OPEN_CONFIRMATION_INVALID",
      "Текст явного подтверждения не совпадает",
    );
  } else {
    assertGate(
      parsed.confirmation === null,
      "LOCAL_VERIFY_CONFIRMATION_FORBIDDEN",
      "Режим --verify не принимает подтверждение изменяющей операции",
    );
  }
  return parsed;
}

async function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

async function commandOutput(runCommand, command, args, options) {
  const result = await runCommand(command, args, options);
  assertGate(
    result && typeof result.stdout === "string",
    "LOCAL_COMMAND_OUTPUT_INVALID",
    `${command} вернул неожиданный результат`,
  );
  return result.stdout.trim();
}

async function commandJson(runCommand, command, args, options) {
  const output = await commandOutput(runCommand, command, args, options);
  try {
    return JSON.parse(output);
  } catch {
    throw new ReleaseGateError(
      "LOCAL_COMMAND_JSON_INVALID",
      `${command} вернул некорректный JSON`,
    );
  }
}

export function validateOwnerPlatformResponses({
  membership,
  organization,
  repository,
  user,
}) {
  assertGate(
    String(user?.id) === CURRENT_LIFECYCLE_OWNER_ID &&
      typeof user?.login === "string" &&
      /^[A-Za-z0-9-]{1,39}$/.test(user.login),
    "TRUST_OWNER_MISMATCH",
    "Текущая сессия GitHub CLI не принадлежит зафиксированному владельцу",
  );
  assertGate(
    membership?.state === "active" && membership?.role === "admin",
    "LOCAL_ORGANIZATION_ROLE_INVALID",
    "Владелец не имеет активной административной роли в организации",
  );
  assertGate(
    organization?.login === GITHUB_ORGANIZATION &&
      organization?.plan?.name === "team",
    "TEAM_PRIVATE_PLAN_MISMATCH",
    "Организация не подтверждена как GitHub Team",
  );
  assertGate(
    repository?.full_name === ACADEMY_REPOSITORY &&
      repository?.private === true &&
      repository?.visibility === "private" &&
      repository?.default_branch === DEFAULT_BRANCH,
    "TEAM_PRIVATE_REPOSITORY_MISMATCH",
    "Репозиторий не соответствует Team/private-профилю Академии",
  );
  return {
    actorId: String(user.id),
    actorLogin: user.login,
    platformContext: {
      defaultBranch: repository.default_branch,
      organizationPlan: organization.plan.name,
      repository: repository.full_name,
      repositoryVisibility: repository.visibility,
    },
  };
}

export async function inspectOwnerPlatformContext({
  cwd,
  runCommand = defaultRunCommand,
} = {}) {
  const gh = (path) =>
    commandJson(
      runCommand,
      "gh",
      ["api", "--hostname", "github.com", path],
      { cwd },
    );
  const [user, membership, organization, repository] = await Promise.all([
    gh("user"),
    gh(`user/memberships/orgs/${GITHUB_ORGANIZATION}`),
    gh(`orgs/${GITHUB_ORGANIZATION}`),
    gh(`repos/${ACADEMY_REPOSITORY}`),
  ]);
  return validateOwnerPlatformResponses({
    membership,
    organization,
    repository,
    user,
  });
}

export async function inspectTrustedCheckout({
  cwd = process.cwd(),
  runCommand = defaultRunCommand,
} = {}) {
  const git = (args) => commandOutput(runCommand, "git", args, { cwd });
  const repositoryRoot = await git(["rev-parse", "--show-toplevel"]);
  const [actualRoot, requestedRoot] = await Promise.all([
    realpath(repositoryRoot),
    realpath(cwd),
  ]);
  assertGate(
    actualRoot === requestedRoot,
    "LOCAL_REPOSITORY_ROOT_MISMATCH",
    "Локальный шлюз нужно запускать из корня репозитория",
  );
  assertGate(
    (await git(["status", "--porcelain=v1", "--untracked-files=all"])) === "",
    "LOCAL_WORKTREE_DIRTY",
    "Рабочее дерево должно быть чистым до локального open",
  );
  assertGate(
    (await git(["branch", "--show-current"])) === DEFAULT_BRANCH,
    "LOCAL_BRANCH_MISMATCH",
    "Локальный шлюз разрешён только из ветки main",
  );
  assertGate(
    TRUSTED_ORIGIN_URLS.has(await git(["remote", "get-url", "origin"])),
    "LOCAL_ORIGIN_MISMATCH",
    "Git remote origin не указывает на репозиторий Академии",
  );
  await git([
    "fetch",
    "--no-tags",
    "origin",
    `refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}`,
  ]);
  assertGate(
    (await git(["status", "--porcelain=v1", "--untracked-files=all"])) === "",
    "LOCAL_WORKTREE_DIRTY",
    "Рабочее дерево изменилось во время проверки",
  );
  const [mainSha, remoteMainSha, gitDirectoryRaw] = await Promise.all([
    git(["rev-parse", "HEAD^{commit}"]),
    git(["rev-parse", `origin/${DEFAULT_BRANCH}^{commit}`]),
    git(["rev-parse", "--git-dir"]),
  ]);
  assertGate(
    SHA_PATTERN.test(mainSha) && mainSha === remoteMainSha,
    "LOCAL_MAIN_NOT_CURRENT",
    "Локальный main не совпадает с актуальным origin/main",
  );
  return {
    gitDirectory: resolve(repositoryRoot, gitDirectoryRaw),
    mainSha,
    repositoryRoot,
  };
}

async function readPrivateKeyFile(privateKeyPath) {
  const resolvedPath = await realpath(privateKeyPath);
  const file = await stat(resolvedPath);
  assertGate(
    file.isFile() && file.size > 0 && file.size <= MAX_PRIVATE_KEY_BYTES,
    "LOCAL_PRIVATE_KEY_FILE_INVALID",
    "Private key должен быть непустым обычным файлом допустимого размера",
  );
  assertGate(
    (file.mode & 0o077) === 0,
    "LOCAL_PRIVATE_KEY_PERMISSIONS_INVALID",
    "Private key не должен быть доступен группе или другим пользователям",
  );
  if (typeof process.getuid === "function") {
    assertGate(
      file.uid === process.getuid(),
      "LOCAL_PRIVATE_KEY_OWNER_INVALID",
      "Private key принадлежит другому системному пользователю",
    );
  }
  const raw = await readFile(resolvedPath);
  let privateKey;
  try {
    privateKey = createPrivateKey(raw);
  } catch {
    raw.fill(0);
    throw new ReleaseGateError(
      "LOCAL_PRIVATE_KEY_PARSE_FAILED",
      "Private key не является корректным PEM-ключом",
    );
  }
  if (
    privateKey.asymmetricKeyType !== "rsa" ||
    Number(privateKey.asymmetricKeyDetails?.modulusLength) < 2_048
  ) {
    raw.fill(0);
    throw new ReleaseGateError(
      "LOCAL_PRIVATE_KEY_ALGORITHM_INVALID",
      "GitHub App private key должен быть RSA-ключом не короче 2048 бит",
    );
  }
  return { privateKey, raw, resolvedPath };
}

export function validateAppIdentity(app) {
  assertGate(
    app?.id === CURRENT_LIFECYCLE_APP.id &&
      app?.client_id === CURRENT_LIFECYCLE_APP.clientId &&
      app?.slug === CURRENT_LIFECYCLE_APP.slug &&
      app?.owner?.login === CURRENT_LIFECYCLE_APP.owner,
    "LOCAL_APP_IDENTITY_MISMATCH",
    "Private key принадлежит не зафиксированному GitHub App Академии",
  );
  return app;
}

export function validateAppInstallation(installation) {
  assertGate(
    Number.isSafeInteger(installation?.id) && installation.id > 0,
    "LOCAL_INSTALLATION_ID_INVALID",
    "GitHub App installation не содержит допустимый ID",
  );
  assertGate(
    installation.app_id === CURRENT_LIFECYCLE_APP.id &&
      installation.account?.login === GITHUB_ORGANIZATION &&
      installation.target_type === "Organization" &&
      installation.repository_selection === "selected" &&
      installation.suspended_at === null,
    "LOCAL_INSTALLATION_SCOPE_INVALID",
    "GitHub App installation не соответствует организации и выбранным репозиториям",
  );
  assertGate(
    samePermissions(
      installation.permissions,
      EXPECTED_INSTALLATION_PERMISSIONS,
    ) &&
      Array.isArray(installation.events) &&
      installation.events.length === 0,
    "LOCAL_INSTALLATION_PERMISSIONS_INVALID",
    "Разрешения или события GitHub App installation отличаются от контракта",
  );
  return installation;
}

export function validateInstallationTokenResponse(response, now = Date.now()) {
  assertGate(
    typeof response?.token === "string" && response.token.length >= 20,
    "LOCAL_INSTALLATION_TOKEN_INVALID",
    "GitHub API не вернул installation token",
  );
  const expiresAt = Date.parse(response.expires_at);
  assertGate(
    Number.isFinite(expiresAt) &&
      expiresAt > now + 5 * 60 * 1_000 &&
      expiresAt <= now + 65 * 60 * 1_000,
    "LOCAL_INSTALLATION_TOKEN_EXPIRY_INVALID",
    "Срок действия installation token недопустим",
  );
  assertGate(
    response.repository_selection === "selected" &&
      Array.isArray(response.repositories) &&
      response.repositories.length === 1 &&
      response.repositories[0]?.full_name === ACADEMY_REPOSITORY &&
      response.repositories[0]?.private === true,
    "LOCAL_INSTALLATION_TOKEN_SCOPE_INVALID",
    "Installation token не ограничен private-репозиторием Академии",
  );
  const permissions = { ...response.permissions };
  if (permissions.metadata === undefined) {
    permissions.metadata = "read";
  }
  assertGate(
    samePermissions(permissions, EXPECTED_TOKEN_PERMISSIONS),
    "LOCAL_INSTALLATION_TOKEN_PERMISSIONS_INVALID",
    "Installation token получил не точный набор разрешений",
  );
  return response;
}

export async function createScopedInstallationToken({
  apiUrl,
  fetchImpl = globalThis.fetch,
  jwt,
  now = Date.now(),
}) {
  const appApi = new GitHubApi({
    apiUrl,
    fetchImpl,
    repository: ACADEMY_REPOSITORY,
    token: jwt,
  });
  validateAppIdentity((await appApi.request("/app")).data);
  const installation = validateAppInstallation(
    (await appApi.request(appApi.repoPath("/installation"))).data,
  );
  const tokenResponse = await appApi.request(
    `/app/installations/${installation.id}/access_tokens`,
    {
      body: {
        permissions: REQUESTED_TOKEN_PERMISSIONS,
        repositories: [ACADEMY_REPOSITORY_NAME],
      },
      expectedStatuses: [201],
      method: "POST",
    },
  );
  try {
    return validateInstallationTokenResponse(tokenResponse.data, now);
  } catch (validationError) {
    if (
      typeof tokenResponse.data?.token === "string" &&
      tokenResponse.data.token.length > 0
    ) {
      try {
        const invalidTokenApi = new GitHubApi({
          apiUrl,
          fetchImpl,
          repository: ACADEMY_REPOSITORY,
          token: tokenResponse.data.token,
        });
        await invalidTokenApi.request("/installation/token", {
          expectedStatuses: [204],
          method: "DELETE",
        });
      } catch (revocationError) {
        throw new ReleaseGateError(
          "LOCAL_INVALID_TOKEN_REVOCATION_FAILED",
          `Некорректный installation token не отозван после ошибки ${validationError.code ?? validationError.name ?? "unknown"}`,
          { cause: revocationError },
        );
      }
    }
    throw validationError;
  }
}

function validateOperationState(state, expected) {
  assertExactKeys(
    state,
    [
      "actor_id",
      "actor_login",
      "app_id",
      "created_at",
      "main_sha",
      "mode",
      "operation_id",
      "repository",
      "schema_version",
    ],
    "LOCAL_OPERATION_STATE_FIELDS_INVALID",
    "Состояние локальной операции",
  );
  assertGate(
    state.schema_version === 1 &&
      state.repository === ACADEMY_REPOSITORY &&
      state.mode === "register_existing" &&
      state.app_id === CURRENT_LIFECYCLE_APP.id &&
      state.actor_id === expected.actorId &&
      state.actor_login === expected.actorLogin &&
      state.main_sha === expected.mainSha &&
      UUID_PATTERN.test(state.operation_id ?? "") &&
      typeof state.created_at === "string" &&
      Number.isFinite(Date.parse(state.created_at)) &&
      state.created_at.endsWith("Z"),
    "LOCAL_OPERATION_STATE_MISMATCH",
    "Сохранённая локальная операция не совпадает с текущим владельцем и SHA main",
  );
  return state;
}

async function readOperationState(statePath, expected) {
  const file = await lstat(statePath);
  assertGate(
    file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0,
    "LOCAL_OPERATION_STATE_FILE_INVALID",
    "Файл состояния локальной операции имеет небезопасный тип или права",
  );
  let existing;
  try {
    existing = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    throw new ReleaseGateError(
      "LOCAL_OPERATION_STATE_JSON_INVALID",
      "Файл состояния локальной операции содержит некорректный JSON",
    );
  }
  validateOperationState(existing, expected);
  return { state: existing, statePath };
}

export async function createOrLoadOperationState({
  actorId,
  actorLogin,
  gitDirectory,
  mainSha,
  now = () => new Date().toISOString(),
  operationId = () => randomUUID(),
}) {
  const statePath = resolve(gitDirectory, LOCAL_BOOTSTRAP_STATE_FILE);
  const expected = { actorId, actorLogin, mainSha };
  try {
    return await readOperationState(statePath, expected);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const state = {
    actor_id: actorId,
    actor_login: actorLogin,
    app_id: CURRENT_LIFECYCLE_APP.id,
    created_at: now(),
    main_sha: mainSha,
    mode: "register_existing",
    operation_id: operationId(),
    repository: ACADEMY_REPOSITORY,
    schema_version: 1,
  };
  validateOperationState(state, expected);

  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  let installed = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporaryPath, statePath);
      installed = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }
  } finally {
    await handle?.close();
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (installed) {
    return { state, statePath };
  }
  return readOperationState(statePath, expected);
}

export function validateEnvironmentBranchPolicyMode(environment) {
  const branchPolicy = environment?.deployment_branch_policy;
  const usesProtectedBranches =
    branchPolicy?.protected_branches === true &&
    branchPolicy?.custom_branch_policies === false;
  const usesCustomBranchPolicies =
    branchPolicy?.protected_branches === false &&
    branchPolicy?.custom_branch_policies === true;
  assertGate(
    usesProtectedBranches || usesCustomBranchPolicies,
    "LOCAL_ENVIRONMENT_BRANCH_MODE_INVALID",
    "Production Environment вернул неподдерживаемый режим deployment branch policy",
  );
  return usesCustomBranchPolicies ? "custom" : "protected";
}

export async function verifyScopedToken(api, mainSha) {
  const repositories = await api.request("/installation/repositories?per_page=100");
  assertGate(
    repositories.data?.total_count === 1 &&
      Array.isArray(repositories.data?.repositories) &&
      repositories.data.repositories.length === 1 &&
      repositories.data.repositories[0]?.full_name === ACADEMY_REPOSITORY,
    "LIFECYCLE_APP_SCOPE_INVALID",
    "Installation token не ограничен одним репозиторием Академии",
  );
  const main = await api.request(
    api.repoPath(`/git/ref/heads/${DEFAULT_BRANCH}`),
  );
  assertGate(
    main.data?.ref === `refs/heads/${DEFAULT_BRANCH}` &&
      main.data?.object?.sha === mainSha,
    "TRUST_MAIN_MOVED",
    "Удалённый main изменился после локальной проверки",
  );
  const environmentPath = api.repoPath(
    `/environments/${PRODUCTION_ENVIRONMENT}`,
  );
  const environment = await api.request(environmentPath);
  assertGate(
    environment.data?.name === PRODUCTION_ENVIRONMENT,
    "LOCAL_PRODUCTION_ENVIRONMENT_INVALID",
    "GitHub API не подтвердил production Environment",
  );
  const branchPolicyMode = validateEnvironmentBranchPolicyMode(
    environment.data,
  );
  if (branchPolicyMode === "custom") {
    const policies = await api.request(
      `${environmentPath}/deployment-branch-policies?per_page=1&page=1`,
    );
    assertGate(
      Array.isArray(policies.data?.branch_policies),
      "LOCAL_ENVIRONMENT_POLICIES_INVALID",
      "GitHub API не подтвердил доступ к custom deployment branch policies",
    );
  }
}

async function revokeInstallationToken(api) {
  await api.request("/installation/token", {
    expectedStatuses: [204],
    method: "DELETE",
  });
}

export async function runLocalBootstrap(options, dependencies = {}) {
  assertGate(
    options?.mode === "verify" || options?.mode === "open",
    "LOCAL_MODE_REQUIRED",
    "Укажите ровно один режим: verify или open",
  );
  assertGate(
    typeof options.privateKeyPath === "string" &&
      options.privateKeyPath.length > 0,
    "LOCAL_PRIVATE_KEY_REQUIRED",
    "Не задан путь к private key",
  );
  if (options.mode === "verify") {
    assertGate(
      options.confirmation === null || options.confirmation === undefined,
      "LOCAL_VERIFY_CONFIRMATION_FORBIDDEN",
      "Режим verify не принимает подтверждение изменяющей операции",
    );
  }
  const cwd = dependencies.cwd ?? process.cwd();
  const checkout = await (dependencies.inspectTrustedCheckout ??
    inspectTrustedCheckout)({
    cwd,
    runCommand: dependencies.runCommand,
  });
  const owner = await (dependencies.inspectOwnerPlatformContext ??
    inspectOwnerPlatformContext)({
    cwd,
    runCommand: dependencies.runCommand,
  });
  let operation = null;
  if (options.mode === "open") {
    assertGate(
      options.confirmation === TRAIN_OPEN_CONFIRMATION,
      "TRAIN_OPEN_CONFIRMATION_INVALID",
      "Текст явного подтверждения не совпадает",
    );
    operation = await (dependencies.createOrLoadOperationState ??
      createOrLoadOperationState)({
      actorId: owner.actorId,
      actorLogin: owner.actorLogin,
      gitDirectory: checkout.gitDirectory,
      mainSha: checkout.mainSha,
      now: dependencies.now,
      operationId: dependencies.operationId,
    });
  }

  const key = await (dependencies.readPrivateKeyFile ?? readPrivateKeyFile)(
    options.privateKeyPath,
  );
  let installationApi = null;
  let primaryError = null;
  let result;
  try {
    const now = dependencies.currentTime ?? Date.now();
    const jwt = createGitHubAppJwt({ now, privateKey: key.privateKey });
    const scoped = await (dependencies.createScopedInstallationToken ??
      createScopedInstallationToken)({
      apiUrl: dependencies.apiUrl,
      fetchImpl: dependencies.fetchImpl,
      jwt,
      now,
    });
    installationApi =
      dependencies.installationApi ??
      new GitHubApi({
        apiUrl: dependencies.apiUrl,
        fetchImpl: dependencies.fetchImpl,
        repository: ACADEMY_REPOSITORY,
        token: scoped.token,
      });
    await (dependencies.verifyScopedToken ?? verifyScopedToken)(
      installationApi,
      checkout.mainSha,
    );

    if (options.mode === "verify") {
      result = {
        appSlug: CURRENT_LIFECYCLE_APP.slug,
        mainSha: checkout.mainSha,
        mode: "verify",
        repository: ACADEMY_REPOSITORY,
      };
    } else {
      const openResult = await (dependencies.runLocalTrainOpen ??
        runLocalTrainOpen)(
        {
          actorId: owner.actorId,
          actorLogin: owner.actorLogin,
          appSlug: CURRENT_LIFECYCLE_APP.slug,
          environmentAdminBypassPolicy:
            ENVIRONMENT_ADMIN_BYPASS_POLICIES.TEAM_PRIVATE_LOCAL_OWNER,
          lifecycleInvocation: {
            kind: LIFECYCLE_INVOCATION_KINDS.LOCAL_OWNER,
            operation_id: operation.state.operation_id,
          },
          mainSha: checkout.mainSha,
          platformContext: owner.platformContext,
        },
        { api: installationApi },
      );
      result = {
        ...openResult,
        mode: "open",
        operationId: operation.state.operation_id,
        statePath: operation.statePath,
      };
    }
  } catch (error) {
    primaryError = error;
  }

  key.raw.fill(0);
  if (installationApi) {
    try {
      await (dependencies.revokeInstallationToken ?? revokeInstallationToken)(
        installationApi,
      );
    } catch (error) {
      const cause = primaryError
        ? new AggregateError(
            [primaryError, error],
            "Основная операция и отзыв installation token завершились ошибкой",
          )
        : error;
      throw new ReleaseGateError(
        "LOCAL_INSTALLATION_TOKEN_REVOCATION_FAILED",
        primaryError
          ? `Installation token не отозван после ошибки ${primaryError.code ?? primaryError.name ?? "unknown"}`
          : "Installation token не отозван после завершения локального шлюза",
        { cause },
      );
    }
  }
  if (primaryError) {
    throw primaryError;
  }
  return result;
}

const usage = [
  "Локальный шлюз релизного поезда для GitHub Team/private:",
  "  node scripts/release-train/local-bootstrap.mjs --verify --private-key /absolute/path/key.pem",
  `  node scripts/release-train/local-bootstrap.mjs --open --private-key /absolute/path/key.pem --confirmation \"${TRAIN_OPEN_CONFIRMATION}\"`,
].join("\n");

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  Promise.resolve()
    .then(async () => {
      const options = parseLocalBootstrapArguments(process.argv.slice(2));
      if (options.help) {
        console.log(usage);
        return;
      }
      const result = await runLocalBootstrap(options);
      if (result.mode === "verify") {
        console.log(
          `Локальная проверка успешна: ${result.repository} @ ${result.mainSha}; GitHub App ${result.appSlug}. Изменения не выполнялись.`,
        );
        return;
      }
      console.log(
        `Релизный поезд ${result.trainId} зарегистрирован для ${result.sourceBranch} @ ${result.sourceSha}.`,
      );
      console.log(`Локальный operation ID: ${result.operationId}.`);
    })
    .catch((error) => {
      console.error(formatGateError(error));
      process.exitCode = 1;
    });
}
