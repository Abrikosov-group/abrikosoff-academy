#!/usr/bin/env bash

set -euo pipefail
umask 077

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

readonly ACADEMY_REPOSITORY='Abrikosov-group/abrikosoff-academy'
readonly EXPECTED_DEFAULT_BRANCH='main'
readonly EXPECTED_EVENT_REF="refs/heads/${EXPECTED_DEFAULT_BRANCH}"
readonly EXPECTED_SCRIPT='/usr/local/libexec/abrikosoff-academy-review/verify-job.sh'
readonly MODEL_CLEANUP_SCRIPT='/usr/local/libexec/abrikosoff-academy-review/cleanup-model-job.sh'
readonly ORCHESTRATION_RUNNER='abrikosoff-academy-review-orchestration-01'
readonly CODEX_RUNNER='abrikosoff-academy-review-codex-01'
readonly CLAUDE_RUNNER='abrikosoff-academy-review-claude-01'

deny() {
  local code="$1"
  local message="$2"
  printf '::error title=Runner policy rejected job::[%s] %s\n' "$code" "$message" >&2
  exit 78
}

[[ "${GITHUB_ACTIONS:-}" == 'true' ]] || deny 'E01' 'GitHub Actions context is missing.'
[[ "${RUNNER_ENVIRONMENT:-}" == 'self-hosted' ]] || deny 'E02' 'Runner is not self-hosted.'
[[ "${RUNNER_OS:-}" == 'Linux' && "${RUNNER_ARCH:-}" == 'X64' ]] ||
  deny 'E03' 'Unexpected runner platform.'
[[ -n "${EXPECTED_RUNNER_NAME:-}" && "${RUNNER_NAME:-}" == "${EXPECTED_RUNNER_NAME}" ]] ||
  deny 'E04' 'Unexpected runner identity.'
[[ -n "${EXPECTED_RUNNER_TEMP:-}" && "${RUNNER_TEMP:-}" == "${EXPECTED_RUNNER_TEMP}" ]] ||
  deny 'E05' 'Unexpected runner temporary directory.'

# Внутри reusable workflow GITHUB_WORKFLOW_REF сохраняет entry workflow вызывающего
# репозитория, а не путь reusable implementation. Каждый разрешённый репозиторий получает
# отдельный exact-профиль caller, visibility и допустимых base refs. Организационная
# реализация дополнительно закреплена полным SHA в runner group и entry workflow.
[[ "${GITHUB_REPOSITORY:-}" == "${ACADEMY_REPOSITORY}" ]] ||
  deny 'E06' 'Repository is not allowed.'
EXPECTED_REPOSITORY="${ACADEMY_REPOSITORY}"
EXPECTED_REPOSITORY_PRIVATE='false'
EXPECTED_ENTRY_WORKFLOW_REF="${ACADEMY_REPOSITORY}/.github/workflows/review-all.yml@${EXPECTED_EVENT_REF}"
EXPECTED_BASE_REFS=('main')
readonly EXPECTED_REPOSITORY EXPECTED_REPOSITORY_PRIVATE EXPECTED_ENTRY_WORKFLOW_REF
readonly -a EXPECTED_BASE_REFS

[[ "${GITHUB_REPOSITORY_OWNER:-}" == 'Abrikosov-group' ]] ||
  deny 'E07' 'Repository owner is not allowed.'
[[ "${GITHUB_SERVER_URL:-}" == 'https://github.com' &&
   "${GITHUB_API_URL:-}" == 'https://api.github.com' ]] ||
  deny 'E08' 'Unexpected GitHub endpoint.'
[[ "${GITHUB_WORKFLOW_REF:-}" == "${EXPECTED_ENTRY_WORKFLOW_REF}" ]] ||
  deny 'E09' 'Only the protected review-all entry workflow from the default branch is allowed.'
[[ "${GITHUB_REF_PROTECTED:-}" == 'true' ]] ||
  deny 'E10' 'The event ref is not protected.'
# pull_request_target и issue_comment исполняют доверенный entry workflow из default branch.
# Допустимые base refs отдельно заданы точным профилем репозитория и проверяются по
# подписанному event payload ниже.
# Контракт: https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target
[[ "${GITHUB_REF:-}" == "${EXPECTED_EVENT_REF}" ]] ||
  deny 'E11' 'Trusted events must execute in the default branch context.'

case "${RUNNER_NAME:-}:${GITHUB_JOB:-}" in
  "${ORCHESTRATION_RUNNER}:context"|\
  "${ORCHESTRATION_RUNNER}:start-status"|\
  "${ORCHESTRATION_RUNNER}:prepare-codex"|\
  "${ORCHESTRATION_RUNNER}:publish-codex"|\
  "${ORCHESTRATION_RUNNER}:publish-claude"|\
  "${ORCHESTRATION_RUNNER}:finish-status"|\
  "${CODEX_RUNNER}:analyze-codex"|\
  "${CLAUDE_RUNNER}:analyze-claude") ;;
  *) deny 'E12' 'Job is not allowed on this runner identity.' ;;
