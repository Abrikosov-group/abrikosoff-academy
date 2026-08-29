#!/usr/bin/env bash

set -euo pipefail
umask 077

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

readonly EXPECTED_SCRIPT='/usr/local/libexec/abrikosoff-academy-review/cleanup-model-job.sh'
readonly BEFORE_JOB_MODE='--before-job'
readonly MAX_AUTH_BYTES=1048576
readonly ACADEMY_REPOSITORY='Abrikosov-group/abrikosoff-academy'

fail_cleanup() {
  printf 'Очистка model runner отклонена: %s\n' "$1" >&2
  exit 78
}

case "$#" in
  0)
    readonly CLEANUP_PHASE='after-job'
    readonly CLEAN_WORK_ROOT='true'
    ;;
  1)
    [[ "$1" == "${BEFORE_JOB_MODE}" ]] || {
      printf 'Очистка отклонена: неизвестный режим.\n' >&2
      exit 78
    }
    readonly CLEANUP_PHASE='before-job'
    readonly CLEAN_WORK_ROOT='false'
    ;;
  *)
    printf 'Очистка отклонена: неверное число аргументов.\n' >&2
    exit 78
    ;;
esac

case "${RUNNER_NAME:-}" in
  abrikosoff-academy-review-codex-01)
    readonly EXPECTED_USER='academyreviewcodex'
    readonly EXPECTED_GROUP='academyreviewcodex'
    readonly EXPECTED_SERVICE='actions.runner.Abrikosov-group.abrikosoff-academy-review-codex-01.service'
    readonly EXPECTED_WORK_ROOT='/var/lib/github-actions-runner-abrikosoff-academy-review-codex/_work'
    readonly EXPECTED_MODEL_HOME='/var/lib/abrikosoff-academy-review-codex'
    readonly MODEL_KIND='codex'
    ;;
  abrikosoff-academy-review-claude-01)
    readonly EXPECTED_USER='academyreviewclaude'
    readonly EXPECTED_GROUP='academyreviewclaude'
    readonly EXPECTED_SERVICE='actions.runner.Abrikosov-group.abrikosoff-academy-review-claude-01.service'
    readonly EXPECTED_WORK_ROOT='/var/lib/github-actions-runner-abrikosoff-academy-review-claude/_work'
    readonly EXPECTED_MODEL_HOME='/var/lib/abrikosoff-academy-review-claude'
    readonly MODEL_KIND='claude'
    ;;
  *)
    printf 'Очистка отклонена: неизвестный model runner: %s\n' "${RUNNER_NAME:-}" >&2
    exit 78
    ;;
esac

# GitHub формирует workspace как _work/<repo>/<repo>. Разрешаем только exact
# репозиторий Academy и не строим путь из произвольного slug.
[[ "${GITHUB_REPOSITORY:-}" == "${ACADEMY_REPOSITORY}" ]] ||
  fail_cleanup 'неизвестный репозиторий model-job'
readonly EXPECTED_REPOSITORY_DIRECTORY='abrikosoff-academy'
readonly EXPECTED_REPOSITORY_WORK_ROOT="${EXPECTED_WORK_ROOT}/${EXPECTED_REPOSITORY_DIRECTORY}"
readonly EXPECTED_WORKSPACE="${EXPECTED_REPOSITORY_WORK_ROOT}/${EXPECTED_REPOSITORY_DIRECTORY}"

validate_exact_directory() {
  local path="$1"
  local canonical_path

  [[ -d "${path}" && ! -L "${path}" ]] ||
    fail_cleanup "небезопасный каталог ${path}"
  canonical_path="$(realpath -e -- "${path}")" ||
    fail_cleanup "не удалось канонизировать ${path}"
  [[ "${canonical_path}" == "${path}" ]] ||
    fail_cleanup "неожиданный канонический путь ${path}"
}

