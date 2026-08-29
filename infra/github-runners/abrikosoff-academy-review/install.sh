#!/usr/bin/env bash

set -euo pipefail
umask 077

readonly ORGANIZATION='Abrikosov-group'
readonly RUNNER_GROUP='abrikosoff-academy-review'
readonly RUNNER_VERSION='2.336.0'
readonly RUNNER_SHA256='04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d'
readonly RUNNER_ARCHIVE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
readonly RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"
readonly CACHE_DIRECTORY='/var/cache/github-actions-runner'
readonly ARCHIVE_PATH="${CACHE_DIRECTORY}/${RUNNER_ARCHIVE}"
readonly HOOK_GROUP='academyreview'
readonly HOOK_DIRECTORY='/usr/local/libexec/abrikosoff-academy-review'
readonly CODEX_VERSION='codex-cli 0.147.0'
readonly CLAUDE_VERSION='2.1.226 (Claude Code)'
readonly SERVICE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly BOOTSTRAP_LOCK='/run/lock/abrikosoff-academy-review-install.lock'

readonly ORCHESTRATION_USER='academyrevieworchestration'
readonly ORCHESTRATION_GROUP='academyrevieworchestration'
readonly ORCHESTRATION_HOME='/var/lib/abrikosoff-academy-review-orchestration'
readonly ORCHESTRATION_ROOT='/var/lib/github-actions-runner-abrikosoff-academy-review-orchestration'
readonly ORCHESTRATION_NAME='abrikosoff-academy-review-orchestration-01'
readonly ORCHESTRATION_LABEL='abrikosoff-academy-review-orchestration'

readonly CODEX_USER='academyreviewcodex'
readonly CODEX_GROUP='academyreviewcodex'
readonly CODEX_HOME='/var/lib/abrikosoff-academy-review-codex'
readonly CODEX_ROOT='/var/lib/github-actions-runner-abrikosoff-academy-review-codex'
readonly CODEX_NAME='abrikosoff-academy-review-codex-01'
readonly CODEX_LABEL='abrikosoff-academy-review-codex'
readonly CODEX_AUTH_PATH="${CODEX_HOME}/.codex/auth.json"
readonly CODEX_SHELL='/usr/sbin/nologin'

readonly CLAUDE_USER='academyreviewclaude'
readonly CLAUDE_GROUP='academyreviewclaude'
readonly CLAUDE_HOME='/var/lib/abrikosoff-academy-review-claude'
readonly CLAUDE_ROOT='/var/lib/github-actions-runner-abrikosoff-academy-review-claude'
readonly CLAUDE_NAME='abrikosoff-academy-review-claude-01'
readonly CLAUDE_LABEL='abrikosoff-academy-review-claude'

bundle_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly BUNDLE_DIRECTORY="${bundle_directory}"

orchestration_token=''
codex_token=''
claude_token=''
IFS= read -r orchestration_token || true
IFS= read -r codex_token || true
IFS= read -r claude_token || true

[[ "$(id -u)" == '0' ]] || {
  printf 'install.sh должен выполняться от root.\n' >&2
  exit 1
}

for command_name in awk bash cat chmod chown claude codex curl env find flock \
  getent gh git grep groupadd id install jq kill mktemp mv node npm python3 \
  readlink realpath rm runuser sed seq sha256sum sh sleep sort stat systemctl \
  tar timeout tr useradd xargs; do
  command -v "${command_name}" >/dev/null || {
    printf 'На сервере отсутствует обязательная команда: %s\n' "${command_name}" >&2
    exit 1
  }
done

