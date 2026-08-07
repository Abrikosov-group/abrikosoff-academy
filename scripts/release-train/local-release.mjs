import { execFile, spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  ACADEMY_REPOSITORY,
  CURRENT_LIFECYCLE_OWNER_ID,
  LOCAL_PRODUCTION_RELEASE_CONFIRMATION,
  MAX_GITHUB_PAGES,
  PRODUCTION_APPLICATION_IMAGE,
  PRODUCTION_HEALTH_URL,
  PRODUCTION_TELEGRAM_EGRESS_IMAGE,
  SOURCE_BRANCH_REQUIRED_CHECKS,
} from "./config.mjs";
import { ReleaseGateError, assertGate, formatGateError } from "./errors.mjs";
import { GitHubApi } from "./github-api.mjs";
import {
  inspectOwnerPlatformContext,
  inspectTrustedCheckout,
} from "./local-bootstrap.mjs";
import {
  classifyMergedPullRequest,
  findMergedPullRequest,
  listPullRequestFiles,
} from "./release-classifier.mjs";

const execFileAsync = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_BUILD_METADATA_BYTES = 1024 * 1024;
const MAX_REGISTRY_TOKEN_BYTES = 4 * 1024;
const MAX_SSH_FILE_BYTES = 1024 * 1024;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SSH_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const TOKEN_PATTERN = /^[\x21-\x7e]{20,4096}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ALLOWED_REGISTRY_TOKEN_SCOPES = new Set([
  "read:packages",
  "write:packages",
]);

async function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function appendChunk(chunks, chunk, currentSize, limit, child) {
  const nextSize = currentSize + chunk.length;
  if (nextSize > limit) {
    child.kill("SIGTERM");
    return { exceeded: true, size: nextSize };
  }
  chunks.push(chunk);
  return { exceeded: false, size: nextSize };
}

async function defaultRunProcess(command, args, options = {}) {
  const captureStdout = options.captureStdout === true;
  const captureStderr = options.captureStderr === true;
  const outputLimit = options.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        captureStdout ? "pipe" : "inherit",
        captureStderr ? "pipe" : "inherit",
      ],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let outputExceeded = false;

    child.stdout?.on("data", (chunk) => {
      const result = appendChunk(
        stdoutChunks,
        chunk,
        stdoutSize,
        outputLimit,
        child,
      );
      stdoutSize = result.size;
      outputExceeded ||= result.exceeded;
    });
    child.stderr?.on("data", (chunk) => {
      const result = appendChunk(
        stderrChunks,
        chunk,
        stderrSize,
        outputLimit,
        child,
      );
      stderrSize = result.size;
      outputExceeded ||= result.exceeded;
    });
    child.on("error", (cause) => {
      reject(
        new ReleaseGateError(
          "LOCAL_RELEASE_PROCESS_START_FAILED",
          `Не удалось запустить ${command}`,
          { cause },
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (outputExceeded) {
        reject(
          new ReleaseGateError(
            "LOCAL_RELEASE_PROCESS_OUTPUT_LIMIT",
            `${command} превысил допустимый объём вывода`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new ReleaseGateError(
            "LOCAL_RELEASE_PROCESS_FAILED",
            `${command} завершился с кодом ${code ?? "<нет>"}${signal ? ` и сигналом ${signal}` : ""}`,
          ),
        );
        return;
      }
      resolve({
        stderr: Buffer.concat(stderrChunks),
        stdout: Buffer.concat(stdoutChunks),
      });
    });

    if (options.input !== undefined) {
      child.stdin.on("error", (cause) => {
        if (cause?.code !== "EPIPE") {
          child.kill("SIGTERM");
        }
      });
      child.stdin.end(options.input);
    }
  });
}

async function commandOutput(runCommand, command, args, options) {
  const result = await runCommand(command, args, options);
  assertGate(
    result && typeof result.stdout === "string",
    "LOCAL_RELEASE_COMMAND_OUTPUT_INVALID",
    `${command} вернул неожиданный результат`,
  );
  return result.stdout.trim();
}

function takeArgumentValue(args, index, argument) {
  const value = args[index + 1];
  assertGate(
    typeof value === "string" && value.length > 0 && !value.startsWith("--"),
    "LOCAL_RELEASE_ARGUMENT_VALUE_MISSING",
    `После ${argument} не задано значение`,
  );
  return value;
}

