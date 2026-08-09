export const GITHUB_API_VERSION = "2026-03-10";
export const ACADEMY_REPOSITORY = "Abrikosov-group/abrikosoff-academy";
export const ACADEMY_REPOSITORY_NAME = "abrikosoff-academy";
export const GITHUB_ORGANIZATION = "Abrikosov-group";
export const DEFAULT_BRANCH = "main";
export const PRODUCTION_ENVIRONMENT = "production";
export const REGISTRY_BRANCH = "release-train-registry";
export const REGISTRY_METADATA_PATH = "registry.json";
export const REGISTRY_SCHEMA_VERSION = 2;
export const GITHUB_ACTIONS_APP_ID = 15368;

export const CURRENT_LIFECYCLE_APP = Object.freeze({
  clientId: "Iv23lihDWOdXtSQ50Lt7",
  id: 4473722,
  owner: GITHUB_ORGANIZATION,
  slug: "abrikosoff-academy-train",
});

export const CURRENT_LIFECYCLE_OWNER_ID = "224131170";
export const PRODUCTION_APPROVERS_TEAM = "production-approvers";

export const LOCAL_PRODUCTION_RELEASE_CONFIRMATION =
  "ВЫПУСТИТЬ PRODUCTION";
export const PRODUCTION_APPLICATION_IMAGE =
  "ghcr.io/abrikosov-group/abrikosoff-academy";
export const PRODUCTION_TELEGRAM_EGRESS_IMAGE =
  "ghcr.io/abrikosov-group/abrikosoff-academy-telegram-egress";
export const PRODUCTION_HEALTH_URL =
  "https://academy.abrikosoff.com/api/health";

export const ENVIRONMENT_ADMIN_BYPASS_POLICIES = Object.freeze({
  FORBIDDEN: "admin_bypass_forbidden",
  TEAM_PRIVATE_LOCAL_OWNER: "github_team_private_local_owner",
});

export const LIFECYCLE_INVOCATION_KINDS = Object.freeze({
  GITHUB_ACTIONS: "github_actions",
  LOCAL_OWNER: "local_owner",
});

export const LOCAL_BOOTSTRAP_STATE_FILE =
  "abrikosoff-release-train-bootstrap.json";

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
    "deploy/README.md",
    "deploy/server/academy-admin",
    "deploy/server/academy-release",
    "deploy/server/academy-task",
    "deploy/telegram-egress/README.md",
    "deploy/telegram-egress/remote.env.example",
    "deploy/telegram-egress/tunnel.env.example",
    "docs/admin-panel-implementation-status.md",
    "docs/decisions/0009-integration-release-train.md",
    "docs/decisions/0010-team-private-release-train-bootstrap.md",
    "docs/decisions/0011-owner-local-production-release.md",
    "docs/development-workflow.md",
    "docs/operations/administration-owner-preview.md",
    "docs/operations/release-train.md",
    "scripts/release-train/config.mjs",
    "scripts/release-train/errors.mjs",
    "scripts/release-train/github-api.mjs",
    "scripts/release-train/local-bootstrap.mjs",
    "scripts/release-train/local-release.mjs",
    "scripts/release-train/registry.mjs",
    "scripts/release-train/release-classifier.mjs",
    "scripts/release-train/train-lifecycle.mjs",
    "tests/release-train/registry.test.mjs",
    "tests/release-train/local-bootstrap.test.mjs",
    "tests/release-train/local-release.test.mjs",
    "tests/release-train/release-classifier.test.mjs",
    "tests/release-train/train-lifecycle.test.mjs",
    "tests/release-train/workflow-contract.test.mjs",
    "tests/server/academy-admin-wrapper.sh",
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