validate_token() {
  local runner_name="$1"
  local token="$2"

  (( ${#token} >= 20 )) || {
    printf 'Registration token для %s отсутствует или некорректен.\n' \
      "${runner_name}" >&2
    exit 1
  }
}

validate_token "${ORCHESTRATION_NAME}" "${orchestration_token}"
validate_token "${CODEX_NAME}" "${codex_token}"
validate_token "${CLAUDE_NAME}" "${claude_token}"

fail_codex_identity() {
  printf 'Отдельная identity Codex для Academy не подготовлена: %s\n' "$1" >&2
  exit 1
}

validate_codex_identity() {
  local account_name home_directory login_shell passwd_record
  local actual_groups expected_groups primary_group user_id

  passwd_record="$(getent passwd "${CODEX_USER}")" ||
    fail_codex_identity "Unix-пользователь ${CODEX_USER} отсутствует"
  IFS=: read -r account_name _ _ _ _ home_directory login_shell \
    <<< "${passwd_record}"
  [[ "${account_name}" == "${CODEX_USER}" ]] ||
    fail_codex_identity 'неожиданное имя Unix-пользователя'
  [[ "${home_directory}" == "${CODEX_HOME}" ]] ||
    fail_codex_identity 'неожиданный home-каталог'
  [[ "${login_shell}" == "${CODEX_SHELL}" ]] ||
    fail_codex_identity 'неожиданная login shell'

  user_id="$(id -u "${CODEX_USER}")" ||
    fail_codex_identity 'не удалось определить UID'
  [[ "${user_id}" =~ ^[1-9][0-9]*$ ]] && (( user_id < 1000 )) ||
    fail_codex_identity 'Unix-пользователь не является системным'
  primary_group="$(id -gn "${CODEX_USER}")" ||
    fail_codex_identity 'не удалось определить primary group'
  [[ "${primary_group}" == "${CODEX_GROUP}" ]] ||
    fail_codex_identity 'неожиданная primary group'
  actual_groups="$(id -nG "${CODEX_USER}" | tr ' ' '\n' | sort -u)"
  expected_groups="$(printf '%s\n%s\n' "${CODEX_GROUP}" "${HOOK_GROUP}" | sort -u)"
  [[ "${actual_groups}" == "${expected_groups}" ]] ||
    fail_codex_identity 'обнаружен неожиданный набор Unix-групп'

  [[ -d "${CODEX_HOME}" && ! -L "${CODEX_HOME}" ]] ||
    fail_codex_identity 'home отсутствует либо является символьной ссылкой'
  [[ "$(stat -c '%U:%G:%a' -- "${CODEX_HOME}")" == \
     "${CODEX_USER}:${CODEX_GROUP}:700" ]] ||
    fail_codex_identity 'home имеет небезопасные права'
  [[ -d "${CODEX_HOME}/.codex" && ! -L "${CODEX_HOME}/.codex" ]] ||
    fail_codex_identity 'каталог .codex отсутствует либо является символьной ссылкой'
  [[ "$(stat -c '%U:%G:%a' -- "${CODEX_HOME}/.codex")" == \
     "${CODEX_USER}:${CODEX_GROUP}:700" ]] ||
    fail_codex_identity 'каталог .codex имеет небезопасные права'
}

verify_codex_login() {
  local codex_status

  if ! codex_status="$(
    # Переменную HOME раскрывает дочерний shell уже после смены пользователя.
    # shellcheck disable=SC2016
    runuser -u "${CODEX_USER}" -- env -i \
      HOME="${CODEX_HOME}" \
      CODEX_HOME="${CODEX_HOME}/.codex" \
      PATH="${SERVICE_PATH}" \
      LANG='C.UTF-8' \
      sh -c 'cd -- "$HOME" && codex login status' 2>&1
  )"; then
    printf 'Отдельная авторизация Codex для Academy недействительна.\n' >&2
    exit 1
  fi
  grep -Fx 'Logged in using ChatGPT' <<< "${codex_status}" >/dev/null || {
    printf 'Codex для Academy не авторизован через ChatGPT.\n' >&2
    exit 1
  }
}

exec 9>"${BOOTSTRAP_LOCK}"
flock --exclusive --nonblock 9 || {
  printf 'Установка Academy review-runners уже выполняется.\n' >&2
  exit 1
}

readonly -a RUNNER_ROOTS=(
  "${ORCHESTRATION_ROOT}"
  "${CODEX_ROOT}"
  "${CLAUDE_ROOT}"
)
readonly -a RUNNER_NAMES=(
  "${ORCHESTRATION_NAME}"
  "${CODEX_NAME}"
  "${CLAUDE_NAME}"
)

for runner_root in "${RUNNER_ROOTS[@]}"; do
  [[ ! -e "${runner_root}" && ! -L "${runner_root}" ]] || {
    printf 'Runner root уже существует; повторная установка запрещена: %s\n' \
      "${runner_root}" >&2
    exit 1
  }
done
for runner_name in "${RUNNER_NAMES[@]}"; do
  service_name="actions.runner.${ORGANIZATION}.${runner_name}.service"
  ! systemctl cat "${service_name}" >/dev/null 2>&1 || {
    printf 'Runner service уже существует; повторная установка запрещена: %s\n' \
      "${service_name}" >&2
    exit 1
  }
done

while IFS= read -r service_name; do
  [[ -n "${service_name}" ]] || continue
  protect_proc="$(systemctl show --property=ProtectProc --value "${service_name}")"
  [[ "${protect_proc}" == 'invisible' ]] || {
    printf 'Существующий runner %s не изолирован: ProtectProc=%s.\n' \
      "${service_name}" "${protect_proc:-unset}" >&2
    exit 1
  }
done < <(
  systemctl list-unit-files 'actions.runner.*.service' \
    --type=service --no-legend --no-pager | awk '{print $1}'
)

validate_codex_identity
[[ -f "${CODEX_AUTH_PATH}" && ! -L "${CODEX_AUTH_PATH}" ]] || {
  printf 'Отдельный Academy Codex OAuth отсутствует.\n' >&2
  exit 1
}
[[ "$(stat -c '%U:%G:%a' -- "${CODEX_AUTH_PATH}")" == \
   "${CODEX_USER}:${CODEX_GROUP}:600" ]] || {
  printf 'Отдельный Academy Codex OAuth имеет небезопасные права.\n' >&2
  exit 1
}
[[ "$(stat -c '%h' -- "${CODEX_AUTH_PATH}")" == '1' ]] || {
  printf 'Отдельный Academy Codex OAuth имеет дополнительные жёсткие ссылки.\n' >&2
  exit 1
}
[[ "$(realpath -e -- "${CODEX_AUTH_PATH}")" == "${CODEX_AUTH_PATH}" ]] || {
  printf 'Отдельный Academy Codex OAuth имеет неожиданный канонический путь.\n' >&2
  exit 1
}
auth_size="$(stat -c '%s' -- "${CODEX_AUTH_PATH}")"
if [[ ! "${auth_size}" =~ ^[1-9][0-9]*$ ]] || (( auth_size > 1048576 )); then
  printf 'Отдельный Academy Codex OAuth имеет небезопасный размер.\n' >&2
  exit 1
fi

[[ "$(codex --version)" == "${CODEX_VERSION}" ]] || {
  printf 'На сервере установлена неподдерживаемая версия Codex CLI.\n' >&2
  exit 1
}
[[ "$(claude --version)" == "${CLAUDE_VERSION}" ]] || {
  printf 'На сервере установлена неподдерживаемая версия Claude Code.\n' >&2
  exit 1
}
verify_codex_login

bash -n "${BUNDLE_DIRECTORY}/verify-job.sh"
bash -n "${BUNDLE_DIRECTORY}/cleanup-model-job.sh"

install -d -o root -g root -m 0755 "${CACHE_DIRECTORY}"
if [[ -e "${ARCHIVE_PATH}" || -L "${ARCHIVE_PATH}" ]]; then
  [[ -f "${ARCHIVE_PATH}" && ! -L "${ARCHIVE_PATH}" ]] || {
    printf 'Кэшированный runner не является обычным файлом.\n' >&2
    exit 1
  }
  printf '%s  %s\n' "${RUNNER_SHA256}" "${ARCHIVE_PATH}" |
    sha256sum --check --status || {
      printf 'Кэшированный runner имеет неверную checksum.\n' >&2
      exit 1
    }
else
  temporary_archive="$(mktemp "${ARCHIVE_PATH}.part.XXXXXX")"
  trap 'rm -f -- "${temporary_archive:-}"' EXIT
  curl --fail --location --silent --show-error \
    --output "${temporary_archive}" "${RUNNER_URL}"
  printf '%s  %s\n' "${RUNNER_SHA256}" "${temporary_archive}" |
    sha256sum --check --status
  chown root:root "${temporary_archive}"
  chmod 0644 "${temporary_archive}"
  mv -- "${temporary_archive}" "${ARCHIVE_PATH}"
  trap - EXIT
fi

ensure_identity() {
  local user_name="$1"
  local private_group="$2"
  local home_directory="$3"
  local comment="$4"

  ! getent passwd "${user_name}" >/dev/null || {
    printf 'Unix-пользователь уже существует; повторная установка запрещена: %s\n' \
      "${user_name}" >&2
    exit 1
  }
  getent group "${private_group}" >/dev/null || groupadd --system "${private_group}"
  useradd --system --gid "${private_group}" --groups "${HOOK_GROUP}" \
    --home-dir "${home_directory}" --create-home --shell /usr/sbin/nologin \
    --comment "${comment}" "${user_name}"
  [[ "$(id -gn "${user_name}")" == "${private_group}" ]]
  install -d -o "${user_name}" -g "${private_group}" -m 0700 "${home_directory}"
}

getent group "${HOOK_GROUP}" >/dev/null || {
  printf 'Группа %s для заранее подготовленной Codex identity отсутствует.\n' \
    "${HOOK_GROUP}" >&2
  exit 1
}
ensure_identity \
  "${ORCHESTRATION_USER}" "${ORCHESTRATION_GROUP}" "${ORCHESTRATION_HOME}" \
  'GitHub runner оркестрации ревью Academy'
ensure_identity \
  "${CLAUDE_USER}" "${CLAUDE_GROUP}" "${CLAUDE_HOME}" \
  'GitHub runner Claude для Academy'

install -d -o root -g "${HOOK_GROUP}" -m 0750 "${HOOK_DIRECTORY}"
install -o root -g "${HOOK_GROUP}" -m 0750 \
  "${BUNDLE_DIRECTORY}/verify-job.sh" "${HOOK_DIRECTORY}/verify-job.sh"
install -o root -g "${HOOK_GROUP}" -m 0750 \
  "${BUNDLE_DIRECTORY}/cleanup-model-job.sh" \
  "${HOOK_DIRECTORY}/cleanup-model-job.sh"

configure_runner() {
  local runner_root="$1"
  local user_name="$2"
  local private_group="$3"
  local home_directory="$4"
  local runner_name="$5"
  local runner_label="$6"
  local override_file="$7"
  local registration_token="$8"
  local service_name

  install -d -o "${user_name}" -g "${private_group}" -m 0700 "${runner_root}"
  tar --extract --gzip --file "${ARCHIVE_PATH}" --directory "${runner_root}"
  chown -R "${user_name}:${private_group}" "${runner_root}"

  (
    cd -- "${runner_root}"
    printf '%s\n' "${registration_token}" |
      runuser -u "${user_name}" -- env -i \
        HOME="${home_directory}" \
        PATH="${SERVICE_PATH}" \
        LANG='C.UTF-8' \
        bash --noprofile --norc -c '
          set -euo pipefail
          IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN
          (( ${#ACTIONS_RUNNER_INPUT_TOKEN} >= 20 ))
          export ACTIONS_RUNNER_INPUT_TOKEN
          exec ./config.sh "$@"
        ' -- \
          --unattended \
          --url "https://github.com/${ORGANIZATION}" \
          --name "${runner_name}" \
          --runnergroup "${RUNNER_GROUP}" \
          --labels "${runner_label}" \
          --work '_work' \
          --disableupdate
    ./svc.sh install "${user_name}"
  )
  registration_token=''

  service_name="$(tr -d '\r\n' < "${runner_root}/.service")"
  [[ "${service_name}" == "actions.runner.${ORGANIZATION}.${runner_name}.service" ]] || {
    printf 'Создана неожиданная runner service: %s\n' "${service_name}" >&2
    exit 1
  }

  install -d -o root -g root -m 0755 "/etc/systemd/system/${service_name}.d"
  install -o root -g root -m 0644 \
    "${BUNDLE_DIRECTORY}/${override_file}" \
    "/etc/systemd/system/${service_name}.d/override.conf"

  chown -R "root:${private_group}" "${runner_root}"
  find "${runner_root}" -type d -exec chmod 0750 -- {} +
  find "${runner_root}" -type f -perm /0111 -exec chmod 0750 -- {} +
  find "${runner_root}" -type f ! -perm /0111 -exec chmod 0640 -- {} +
  install -d -o "${user_name}" -g "${private_group}" -m 0700 \
    "${runner_root}/_work" "${runner_root}/_diag"
  chown -R "${user_name}:${private_group}" \
    "${runner_root}/_work" "${runner_root}/_diag"
}

configure_runner \
  "${ORCHESTRATION_ROOT}" "${ORCHESTRATION_USER}" "${ORCHESTRATION_GROUP}" \
  "${ORCHESTRATION_HOME}" "${ORCHESTRATION_NAME}" "${ORCHESTRATION_LABEL}" \
  'orchestration-runner-override.conf' "${orchestration_token}"
configure_runner \
  "${CODEX_ROOT}" "${CODEX_USER}" "${CODEX_GROUP}" "${CODEX_HOME}" \
  "${CODEX_NAME}" "${CODEX_LABEL}" 'codex-runner-override.conf' "${codex_token}"
configure_runner \
  "${CLAUDE_ROOT}" "${CLAUDE_USER}" "${CLAUDE_GROUP}" "${CLAUDE_HOME}" \
  "${CLAUDE_NAME}" "${CLAUDE_LABEL}" 'claude-runner-override.conf' "${claude_token}"

unset orchestration_token codex_token claude_token

systemctl daemon-reload
for runner_name in "${RUNNER_NAMES[@]}"; do
  service_name="actions.runner.${ORGANIZATION}.${runner_name}.service"
  systemctl enable --now "${service_name}"
  systemctl is-active --quiet "${service_name}"
  systemctl is-enabled --quiet "${service_name}"
  [[ "$(systemctl show --property=ProtectProc --value "${service_name}")" == \
     'invisible' ]]
done

verify_codex_login

printf 'Три изолированных Academy review-runner зарегистрированы и запущены.\n'