export function parseLocalReleaseArguments(args) {
  const parsed = {
    confirmation: null,
    help: false,
    host: null,
    knownHostsPath: null,
    mode: null,
    port: null,
    sshKeyPath: null,
    user: null,
  };
  const valueArguments = new Map([
    ["--confirmation", "confirmation"],
    ["--host", "host"],
    ["--known-hosts", "knownHostsPath"],
    ["--port", "port"],
    ["--ssh-key", "sshKeyPath"],
    ["--user", "user"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--verify" || argument === "--release") {
      assertGate(
        parsed.mode === null,
        "LOCAL_RELEASE_MODE_DUPLICATED",
        "Режим локального выпуска указан больше одного раза",
      );
      parsed.mode = argument.slice(2);
      continue;
    }
    if (valueArguments.has(argument)) {
      const property = valueArguments.get(argument);
      assertGate(
        parsed[property] === null,
        "LOCAL_RELEASE_ARGUMENT_DUPLICATED",
        `Аргумент ${argument} указан больше одного раза`,
      );
      parsed[property] = takeArgumentValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new ReleaseGateError(
      "LOCAL_RELEASE_ARGUMENT_UNKNOWN",
      `Неизвестный аргумент локального выпуска: ${argument}`,
    );
  }

  if (parsed.help) {
    assertGate(
      args.length === 1,
      "LOCAL_RELEASE_HELP_ARGUMENTS_INVALID",
      "--help нельзя совмещать с другими аргументами",
    );
    return parsed;
  }

  assertGate(
    parsed.mode === "verify" || parsed.mode === "release",
    "LOCAL_RELEASE_MODE_REQUIRED",
    "Укажите ровно один режим: --verify или --release",
  );

  const releaseOnlyProperties = [
    "confirmation",
    "host",
    "knownHostsPath",
    "port",
    "sshKeyPath",
    "user",
  ];
  if (parsed.mode === "verify") {
    assertGate(
      releaseOnlyProperties.every((property) => parsed[property] === null),
      "LOCAL_RELEASE_VERIFY_ARGUMENTS_FORBIDDEN",
      "Режим --verify не принимает SSH-параметры или подтверждение",
    );
    return parsed;
  }

  for (const property of releaseOnlyProperties) {
    assertGate(
      typeof parsed[property] === "string" && parsed[property].length > 0,
      "LOCAL_RELEASE_ARGUMENT_REQUIRED",
      `Для --release не задан обязательный параметр ${property}`,
    );
  }
  assertGate(
    HOST_PATTERN.test(parsed.host),
    "LOCAL_RELEASE_HOST_INVALID",
    "Production host имеет недопустимый формат",
  );
  assertGate(
    /^\d{1,5}$/.test(parsed.port) &&
      Number(parsed.port) >= 1 &&
      Number(parsed.port) <= 65_535,
    "LOCAL_RELEASE_PORT_INVALID",
    "Production port должен быть целым числом от 1 до 65535",
  );
  assertGate(
    SSH_USER_PATTERN.test(parsed.user),
    "LOCAL_RELEASE_USER_INVALID",
    "Production user имеет недопустимый формат",
  );
  return parsed;
}

export function validateMergedByOwner(pullRequest) {
  assertGate(
    String(pullRequest?.merged_by?.id ?? "") === CURRENT_LIFECYCLE_OWNER_ID,
    "LOCAL_RELEASE_MERGER_NOT_OWNER",
    "Связанный PR должен быть слит зафиксированным владельцем Академии",
  );
  return {
    id: String(pullRequest.merged_by.id),
    login: pullRequest.merged_by.login,
  };
}

function newestCheckRun(checkRuns) {
  return [...checkRuns].sort((left, right) => right.id - left.id)[0];
}

export function validateRequiredCheckRuns({ checkRuns, sha }) {
  assertGate(
    Array.isArray(checkRuns),
    "LOCAL_RELEASE_CHECK_RUNS_INVALID",
    "GitHub API не вернул список проверок",
  );
  const seenIds = new Set();
  for (const checkRun of checkRuns) {
    assertGate(
      Number.isSafeInteger(checkRun?.id) && checkRun.id > 0,
      "LOCAL_RELEASE_CHECK_RUN_INVALID",
      "GitHub API вернул проверку без допустимого ID",
    );
    assertGate(
      !seenIds.has(checkRun.id),
      "LOCAL_RELEASE_CHECK_RUN_DUPLICATED",
      `GitHub API повторил проверку ${checkRun.id}`,
    );
    seenIds.add(checkRun.id);
  }

  return SOURCE_BRANCH_REQUIRED_CHECKS.map((required) => {
    const candidates = checkRuns.filter(
      (checkRun) =>
        checkRun.name === required.context &&
        checkRun.app?.id === required.app_id,
    );
    assertGate(
      candidates.length > 0,
      "LOCAL_RELEASE_REQUIRED_CHECK_MISSING",
      `Для SHA ${sha} отсутствует обязательная проверка «${required.context}» нужного GitHub App`,
    );
    const checkRun = newestCheckRun(candidates);
    assertGate(
      checkRun.head_sha === sha &&
        checkRun.status === "completed" &&
        checkRun.conclusion === "success",
      "LOCAL_RELEASE_REQUIRED_CHECK_FAILED",
      `Последняя проверка «${required.context}» не завершилась успешно на SHA ${sha}`,
    );
    return {
      appId: required.app_id,
      id: checkRun.id,
      name: required.context,
    };
  });
}

export async function listCommitCheckRuns({ api, sha }) {
  const checkRuns = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const response = await api.request(
      api.repoPath(
        `/commits/${encodeURIComponent(sha)}/check-runs?per_page=100&page=${page}`,
      ),
    );
    assertGate(
      response.data && Array.isArray(response.data.check_runs),
      "LOCAL_RELEASE_CHECK_RUNS_RESPONSE_INVALID",
      "GitHub API вернул некорректный список проверок",
    );
    checkRuns.push(...response.data.check_runs);
    if (response.data.check_runs.length < 100) {
      return checkRuns;
    }
  }
  throw new ReleaseGateError(
    "LOCAL_RELEASE_CHECK_RUNS_LIMIT_EXCEEDED",
    `Для SHA ${sha} найдено больше ${MAX_GITHUB_PAGES * 100} проверок`,
  );
}

async function inspectReleaseCandidate({ api, sha, sleep }) {
  const pullRequest = await findMergedPullRequest({ api, sha, sleep });
  validateMergedByOwner(pullRequest);
  const files = await listPullRequestFiles({
    api,
    pullRequestNumber: pullRequest.number,
  });
  const classification = classifyMergedPullRequest({
    files,
    pullRequest,
    repository: ACADEMY_REPOSITORY,
    sha,
  });
  const requiredChecks = validateRequiredCheckRuns({
    checkRuns: await listCommitCheckRuns({ api, sha }),
    sha,
  });
  return { classification, pullRequest, requiredChecks };
}

async function inspectLocalTools({ cwd, runCommand }) {
  await commandOutput(runCommand, "docker", ["buildx", "version"], { cwd });
  await commandOutput(
    runCommand,
    "docker",
    ["info", "--format", "{{json .ServerVersion}}"],
    { cwd },
  );
  await runCommand("ssh", ["-V"], { cwd });
  await runCommand("tar", ["--version"], { cwd });
}

async function inspectSshFile(path, description) {
  const resolvedPath = await realpath(path);
  const metadata = await stat(resolvedPath);
  assertGate(
    metadata.isFile() &&
      metadata.size > 0 &&
      metadata.size <= MAX_SSH_FILE_BYTES,
    "LOCAL_RELEASE_SSH_FILE_INVALID",
    `${description} должен быть непустым обычным файлом допустимого размера`,
  );
  assertGate(
    (metadata.mode & 0o077) === 0,
    "LOCAL_RELEASE_SSH_FILE_PERMISSIONS_INVALID",
    `${description} не должен быть доступен группе или другим пользователям`,
  );
  if (typeof process.getuid === "function") {
    assertGate(
      metadata.uid === process.getuid(),
      "LOCAL_RELEASE_SSH_FILE_OWNER_INVALID",
      `${description} принадлежит другому системному пользователю`,
    );
  }
  return resolvedPath;
}

export function validateRegistryTokenBuffer(token) {
  assertGate(
    Buffer.isBuffer(token) &&
      token.length <= MAX_REGISTRY_TOKEN_BYTES &&
      TOKEN_PATTERN.test(token.toString("utf8")),
    "LOCAL_RELEASE_REGISTRY_TOKEN_INVALID",
    "Токен GHCR должен быть одной непустой ASCII-строкой допустимой длины",
  );
  return token;
}

async function readRegistryTokenFromStdin(input = process.stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    assertGate(
      size <= MAX_REGISTRY_TOKEN_BYTES + 2,
      "LOCAL_RELEASE_REGISTRY_TOKEN_TOO_LARGE",
      "Токен GHCR превышает допустимый размер",
    );
    chunks.push(buffer);
  }
  const token = Buffer.concat(chunks);
  for (const chunk of chunks) {
    chunk.fill(0);
  }
  if (token.at(-1) === 0x0a) {
    token.fill(0, token.length - 1);
    const withoutLf = token.subarray(0, token.length - 1);
    if (withoutLf.at(-1) === 0x0d) {
      withoutLf.fill(0, withoutLf.length - 1);
      return validateRegistryTokenBuffer(withoutLf.subarray(0, -1));
    }
    return validateRegistryTokenBuffer(withoutLf);
  }
  return validateRegistryTokenBuffer(token);
}

