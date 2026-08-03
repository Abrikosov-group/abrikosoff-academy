import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  ACADEMY_REPOSITORY,
  DEFAULT_BRANCH,
  INFRASTRUCTURE_NO_DEPLOY_LABEL,
  INFRASTRUCTURE_NO_DEPLOY_PATHS,
  MAX_GITHUB_PAGES,
  MAX_RELEASE_PR_LOOKUP_ATTEMPTS,
} from "./config.mjs";
import { ReleaseGateError, assertGate, formatGateError } from "./errors.mjs";
import {
  GitHubApi,
  GitHubApiError,
  GitHubTransportError,
} from "./github-api.mjs";

const RETRY_DELAYS_MS = Object.freeze([0, 2_000, 4_000, 8_000, 16_000, 30_000]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const FILE_STATUSES = new Set([
  "added",
  "changed",
  "copied",
  "modified",
  "removed",
  "renamed",
  "unchanged",
]);
const PULL_REQUEST_MERGE_COMMIT_QUERY = `
  query ReleasePullRequestMergeCommit(
    $owner: String!
    $name: String!
    $number: Int!
  ) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        baseRefName
        mergeCommit {
          oid
        }
        merged
        mergedAt
        number
      }
    }
  }
`;

function hasLabel(pullRequest, label) {
  return (pullRequest.labels ?? []).some((item) => item?.name === label);
}

function isSameRepositoryHead(pullRequest, repository) {
  return pullRequest.head?.repo?.full_name === repository;
}

function requirePullRequestNumber(pullRequest) {
  assertGate(
    Number.isSafeInteger(pullRequest?.number) && pullRequest.number > 0,
    "RELEASE_PR_NUMBER_INVALID",
    "Связанный PR не содержит допустимый номер",
  );
  return pullRequest.number;
}

async function getPullRequestMergeCommitSha({ api, pullRequestNumber }) {
  const [owner, name] = ACADEMY_REPOSITORY.split("/");
  const response = await api.request("/graphql", {
    body: {
      query: PULL_REQUEST_MERGE_COMMIT_QUERY,
      variables: { name, number: pullRequestNumber, owner },
    },
    method: "POST",
  });
  const responseBody = response.data;
  assertGate(
    responseBody && typeof responseBody === "object" && !Array.isArray(responseBody),
    "RELEASE_PR_GRAPHQL_RESPONSE_INVALID",
    `GitHub GraphQL вернул некорректный ответ для PR #${pullRequestNumber}`,
  );
  assertGate(
    responseBody.errors === undefined ||
      responseBody.errors === null ||
      (Array.isArray(responseBody.errors) && responseBody.errors.length === 0),
    "RELEASE_PR_GRAPHQL_ERROR",
    `GitHub GraphQL не подтвердил merge-коммит PR #${pullRequestNumber}`,
  );

  const pullRequest = responseBody.data?.repository?.pullRequest;
  assertGate(
    pullRequest && typeof pullRequest === "object" && !Array.isArray(pullRequest),
    "RELEASE_PR_GRAPHQL_RESPONSE_INVALID",
    `GitHub GraphQL не вернул PR #${pullRequestNumber}`,
  );
  assertGate(
    pullRequest.number === pullRequestNumber,
    "RELEASE_PR_NUMBER_MISMATCH",
    `GraphQL-карточка связанного PR #${pullRequestNumber} содержит другой номер`,
  );
  assertGate(
    pullRequest.merged === true && pullRequest.mergedAt,
    "RELEASE_PR_NOT_MERGED",
    `GraphQL-карточка PR #${pullRequestNumber} не подтверждает слияние`,
  );
  assertGate(
    pullRequest.baseRefName === DEFAULT_BRANCH,
    "RELEASE_PR_BASE_REJECTED",
    `GraphQL-карточка PR #${pullRequestNumber} не направлена в ${DEFAULT_BRANCH}`,
  );

  const mergeCommitSha = pullRequest.mergeCommit?.oid;
  assertGate(
    typeof mergeCommitSha === "string" && /^[0-9a-f]{40}$/.test(mergeCommitSha),
    "RELEASE_PR_MERGE_COMMIT_INVALID",
    `GitHub GraphQL не вернул допустимый merge SHA PR #${pullRequestNumber}`,
  );
  return mergeCommitSha;
}

export function validateReleaseInvocation({ eventName, ref, repository, sha }) {
  assertGate(
    repository === ACADEMY_REPOSITORY,
    "RELEASE_REPOSITORY_REJECTED",
    "Production-выпуск запущен не в доверенном репозитории Академии",
  );
  assertGate(
    eventName === "push" || eventName === "workflow_dispatch",
    "RELEASE_EVENT_REJECTED",
    `Событие ${eventName || "<пусто>"} не может запускать production-выпуск`,
  );
  assertGate(
    ref === `refs/heads/${DEFAULT_BRANCH}`,
    "RELEASE_REF_REJECTED",
    `Production-выпуск разрешён только из refs/heads/${DEFAULT_BRANCH}`,
  );
  assertGate(
    /^[0-9a-f]{40}$/.test(sha ?? ""),
    "RELEASE_SHA_INVALID",
    "SHA production-выпуска должен содержать 40 шестнадцатеричных символов",
  );
}

export function validateInfrastructureFiles(files) {
  assertGate(files.length > 0, "INFRASTRUCTURE_FILES_EMPTY", "Инфраструктурный PR не содержит файлов");

  const seen = new Set();
  for (const file of files) {
    assertGate(
      file && typeof file.filename === "string" && file.filename.length > 0,
      "INFRASTRUCTURE_FILE_INVALID",
      "GitHub API вернул файл без имени",
    );
    assertGate(
      FILE_STATUSES.has(file.status),
      "INFRASTRUCTURE_FILE_STATUS_INVALID",
      `Файл ${file.filename} имеет неподдерживаемый статус ${file.status}`,
    );
    assertGate(
      !seen.has(file.filename),
      "INFRASTRUCTURE_FILE_DUPLICATED",
      `Файл ${file.filename} повторяется в ответе GitHub API`,
    );
    seen.add(file.filename);

    assertGate(
      INFRASTRUCTURE_NO_DEPLOY_PATHS.has(file.filename),
      "INFRASTRUCTURE_PATH_REJECTED",
      `Файл ${file.filename} не входит в статический infrastructure-no-deploy allowlist`,
    );

    if (file.status === "renamed" || file.status === "copied") {
      assertGate(
        typeof file.previous_filename === "string" &&
          INFRASTRUCTURE_NO_DEPLOY_PATHS.has(file.previous_filename),
        "INFRASTRUCTURE_PREVIOUS_PATH_REJECTED",
        `Исходный путь ${file.previous_filename ?? "<пусто>"} не входит в allowlist`,
      );
    }
  }
}

export function classifyMergedPullRequest({ files, pullRequest, repository, sha }) {
  requirePullRequestNumber(pullRequest);
  assertGate(pullRequest?.merged_at, "RELEASE_PR_NOT_MERGED", "Связанный PR не слит");
  assertGate(
    pullRequest.base?.ref === DEFAULT_BRANCH,
    "RELEASE_PR_BASE_REJECTED",
    `Базовая ветка связанного PR должна быть ${DEFAULT_BRANCH}`,
  );
  assertGate(
    pullRequest.merge_commit_sha === sha,
    "RELEASE_PR_SHA_MISMATCH",
    "Merge SHA связанного PR не совпадает с SHA запуска",
  );
  assertGate(
    isSameRepositoryHead(pullRequest, repository),
    "RELEASE_PR_FORK_REJECTED",
    "Production-кандидат должен происходить из того же репозитория",
  );

  const infrastructure = hasLabel(pullRequest, INFRASTRUCTURE_NO_DEPLOY_LABEL);
  const hotfix = /^codex\/hotfix-[a-z0-9][a-z0-9._/-]*$/.test(
    pullRequest.head?.ref ?? "",
  );

  assertGate(
    !(infrastructure && hotfix),
    "RELEASE_CLASS_AMBIGUOUS",
    "PR одновременно помечен как infrastructure-no-deploy и hotfix",
  );

  if (infrastructure) {
    validateInfrastructureFiles(files);
    return {
      pullRequestNumber: pullRequest.number,
      releaseClass: "infrastructure-no-deploy",
      shouldDeploy: false,
    };
  }

  assertGate(
    hotfix,
    "RELEASE_SOURCE_REJECTED",
    "До финального шлюза в main разрешены только hotfix и infrastructure-no-deploy PR",
  );

  return {
    pullRequestNumber: pullRequest.number,
    releaseClass: "hotfix",
    shouldDeploy: true,
  };
}

function parseIntegerHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

export function retryDelayMs({ attemptIndex, error, nowMs = Date.now() }) {
  const baseDelay = RETRY_DELAYS_MS[Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)];
  if (!(error instanceof GitHubApiError)) {
    return baseDelay;
  }

  const retryAfterSeconds = parseIntegerHeader(error.headers, "retry-after");
  if (retryAfterSeconds !== null) {
    return Math.min(60_000, Math.max(baseDelay, retryAfterSeconds * 1_000));
  }

  const remaining = parseIntegerHeader(error.headers, "x-ratelimit-remaining");
  const resetSeconds = parseIntegerHeader(error.headers, "x-ratelimit-reset");
  if (error.status === 403 && remaining === 0 && resetSeconds !== null) {
    return Math.min(
      60_000,
      Math.max(baseDelay, resetSeconds * 1_000 - nowMs + 1_000),
    );
  }

  return baseDelay;
}

