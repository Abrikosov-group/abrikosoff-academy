import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMergedPullRequest,
  findMergedPullRequest,
  listPullRequestFiles,
  retryDelayMs,
  validateInfrastructureFiles,
  validateReleaseInvocation,
} from "../../scripts/release-train/release-classifier.mjs";
import { GitHubApiError } from "../../scripts/release-train/github-api.mjs";

const REPOSITORY = "Abrikosov-group/abrikosoff-academy";
const SHA = "a".repeat(40);

function pullRequest(overrides = {}) {
  return {
    base: { ref: "main" },
    head: { ref: "codex/hotfix-example", repo: { full_name: REPOSITORY } },
    labels: [],
    merge_commit_sha: SHA,
    merged_at: "2026-08-02T12:00:00Z",
    number: 40,
    ...overrides,
  };
}

test("production-выпуск отклоняет ref, отличный от main", () => {
  assert.throws(
    () =>
      validateReleaseInvocation({
        eventName: "workflow_dispatch",
        ref: "refs/heads/codex/admin-operational-mvp",
        repository: REPOSITORY,
        sha: SHA,
      }),
    { code: "RELEASE_REF_REJECTED" },
  );
});

test("production-выпуск привязан к доверенному репозиторию", () => {
  assert.throws(
    () =>
      validateReleaseInvocation({
        eventName: "push",
        ref: "refs/heads/main",
        repository: "fork/abrikosoff-academy",
        sha: SHA,
      }),
    { code: "RELEASE_REPOSITORY_REJECTED" },
  );
});

test("infrastructure-no-deploy проходит только для статического allowlist", () => {
  const result = classifyMergedPullRequest({
    files: [
      { filename: ".github/workflows/release.yml", status: "modified" },
      { filename: "scripts/release-train/config.mjs", status: "added" },
    ],
    pullRequest: pullRequest({
      head: {
        ref: "codex/release-train-initial-gate",
        repo: { full_name: REPOSITORY },
      },
      labels: [{ name: "release:infrastructure-no-deploy" }],
    }),
    repository: REPOSITORY,
    sha: SHA,
  });
  assert.deepEqual(result, {
    pullRequestNumber: 40,
    releaseClass: "infrastructure-no-deploy",
    shouldDeploy: false,
  });

  assert.throws(
    () =>
      validateInfrastructureFiles([
        { filename: "src/app/page.tsx", status: "modified" },
      ]),
    { code: "INFRASTRUCTURE_PATH_REJECTED" },
  );
});

test("rename проверяет новый и предыдущий путь", () => {
  assert.throws(
    () =>
      validateInfrastructureFiles([
        {
          filename: "docs/operations/release-train.md",
          previous_filename: "src/app/page.tsx",
          status: "renamed",
        },
      ]),
    { code: "INFRASTRUCTURE_PREVIOUS_PATH_REJECTED" },
  );
});

test("hotfix из того же репозитория сохраняет действующий deployment", () => {
  const result = classifyMergedPullRequest({
    files: [{ filename: "src/app/page.tsx", status: "modified" }],
    pullRequest: pullRequest(),
    repository: REPOSITORY,
    sha: SHA,
  });
  assert.equal(result.releaseClass, "hotfix");
  assert.equal(result.shouldDeploy, true);
});

test("обычный функциональный PR и fork отклоняются", () => {
  assert.throws(
    () =>
      classifyMergedPullRequest({
        files: [{ filename: "src/app/page.tsx", status: "modified" }],
        pullRequest: pullRequest({
          head: { ref: "codex/feature", repo: { full_name: REPOSITORY } },
        }),
        repository: REPOSITORY,
        sha: SHA,
      }),
    { code: "RELEASE_SOURCE_REJECTED" },
  );

  assert.throws(
    () =>
      classifyMergedPullRequest({
        files: [{ filename: "src/app/page.tsx", status: "modified" }],
        pullRequest: pullRequest({
          head: { ref: "codex/hotfix-example", repo: { full_name: "fork/repo" } },
        }),
        repository: REPOSITORY,
        sha: SHA,
      }),
    { code: "RELEASE_PR_FORK_REJECTED" },
  );
});

test("номер связанного PR обязан быть положительным целым числом", () => {
  assert.throws(
    () =>
      classifyMergedPullRequest({
        files: [{ filename: "src/app/page.tsx", status: "modified" }],
        pullRequest: pullRequest({ number: "40\nshould_deploy=true" }),
        repository: REPOSITORY,
        sha: SHA,
      }),
    { code: "RELEASE_PR_NUMBER_INVALID" },
  );
});

test("поиск связанного PR повторяет временную ошибку API", async () => {
  let requests = 0;
  const delays = [];
  const api = {
    repoPath: (path) => `/repos/${REPOSITORY}${path}`,
    async request() {
      requests += 1;
      if (requests === 1) {
        throw new GitHubApiError({
          body: { message: "temporary" },
          method: "GET",
          path: "/test",
          response: { headers: new Headers(), status: 503 },
        });
      }
      return { data: [pullRequest()] };
    },
  };
  const found = await findMergedPullRequest({
    api,
    sha: SHA,
    sleep(resolve, delay) {
      delays.push(delay);
      resolve();
    },
  });
  assert.equal(found.number, 40);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [0]);
});

test("rate-limit delay учитывает Retry-After", () => {
  const error = new GitHubApiError({
    body: { message: "rate limited" },
    method: "GET",
    path: "/test",
    response: {
      headers: new Headers({ "retry-after": "7" }),
      status: 429,
    },
  });
  assert.equal(retryDelayMs({ attemptIndex: 1, error, nowMs: 0 }), 7_000);
});

test("список файлов PR читается с полной пагинацией", async () => {
  const pages = [];
  const api = {
    repoPath: (path) => path,
    async request(path) {
      const page = Number(new URL(`https://example.test${path}`).searchParams.get("page"));
      pages.push(page);
      return {
        data:
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({ filename: `${index}` }))
            : [{ filename: "last" }],
      };
    },
  };
  const files = await listPullRequestFiles({ api, pullRequestNumber: 40 });
  assert.equal(files.length, 101);
  assert.deepEqual(pages, [1, 2]);
});