function parseTokenScopes(rawScopes) {
  return new Set(
    (rawScopes ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export async function verifyRegistryToken({
  fetchImpl = globalThis.fetch,
  token,
}) {
  validateRegistryTokenBuffer(token);
  let response;
  try {
    response = await fetchImpl("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.toString("utf8")}`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
    });
  } catch (cause) {
    throw new ReleaseGateError(
      "LOCAL_RELEASE_REGISTRY_TOKEN_TRANSPORT_FAILED",
      "Не удалось проверить токен GHCR через GitHub API",
      { cause },
    );
  }
  assertGate(
    response.ok,
    "LOCAL_RELEASE_REGISTRY_TOKEN_REJECTED",
    `GitHub API отклонил токен GHCR: HTTP ${response.status}`,
  );
  let user;
  try {
    user = await response.json();
  } catch {
    throw new ReleaseGateError(
      "LOCAL_RELEASE_REGISTRY_TOKEN_RESPONSE_INVALID",
      "GitHub API вернул некорректную карточку владельца токена GHCR",
    );
  }
  assertGate(
    String(user?.id ?? "") === CURRENT_LIFECYCLE_OWNER_ID,
    "LOCAL_RELEASE_REGISTRY_TOKEN_OWNER_MISMATCH",
    "Токен GHCR принадлежит не зафиксированному владельцу Академии",
  );
  const scopes = parseTokenScopes(response.headers.get("x-oauth-scopes"));
  assertGate(
    scopes.has("write:packages"),
    "LOCAL_RELEASE_REGISTRY_TOKEN_SCOPE_MISSING",
    "Токен GHCR не имеет минимального scope write:packages",
  );
  const excessiveScopes = [...scopes].filter(
    (scope) => !ALLOWED_REGISTRY_TOKEN_SCOPES.has(scope),
  );
  assertGate(
    excessiveScopes.length === 0,
    "LOCAL_RELEASE_REGISTRY_TOKEN_SCOPE_EXCESSIVE",
    `Токен GHCR имеет scopes вне package-only allowlist: ${excessiveScopes.join(", ")}`,
  );
  return { login: user.login, scopes: [...scopes].sort() };
}

function secretLine(token) {
  return Buffer.concat([token, Buffer.from("\n", "utf8")]);
}

export function sshArguments({ host, knownHostsPath, port, sshKeyPath, user }) {
  return [
    "-i",
    sshKeyPath,
    "-p",
    port,
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "ConnectTimeout=15",
    `${user}@${host}`,
  ];
}

export function buildArguments({
  context,
  dockerfile,
  image,
  labels,
  metadataPath,
  sha,
}) {
  assertGate(
    typeof metadataPath === "string" && metadataPath.length > 0,
    "LOCAL_RELEASE_BUILD_METADATA_PATH_REQUIRED",
    "Для production-сборки требуется отдельный файл metadata",
  );
  const args = [
    "buildx",
    "build",
    "--file",
    dockerfile,
    "--platform",
    "linux/amd64",
    "--pull",
    "--push",
    "--provenance=mode=max",
    "--sbom=true",
    "--metadata-file",
    metadataPath,
    "--tag",
    `${image}:${sha}`,
    "--tag",
    `${image}:main`,
  ];
  for (const label of labels) {
    args.push("--label", label);
  }
  args.push(context);
  return args;
}

export function parseBuildMetadata(contents) {
  const buffer = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(String(contents), "utf8");
  assertGate(
    buffer.length > 0 && buffer.length <= MAX_BUILD_METADATA_BYTES,
    "LOCAL_RELEASE_BUILD_METADATA_SIZE_INVALID",
    "Docker Buildx вернул metadata недопустимого размера",
  );
  let metadata;
  try {
    metadata = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ReleaseGateError(
      "LOCAL_RELEASE_BUILD_METADATA_INVALID",
      "Docker Buildx вернул некорректный JSON metadata",
    );
  }
  const digest = metadata?.["containerimage.digest"];
  assertGate(
    typeof digest === "string" && IMAGE_DIGEST_PATTERN.test(digest),
    "LOCAL_RELEASE_BUILD_DIGEST_INVALID",
    "Docker Buildx не подтвердил точный sha256 digest опубликованного образа",
  );
  const descriptorDigest = metadata?.["containerimage.descriptor"]?.digest;
  assertGate(
    descriptorDigest === undefined || descriptorDigest === digest,
    "LOCAL_RELEASE_BUILD_DIGEST_MISMATCH",
    "Digest образа не совпадает с digest его OCI descriptor",
  );
  return digest;
}

async function readBuildDigest(metadataPath) {
  const resolvedPath = await realpath(metadataPath);
  const file = await stat(resolvedPath);
  assertGate(
    file.isFile() && file.size > 0 && file.size <= MAX_BUILD_METADATA_BYTES,
    "LOCAL_RELEASE_BUILD_METADATA_FILE_INVALID",
    "Файл metadata Docker Buildx отсутствует или имеет недопустимый размер",
  );
  return parseBuildMetadata(await readFile(resolvedPath));
}

export async function executeProductionRelease({
  actorLogin,
  cwd,
  host,
  knownHostsPath,
  port,
  runProcess,
  sha,
  sshKeyPath,
  token,
  user,
  verifyCurrentMain,
}) {
  assertGate(
    typeof verifyCurrentMain === "function",
    "LOCAL_RELEASE_MAIN_RECHECK_REQUIRED",
    "Production-выпуск требует повторной проверки актуального main",
  );
  const dockerConfig = await mkdtemp(join(tmpdir(), "academy-release-docker-"));
  const applicationMetadataPath = join(
    dockerConfig,
    "application-build-metadata.json",
  );
  const egressMetadataPath = join(
    dockerConfig,
    "telegram-egress-build-metadata.json",
  );
  const processEnvironment = {
    ...process.env,
    DOCKER_CONFIG: dockerConfig,
  };
  for (const secretVariable of [
    "ACADEMY_GHCR_TOKEN",
    "GHCR_TOKEN",
    "GITHUB_TOKEN",
  ]) {
    delete processEnvironment[secretVariable];
  }
  const appLabels = [
    "org.opencontainers.image.title=Академия Абрикософф",
    "org.opencontainers.image.description=Production-образ веб-платформы Академии Абрикософф",
    `org.opencontainers.image.source=https://github.com/${ACADEMY_REPOSITORY}`,
    `org.opencontainers.image.revision=${sha}`,
  ];
  const egressLabels = [
    "org.opencontainers.image.title=Telegram-egress Академии Абрикософф",
    "org.opencontainers.image.description=Изолированный исходящий контур Telegram OIDC",
    `org.opencontainers.image.source=https://github.com/${ACADEMY_REPOSITORY}`,
    `org.opencontainers.image.revision=${sha}`,
  ];
  try {
    const loginInput = secretLine(token);
    try {
      await runProcess(
        "docker",
        [
          "--config",
          dockerConfig,
          "login",
          "ghcr.io",
          "--username",
          actorLogin,
          "--password-stdin",
        ],
        { cwd, env: processEnvironment, input: loginInput },
      );
    } finally {
      loginInput.fill(0);
    }

    await verifyCurrentMain();

    await runProcess(
      "docker",
      buildArguments({
        context: "./deploy/telegram-egress",
        dockerfile: "./deploy/telegram-egress/Dockerfile",
        image: PRODUCTION_TELEGRAM_EGRESS_IMAGE,
        labels: egressLabels,
        metadataPath: egressMetadataPath,
        sha,
      }),
      { cwd, env: processEnvironment },
    );
    const telegramEgressDigest = await readBuildDigest(egressMetadataPath);
    await runProcess(
      "docker",
      buildArguments({
        context: ".",
        dockerfile: "./Dockerfile",
        image: PRODUCTION_APPLICATION_IMAGE,
        labels: appLabels,
        metadataPath: applicationMetadataPath,
        sha,
      }),
      { cwd, env: processEnvironment },
    );
    const applicationDigest = await readBuildDigest(applicationMetadataPath);
    const applicationImageReference =
      `${PRODUCTION_APPLICATION_IMAGE}@${applicationDigest}`;

    await verifyCurrentMain();

    const archive = await runProcess(
      "tar",
      [
        "-C",
        "deploy",
        "-czf",
        "-",
        "Caddyfile",
        "compose.production.yaml",
      ],
      { captureStderr: true, captureStdout: true, cwd },
    );
    const sshBase = sshArguments({
      host,
      knownHostsPath,
      port,
      sshKeyPath,
      user,
    });
    await runProcess("ssh", [...sshBase, `upload ${sha}`], {
      cwd,
      input: archive.stdout,
    });

    const deployInput = secretLine(token);
    try {
      await runProcess(
        "ssh",
        [
          ...sshBase,
          `deploy ${sha} ${applicationImageReference} ${actorLogin}`,
        ],
        { cwd, input: deployInput },
      );
    } finally {
      deployInput.fill(0);
    }
    return { applicationDigest, telegramEgressDigest };
  } finally {
    await rm(dockerConfig, { force: true, recursive: true });
  }
}

export async function verifyPublicHealth({
  fetchImpl = globalThis.fetch,
  sha,
  sleep = globalThis.setTimeout,
}) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetchImpl(PRODUCTION_HEALTH_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      assertGate(
        response.ok,
        "LOCAL_RELEASE_HEALTH_HTTP_FAILED",
        `Production health endpoint вернул HTTP ${response.status}`,
      );
      const body = await response.json();
      assertGate(
        body?.status === "ok" && body?.version === sha,
        "LOCAL_RELEASE_HEALTH_VERSION_MISMATCH",
        "Production health endpoint не подтвердил точный SHA выпуска",
      );
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await new Promise((resolve) => sleep(resolve, 5_000));
      }
    }
  }
  throw new ReleaseGateError(
    "LOCAL_RELEASE_HEALTH_RETRIES_EXHAUSTED",
    `Production не подтвердил SHA ${sha} после локального выпуска`,
    { cause: lastError },
  );
}