function isRetryableApiError(error) {
  if (error instanceof GitHubTransportError) {
    return true;
  }
  if (!(error instanceof GitHubApiError)) {
    return false;
  }
  if (RETRYABLE_STATUSES.has(error.status)) {
    return true;
  }
  return (
    error.status === 403 &&
    parseIntegerHeader(error.headers, "x-ratelimit-remaining") === 0
  );
}

export async function findMergedPullRequest({ api, sha, sleep = globalThis.setTimeout }) {
  for (let attemptIndex = 0; attemptIndex < MAX_RELEASE_PR_LOOKUP_ATTEMPTS; attemptIndex += 1) {
    let candidates;
    try {
      const response = await api.request(
        api.repoPath(`/commits/${encodeURIComponent(sha)}/pulls?per_page=100`),
      );
      assertGate(
        Array.isArray(response.data),
        "RELEASE_PR_RESPONSE_INVALID",
        "GitHub API вернул не список связанных PR",
      );

      const associatedNumbers = [];
      const seenNumbers = new Set();
      for (const pullRequest of response.data) {
        if (!pullRequest?.merged_at || pullRequest.base?.ref !== DEFAULT_BRANCH) {
          continue;
        }

        const pullRequestNumber = requirePullRequestNumber(pullRequest);
        assertGate(
          !seenNumbers.has(pullRequestNumber),
          "RELEASE_PR_ASSOCIATION_DUPLICATED",
          `GitHub API повторил связанный PR #${pullRequestNumber}`,
        );
        seenNumbers.add(pullRequestNumber);
        associatedNumbers.push(pullRequestNumber);
      }

      candidates = [];
      for (const pullRequestNumber of associatedNumbers) {
        const detailsResponse = await api.request(
          api.repoPath(`/pulls/${pullRequestNumber}`),
        );
        const pullRequest = detailsResponse.data;
        assertGate(
          pullRequest && typeof pullRequest === "object" && !Array.isArray(pullRequest),
          "RELEASE_PR_RESPONSE_INVALID",
          `GitHub API вернул некорректную карточку PR #${pullRequestNumber}`,
        );
        assertGate(
          pullRequest.number === pullRequestNumber,
          "RELEASE_PR_NUMBER_MISMATCH",
          `Карточка связанного PR #${pullRequestNumber} содержит другой номер`,
        );

        const verifiedPullRequest = {
          ...pullRequest,
          merge_commit_sha: await getPullRequestMergeCommitSha({
            api,
            pullRequestNumber,
          }),
        };

        if (
          verifiedPullRequest.merged_at &&
          verifiedPullRequest.base?.ref === DEFAULT_BRANCH &&
          verifiedPullRequest.merge_commit_sha === sha
        ) {
          candidates.push(verifiedPullRequest);
        }
      }
    } catch (error) {
      if (!isRetryableApiError(error) || attemptIndex === MAX_RELEASE_PR_LOOKUP_ATTEMPTS - 1) {
        throw error;
      }
      await new Promise((resolve) => sleep(resolve, retryDelayMs({ attemptIndex, error })));
      continue;
    }

    assertGate(
      candidates.length <= 1,
      "RELEASE_PR_AMBIGUOUS",
      `Для SHA ${sha} найдено несколько связанных слитых PR в ${DEFAULT_BRANCH}`,
    );
    if (candidates.length === 1) {
      return candidates[0];
    }

    if (attemptIndex < MAX_RELEASE_PR_LOOKUP_ATTEMPTS - 1) {
      await new Promise((resolve) => sleep(resolve, retryDelayMs({ attemptIndex })));
    }
  }

  throw new ReleaseGateError(
    "RELEASE_PR_NOT_FOUND",
    `Для SHA ${sha} не найден ровно один связанный слитый PR в ${DEFAULT_BRANCH}`,
  );
}