validate_private_directory() {
  local path="$1"
  local mode owner_group

  validate_exact_directory "${path}"
  owner_group="$(stat -c '%U:%G' -- "${path}")"
  [[ "${owner_group}" == "${EXPECTED_USER}:${EXPECTED_GROUP}" ]] ||
    fail_cleanup "неожиданный владелец ${path}"
  mode="$(stat -c '%a' -- "${path}")"
  [[ "${mode}" =~ ^[0-7]{3}$ ]] ||
    fail_cleanup "неожиданный режим ${path}"
  (( (8#${mode} & 8#022) == 0 )) ||
    fail_cleanup "каталог доступен на запись группе или остальным: ${path}"
}

validate_codex_credential() {
  local auth_path="${EXPECTED_MODEL_HOME}/.codex/auth.json"
  local auth_size canonical_auth codex_state mode owner_group

  codex_state="${EXPECTED_MODEL_HOME}/.codex"
  validate_private_directory "${codex_state}"
  [[ -f "${auth_path}" && ! -L "${auth_path}" ]] ||
    fail_cleanup 'Codex auth.json отсутствует либо не является обычным файлом'
  canonical_auth="$(realpath -e -- "${auth_path}")" ||
    fail_cleanup 'не удалось канонизировать Codex auth.json'
  [[ "${canonical_auth}" == "${auth_path}" ]] ||
    fail_cleanup 'неожиданный канонический путь Codex auth.json'
  owner_group="$(stat -c '%U:%G' -- "${auth_path}")"
  [[ "${owner_group}" == "${EXPECTED_USER}:${EXPECTED_GROUP}" ]] ||
    fail_cleanup 'неожиданный владелец Codex auth.json'
  mode="$(stat -c '%a' -- "${auth_path}")"
  [[ "${mode}" == '600' ]] || fail_cleanup 'небезопасный режим Codex auth.json'
  auth_size="$(stat -c '%s' -- "${auth_path}")"
  [[ "${auth_size}" =~ ^[0-9]+$ ]] || fail_cleanup 'не удалось определить размер Codex auth.json'
  (( auth_size > 0 && auth_size <= MAX_AUTH_BYTES )) ||
    fail_cleanup 'небезопасный размер Codex auth.json'
}

[[ "${GITHUB_ACTIONS:-}" == 'true' ]] || fail_cleanup 'нет GitHub Actions context'
[[ "$(id -un)" == "${EXPECTED_USER}" ]] || fail_cleanup 'неожиданный Unix-пользователь'
[[ "$(id -gn)" == "${EXPECTED_GROUP}" ]] || fail_cleanup 'неожиданная primary group'
script_path="$(realpath -e -- "$0")"
readonly script_path
[[ "${script_path}" == "${EXPECTED_SCRIPT}" ]] || fail_cleanup 'неожиданный путь cleanup hook'
[[ "$(stat -c '%U:%G:%a' -- "${script_path}")" == 'root:academyreview:750' ]] ||
  fail_cleanup 'небезопасный владелец или режим cleanup hook'
validate_private_directory "${EXPECTED_WORK_ROOT}"
validate_private_directory "${EXPECTED_MODEL_HOME}"
if [[ "${MODEL_KIND}" == 'codex' ]]; then
  validate_codex_credential
fi

collect_target_pids() {
  local cgroup_root="$1"
  local pid
  local -a candidate_pids=()
  TARGET_PIDS=()

  mapfile -t candidate_pids < <(
    find "${cgroup_root}" -type f -name cgroup.procs -print0 \
      | xargs -0 -r cat \
      | sort -nu
  )
  for pid in "${candidate_pids[@]}"; do
    [[ "${pid}" =~ ^[1-9][0-9]*$ ]] || continue
    [[ -z "${PROTECTED_PIDS[$pid]+x}" ]] || continue
    [[ -r "/proc/${pid}/cgroup" ]] || continue
    TARGET_PIDS+=("${pid}")
  done
}

kill_leftover_job_processes() {
  local cgroup_path cgroup_root current_pid parent_pid pid
  cgroup_path="$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup)"
  readonly expected_cgroup_path="/system.slice/${EXPECTED_SERVICE}"
  [[ "${cgroup_path}" == "${expected_cgroup_path}" ||
     "${cgroup_path}" == "${expected_cgroup_path}/"* ]]
  cgroup_root="/sys/fs/cgroup${cgroup_path}"
  [[ -d "${cgroup_root}" ]]

  declare -gA PROTECTED_PIDS=()
  declare -ga TARGET_PIDS=()
  current_pid="$$"
  while [[ "${current_pid}" =~ ^[1-9][0-9]*$ && -r "/proc/${current_pid}/status" ]]; do
    PROTECTED_PIDS["${current_pid}"]=1
    parent_pid="$(awk '/^PPid:/ { print $2 }' "/proc/${current_pid}/status")"
    [[ "${parent_pid}" =~ ^[1-9][0-9]*$ ]] || break
    current_pid="${parent_pid}"
  done

  for _round in $(seq 1 5); do
    collect_target_pids "${cgroup_root}"
    (( ${#TARGET_PIDS[@]} > 0 )) || return 0

    kill -TERM "${TARGET_PIDS[@]}" 2>/dev/null || true
    for _attempt in $(seq 1 20); do
      local -a surviving_pids=()
      for pid in "${TARGET_PIDS[@]}"; do
        [[ -d "/proc/${pid}" ]] && surviving_pids+=("${pid}")
      done
      (( ${#surviving_pids[@]} > 0 )) || break
      sleep 0.1
    done
    kill -KILL "${TARGET_PIDS[@]}" 2>/dev/null || true
    sleep 0.1
  done

  collect_target_pids "${cgroup_root}"
  if (( ${#TARGET_PIDS[@]} > 0 )); then
    printf 'Не удалось завершить остаточные процессы model-job: %s\n' "${TARGET_PIDS[*]}" >&2
    return 1
  fi
}

clean_codex_home() {
  local auth_path="${EXPECTED_MODEL_HOME}/.codex/auth.json"
  local codex_state="${EXPECTED_MODEL_HOME}/.codex"

  validate_codex_credential
  find "${EXPECTED_MODEL_HOME}" \
    -mindepth 1 -maxdepth 1 ! -path "${codex_state}" \
    -exec rm -rf -- {} +
  find "${codex_state}" \
    -mindepth 1 -maxdepth 1 ! -path "${auth_path}" \
    -exec rm -rf -- {} +
  validate_private_directory "${EXPECTED_MODEL_HOME}"
  validate_codex_credential
  [[ -z "$(find "${EXPECTED_MODEL_HOME}" \
    -mindepth 1 -maxdepth 1 ! -path "${codex_state}" -print -quit)" ]] ||
    fail_cleanup 'Codex home содержит посторонний элемент после очистки'
  [[ -z "$(find "${codex_state}" \
    -mindepth 1 -maxdepth 1 ! -path "${auth_path}" -print -quit)" ]] ||
    fail_cleanup 'Codex state содержит посторонний элемент после очистки'
}

clean_claude_home() {
  find "${EXPECTED_MODEL_HOME}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  validate_private_directory "${EXPECTED_MODEL_HOME}"
  [[ -z "$(find "${EXPECTED_MODEL_HOME}" -mindepth 1 -print -quit)" ]] ||
    fail_cleanup 'Claude home не пуст после очистки'
}

ensure_private_directory() {
  local path="$1"

  if [[ -e "${path}" || -L "${path}" ]]; then
    validate_private_directory "${path}"
    return 0
  fi
  install -d -m 0700 -- "${path}"
  validate_private_directory "${path}"
}

clean_current_workspace() {
  [[ "${GITHUB_WORKSPACE:-}" == "${EXPECTED_WORKSPACE}" ]] ||
    fail_cleanup 'GITHUB_WORKSPACE не совпадает с точным рабочим каталогом runner'
  ensure_private_directory "${EXPECTED_REPOSITORY_WORK_ROOT}"
  ensure_private_directory "${EXPECTED_WORKSPACE}"
  find "${EXPECTED_WORKSPACE}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  validate_private_directory "${EXPECTED_WORKSPACE}"
  [[ -z "$(find "${EXPECTED_WORKSPACE}" -mindepth 1 -print -quit)" ]] ||
    fail_cleanup 'рабочий каталог текущего репозитория не пуст после предварительной очистки'
}

clean_work_root() {
  find "${EXPECTED_WORK_ROOT}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  [[ -z "$(find "${EXPECTED_WORK_ROOT}" -mindepth 1 -print -quit)" ]] ||
    fail_cleanup 'рабочий каталог model runner не пуст после очистки'
}

kill_leftover_job_processes
cd /
if [[ "${CLEANUP_PHASE}" == 'before-job' ]]; then
  clean_current_workspace
fi
case "${MODEL_KIND}" in
  codex) clean_codex_home ;;
  claude) clean_claude_home ;;
  *) fail_cleanup 'неизвестный тип model runner' ;;
esac

if [[ "${CLEAN_WORK_ROOT}" == 'true' ]]; then
  clean_work_root
fi

printf 'Model runner очищен: runner=%s phase=%s.\n' \
  "${RUNNER_NAME}" "${CLEANUP_PHASE}"