async function createGitHubApiFromCli({ cwd, runCommand }) {
  const token = await commandOutput(runCommand, "gh", ["auth", "token"], {
    cwd,
  });
  return new GitHubApi({ repository: ACADEMY_REPOSITORY, token });
}

export async function runLocalRelease(options, dependencies = {}) {
  const cwd = dependencies.cwd ?? process.cwd();
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const inspectCheckout = dependencies.inspectCheckout ?? inspectTrustedCheckout;
  const checkout = await inspectCheckout({ cwd, runCommand });
  const verifyCurrentMain = async () => {
    const currentCheckout = await inspectCheckout({ cwd, runCommand });
    assertGate(
      currentCheckout.mainSha === checkout.mainSha,
      "LOCAL_RELEASE_MAIN_CHANGED",
      `Актуальный main изменился после проверки кандидата ${checkout.mainSha}`,
    );
    return currentCheckout;
  };
  const platform = await (
    dependencies.inspectPlatform ?? inspectOwnerPlatformContext
  )({ cwd, runCommand });
  const api =
    dependencies.api ?? (await createGitHubApiFromCli({ cwd, runCommand }));
  const candidate = await inspectReleaseCandidate({
    api,
    sha: checkout.mainSha,
    sleep: dependencies.sleep,
  });

  if (!candidate.classification.shouldDeploy) {
    assertGate(
      options.mode === "verify",
      "LOCAL_RELEASE_DEPLOYMENT_NOT_REQUIRED",
      `PR #${candidate.pullRequest.number} относится к infrastructure-no-deploy и не должен менять production`,
    );
    return {
      actorLogin: platform.actorLogin,
      deploymentRequired: false,
      pullRequestNumber: candidate.pullRequest.number,
      requiredChecks: candidate.requiredChecks,
      sha: checkout.mainSha,
    };
  }

  await (dependencies.inspectTools ?? inspectLocalTools)({ cwd, runCommand });
  const expectedConfirmation =
    `${LOCAL_PRODUCTION_RELEASE_CONFIRMATION} ${checkout.mainSha}`;
  if (options.mode === "verify") {
    return {
      actorLogin: platform.actorLogin,
      confirmation: expectedConfirmation,
      deploymentRequired: true,
      pullRequestNumber: candidate.pullRequest.number,
      requiredChecks: candidate.requiredChecks,
      sha: checkout.mainSha,
    };
  }

  assertGate(
    options.confirmation === expectedConfirmation,
    "LOCAL_RELEASE_CONFIRMATION_INVALID",
    `Точное подтверждение должно быть: ${expectedConfirmation}`,
  );
  const [sshKeyPath, knownHostsPath] = await Promise.all([
    inspectSshFile(options.sshKeyPath, "SSH private key"),
    inspectSshFile(options.knownHostsPath, "SSH known_hosts"),
  ]);
  const suppliedToken = await (
    dependencies.readRegistryToken ?? readRegistryTokenFromStdin
  )();
  const token = Buffer.from(suppliedToken);
  try {
    const tokenIdentity = await verifyRegistryToken({
      fetchImpl: dependencies.fetchImpl,
      token,
    });
    assertGate(
      tokenIdentity.login === platform.actorLogin,
      "LOCAL_RELEASE_REGISTRY_LOGIN_MISMATCH",
      "Login токена GHCR не совпадает с текущей сессией владельца",
    );
    await verifyCurrentMain();
    const releaseResult = await (
      dependencies.executeRelease ?? executeProductionRelease
    )({
      actorLogin: platform.actorLogin,
      cwd,
      host: options.host,
      knownHostsPath,
      port: options.port,
      runProcess: dependencies.runProcess ?? defaultRunProcess,
      sha: checkout.mainSha,
      sshKeyPath,
      token,
      user: options.user,
      verifyCurrentMain,
    });
    await (dependencies.verifyHealth ?? verifyPublicHealth)({
      fetchImpl: dependencies.fetchImpl,
      sha: checkout.mainSha,
      sleep: dependencies.sleep,
    });
    return {
      actorLogin: platform.actorLogin,
      applicationDigest: releaseResult?.applicationDigest,
      deploymentRequired: true,
      deployed: true,
      pullRequestNumber: candidate.pullRequest.number,
      requiredChecks: candidate.requiredChecks,
      sha: checkout.mainSha,
      telegramEgressDigest: releaseResult?.telegramEgressDigest,
    };
  } finally {
    token.fill(0);
    if (Buffer.isBuffer(suppliedToken)) {
      suppliedToken.fill(0);
    }
  }
}