export async function listPullRequestFiles({ api, pullRequestNumber }) {
  const files = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const response = await api.request(
      api.repoPath(`/pulls/${pullRequestNumber}/files?per_page=100&page=${page}`),
    );
    assertGate(Array.isArray(response.data), "RELEASE_FILES_RESPONSE_INVALID", "GitHub API вернул не список файлов PR");
    files.push(...response.data);
    if (response.data.length < 100) {
      return files;
    }
  }

  throw new ReleaseGateError(
    "RELEASE_FILES_LIMIT_EXCEEDED",
    `PR #${pullRequestNumber} содержит больше ${MAX_GITHUB_PAGES * 100} файлов`,
  );
}

async function writeActionsResult(result, env) {
  assertGate(env.GITHUB_OUTPUT, "GITHUB_OUTPUT_MISSING", "GITHUB_OUTPUT не задан");
  await appendFile(
    env.GITHUB_OUTPUT,
    [
      `pull_request_number=${result.pullRequestNumber}`,
      `release_class=${result.releaseClass}`,
      `should_deploy=${result.shouldDeploy ? "true" : "false"}`,
      "",
    ].join("\n"),
    "utf8",
  );

  if (env.GITHUB_STEP_SUMMARY) {
    const action = result.shouldDeploy
      ? "разрешена действующая hotfix-процедура"
      : "сборка и deployment пропущены";
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      [
        "### Классификация production-выпуска",
        "",
        `- PR: #${result.pullRequestNumber}`,
        `- Класс: \`${result.releaseClass}\``,
        `- Результат: ${action}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

export async function runReleaseClassifier(env = process.env, dependencies = {}) {
  validateReleaseInvocation({
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA,
  });

  const api =
    dependencies.api ??
    new GitHubApi({
      apiUrl: env.GITHUB_API_URL,
      repository: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
    });
  const pullRequest = await findMergedPullRequest({
    api,
    sha: env.GITHUB_SHA,
    sleep: dependencies.sleep,
  });
  const files = await listPullRequestFiles({
    api,
    pullRequestNumber: pullRequest.number,
  });
  const result = classifyMergedPullRequest({
    files,
    pullRequest,
    repository: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA,
  });

  if (!dependencies.skipOutput) {
    await writeActionsResult(result, env);
  }
  return result;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runReleaseClassifier().catch((error) => {
    console.error(formatGateError(error));
    process.exitCode = 1;
  });
}