esac

case "${GITHUB_EVENT_NAME:-}" in
  issue_comment)
    ;;
  pull_request_target)
    ;;
  *) deny 'E13' 'Event type is not allowed.' ;;
esac

script_path="$(realpath -e -- "$0")"
readonly script_path
[[ "${script_path}" == "${EXPECTED_SCRIPT}" ]] || deny 'E14' 'Unexpected hook path.'
[[ "$(stat -c '%U:%G:%a' -- "${script_path}")" == 'root:academyreview:750' ]] ||
  deny 'E15' 'Unsafe hook ownership or mode.'

readonly event_path="${GITHUB_EVENT_PATH:-}"
[[ "${event_path}" == "${EXPECTED_RUNNER_TEMP}/"* ]] ||
  deny 'E16' 'Event payload is outside runner temp.'
[[ -f "${event_path}" && ! -L "${event_path}" ]] ||
  deny 'E17' 'Event payload is not a regular file.'

if ! timeout 5s python3 -I -S -c '
import json
import os
import stat
import sys

(
    path,
    event_name,
    expected_repository,
    expected_repository_private,
    *expected_base_refs,
) = sys.argv[1:]
if expected_repository_private not in {"true", "false"} or not expected_base_refs:
    raise SystemExit(1)
expected_private = expected_repository_private == "true"
flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(path, flags)
with os.fdopen(fd, "rb") as payload_file:
    metadata = os.fstat(payload_file.fileno())
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 10 * 1024 * 1024:
        raise SystemExit(2)
    payload = json.load(payload_file)

repository = payload.get("repository")
if not isinstance(repository, dict):
    raise SystemExit(3)
if (
    repository.get("full_name") != expected_repository
    or repository.get("private") is not expected_private
):
    raise SystemExit(4)
if repository.get("default_branch") != "main" or repository.get("fork") is not False:
    raise SystemExit(5)
if event_name == "pull_request_target":
    event_action = payload.get("action")
    if event_action not in {"opened", "reopened", "synchronize", "ready_for_review", "edited"}:
        raise SystemExit(6)
    pull_request = payload.get("pull_request")
    if not isinstance(pull_request, dict) or pull_request.get("draft") is not False:
        raise SystemExit(7)
    base = pull_request.get("base")
    head = pull_request.get("head")
    if not isinstance(base, dict) or base.get("ref") not in expected_base_refs:
        raise SystemExit(8)
    if event_action == "edited":
        changes = payload.get("changes")
        base_change = changes.get("base") if isinstance(changes, dict) else None
        base_ref_change = base_change.get("ref") if isinstance(base_change, dict) else None
        previous_base_ref = base_ref_change.get("from") if isinstance(base_ref_change, dict) else None
        if (
            not isinstance(previous_base_ref, str)
            or not previous_base_ref
            or previous_base_ref == base.get("ref")
        ):
            raise SystemExit(9)
    base_repository = base.get("repo")
    head_repository = head.get("repo") if isinstance(head, dict) else None
    if not isinstance(base_repository, dict) or base_repository.get("full_name") != expected_repository:
        raise SystemExit(10)
    if not isinstance(head_repository, dict) or head_repository.get("full_name") != expected_repository:
        raise SystemExit(11)
elif event_name == "issue_comment":
    if payload.get("action") != "created":
        raise SystemExit(12)
    issue = payload.get("issue")
    comment = payload.get("comment")
    if not isinstance(issue, dict) or not isinstance(issue.get("pull_request"), dict):
        raise SystemExit(13)
    if not isinstance(comment, dict) or comment.get("body") not in {"/review-all", "/review-claude"}:
        raise SystemExit(14)
    if comment.get("author_association") not in {"OWNER", "MEMBER", "COLLABORATOR"}:
        raise SystemExit(15)
else:
    raise SystemExit(16)
' "${event_path}" "${GITHUB_EVENT_NAME}" "${EXPECTED_REPOSITORY}" \
  "${EXPECTED_REPOSITORY_PRIVATE}" "${EXPECTED_BASE_REFS[@]}"; then
  deny 'E18' 'GitHub event payload failed validation.'
fi

case "${RUNNER_NAME:-}:${GITHUB_JOB:-}" in
  "${CODEX_RUNNER}:analyze-codex"|"${CLAUDE_RUNNER}:analyze-claude")
    if ! "${MODEL_CLEANUP_SCRIPT}" --before-job; then
      deny 'E19' 'Model home cleanup failed before analysis.'
    fi
    ;;
esac

printf 'Runner policy accepted: runner=%s job=%s event=%s ref=%s\n' \
  "${RUNNER_NAME}" "${GITHUB_JOB}" "${GITHUB_EVENT_NAME}" "${GITHUB_REF}"