function helpText() {
  return [
    "Локальный production-выпуск Академии",
    "",
    "Только проверка:",
    "  node scripts/release-train/local-release.mjs --verify",
    "",
    "Выпуск (токен GHCR передаётся только через stdin):",
    "  node scripts/release-train/local-release.mjs --release \\",
    "    --host HOST --port PORT --user USER \\",
    "    --ssh-key /absolute/path/key \\",
    "    --known-hosts /absolute/path/known_hosts \\",
    `    --confirmation "${LOCAL_PRODUCTION_RELEASE_CONFIRMATION} <40-значный SHA>"`,
  ].join("\n");
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    const options = parseLocalReleaseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(helpText());
    } else {
      const result = await runLocalRelease(options);
      if (!result.deploymentRequired) {
        console.log(
          `PR #${result.pullRequestNumber}, SHA ${result.sha}: production-выпуск не требуется.`,
        );
      } else if (options.mode === "verify") {
        console.log(
          `PR #${result.pullRequestNumber}, SHA ${result.sha}: локальный выпуск готов. Подтверждение: ${result.confirmation}`,
        );
      } else {
        const digestSuffix = result.applicationDigest
          ? `, образ ${PRODUCTION_APPLICATION_IMAGE}@${result.applicationDigest}`
          : "";
        const egressDigestSuffix = result.telegramEgressDigest
          ? `, Telegram-egress ${PRODUCTION_TELEGRAM_EGRESS_IMAGE}@${result.telegramEgressDigest}`
          : "";
        console.log(
          `PR #${result.pullRequestNumber}, SHA ${result.sha}${digestSuffix}${egressDigestSuffix}: production успешно подтверждён.`,
        );
      }
    }
  } catch (error) {
    console.error(formatGateError(error));
    process.exitCode = 1;
  }
}
