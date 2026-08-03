export const GITHUB_API_VERSION = "2026-03-10";
export const ACADEMY_REPOSITORY = "Abrikosov-group/abrikosoff-academy";
export const DEFAULT_BRANCH = "main";
export const PRODUCTION_ENVIRONMENT = "production";
export const REGISTRY_BRANCH = "release-train-registry";
export const REGISTRY_METADATA_PATH = "registry.json";
export const REGISTRY_SCHEMA_VERSION = 1;
export const GITHUB_ACTIONS_APP_ID = 15368;

export const CURRENT_BOOTSTRAP_TRAIN = Object.freeze({
  expectedHeadSha: "bb6e69adeefe59aa31ddb7e118d6c685074f4dd1",
  openedFromMainSha: "cb7cca60d11f22ec18aa1751ec607ab30f6b3787",
  sourceBranch: "codex/admin-operational-mvp",
});

export const SOURCE_BRANCH_REQUIRED_CHECKS = Object.freeze([
  Object.freeze({
    app_id: GITHUB_ACTIONS_APP_ID,
    context: "Production-wrapper Administration",
  }),
  Object.freeze({
    app_id: GITHUB_ACTIONS_APP_ID,
    context: "Контур исходящих запросов Telegram",
  }),
  Object.freeze({
    app_id: GITHUB_ACTIONS_APP_ID,
    context: "Код, тесты и production-сборка",
  }),
  Object.freeze({
    app_id: GITHUB_ACTIONS_APP_ID,
    context: "Начальный шлюз релизного поезда",
  }),
]);

export const INFRASTRUCTURE_NO_DEPLOY_LABEL =
  "release:infrastructure-no-deploy";

export const INFRASTRUCTURE_NO_DEPLOY_PATHS = Object.freeze(
  new Set([
    ".github/pull_request_template.md",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/workflows/train-lifecycle.yml",
    "AGENTS.md",
    "README.md",
    "docs/admin-panel-implementation-status.md",
    "docs/decisions/0009-integration-release-train.md",
    "docs/development-workflow.md",
    "docs/operations/release-train.md",
    "scripts/release-train/config.mjs",
    "scripts/release-train/errors.mjs",
    "scripts/release-train/github-api.mjs",
    "scripts/release-train/registry.mjs",
    "scripts/release-train/release-classifier.mjs",
    "scripts/release-train/train-lifecycle.mjs",
    "tests/release-train/registry.test.mjs",
    "tests/release-train/release-classifier.test.mjs",
    "tests/release-train/train-lifecycle.test.mjs",
    "tests/release-train/workflow-contract.test.mjs",
  ]),
);

export const REGISTRY_METADATA = Object.freeze({
  kind: "abrikosoff_academy_release_train_registry",
  schema_version: REGISTRY_SCHEMA_VERSION,
});

export const MAX_REGISTRY_COMMITS = 1_000;
export const MAX_RELEASE_PR_LOOKUP_ATTEMPTS = 6;
export const MAX_GITHUB_PAGES = 30;
export const TRAIN_OPEN_CONFIRMATION = "ОТКРЫТЬ РЕЛИЗНЫЙ ПОЕЗД";
