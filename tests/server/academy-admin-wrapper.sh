#!/usr/bin/env bash

set -Eeuo pipefail

readonly wrapper="/workspace/deploy/server/academy-admin"
readonly academy_root="/opt/academy"
readonly image_repository="ghcr.io/abrikosov-group/abrikosoff-academy"
readonly release_sha="1111111111111111111111111111111111111111"
readonly other_sha="2222222222222222222222222222222222222222"
release_digest="sha256:$(printf 'a%.0s' {1..64})"
readonly release_digest
other_digest="sha256:$(printf 'b%.0s' {1..64})"
readonly other_digest
readonly release_image="${image_repository}@${release_digest}"
readonly other_image="${image_repository}@${other_digest}"
readonly release_directory="${academy_root}/releases/${release_sha}"

docker() {
  if [[ " $* " == *" ps --quiet --status running app "* ]]; then
    if [[ "${FAKE_RUNNING:-false}" == "true" ]]; then
      printf '%s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    fi
    return
  fi

  if [[ "${1:-}" == "inspect" ]]; then
    if [[ "$*" == *"org.opencontainers.image.revision"* ]]; then
      printf '%s\n' "${FAKE_ACTIVE_REVISION:-}"
    else
      printf '%s\n' "${FAKE_ACTIVE_IMAGE:-}"
    fi
    return
  fi

  if [[ " $* " == *" run --rm --no-deps -T app "* ]]; then
    printf '%s\n' "fake-compose-run-ok"
    return
  fi

  if [[ "${1:-}" == "login" || "${1:-}" == "logout" ]]; then
    if [[ "${1:-}" == "login" && -n "${FAKE_DOCKER_LOGIN_MARKER:-}" ]]; then
      touch "${FAKE_DOCKER_LOGIN_MARKER}"
    fi
    return
  fi

  if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
    printf '%s\n' "${FAKE_IMAGE_REVISION:-}"
    return
  fi

  if [[ " $* " == *" compose "* ]]; then
    return
  fi

  printf 'Неожиданный вызов docker: %s\n' "$*" >&2
  return 99
}
export -f docker

run_admin() {
  "${wrapper}" \
    grant \
    --user-id 11111111-1111-4111-8111-111111111111 \
    --role owner \
    --reason "Проверка production wrapper" \
    --idempotency-key 22222222-2222-4222-8222-222222222222 \
    --production
}
export wrapper
export -f run_admin

run_task() {
  /workspace/deploy/server/academy-task \
    run \
    purge-identity-session-technical-data
}
export -f run_task

expect_failure() {
  local expected_message="$1"
  local output=""
  local exit_code=0

  set +e
  output="$(run_admin 2>&1)"
  exit_code=$?
  set -e

  [[ "${exit_code}" -eq 1 ]]
  grep -Fq "${expected_message}" <<< "${output}"
}

install -d -m 755 \
  "${release_directory}" \
  "${academy_root}/shared"
touch \
  "${release_directory}/Caddyfile" \
  "${release_directory}/compose.production.yaml" \
  "${academy_root}/shared/.env"
ln -sfn "${release_directory}" "${academy_root}/current"

lock_marker="${academy_root}/operation-lock-held"
(
  exec 8<"${academy_root}"
  flock --exclusive 8
  touch "${lock_marker}"
  sleep 3
) &
lock_holder_pid=$!
while [[ ! -f "${lock_marker}" ]]; do
  sleep 0.05
done

set +e
timeout 1 bash -c run_admin >/dev/null 2>&1
admin_lock_exit=$?
timeout 1 \
  env SSH_ORIGINAL_COMMAND="неподдерживаемая-команда" \
  /workspace/deploy/server/academy-release \
  >/dev/null 2>&1
release_lock_exit=$?
set -e
wait "${lock_holder_pid}"
rm -f -- "${lock_marker}"
[[ "${admin_lock_exit}" -eq 124 ]]
[[ "${release_lock_exit}" -eq 124 ]]

set +e
release_tag_output="$(
  env \
    SSH_ORIGINAL_COMMAND="deploy ${release_sha} ${image_repository}:${release_sha} Etogerman" \
    /workspace/deploy/server/academy-release \
    2>&1
)"
release_tag_exit=$?
set -e
[[ "${release_tag_exit}" -eq 1 ]]
grep -Fq "образ должен быть привязан к точному sha256 digest Академии" \
  <<< "${release_tag_output}"

printf '%s:%s\n' "${image_repository}" "${release_sha}" \
  > "${academy_root}/shared/current-image"
export FAKE_DOCKER_LOGIN_MARKER="${academy_root}/legacy-login-called"
set +e
legacy_release_output="$(
  env \
    SSH_ORIGINAL_COMMAND="deploy ${release_sha} ${release_image} Etogerman" \
    /workspace/deploy/server/academy-release \
    2>&1
)"
legacy_release_exit=$?
set -e
[[ "${legacy_release_exit}" -eq 1 ]]
grep -Fq "текущий образ использует legacy tag; завершите digest-cutover" \
  <<< "${legacy_release_output}"
[[ ! -e "${FAKE_DOCKER_LOGIN_MARKER}" ]]
unset FAKE_DOCKER_LOGIN_MARKER
rm -f -- \
  "${academy_root}/current" \
  "${academy_root}/shared/current-image"

export FAKE_IMAGE_REVISION="${other_sha}"
set +e
release_revision_output="$(
  printf '%s\n' "ghp_test_registry_token_value_1234567890" | \
    env \
      SSH_ORIGINAL_COMMAND="deploy ${release_sha} ${release_image} Etogerman" \
      /workspace/deploy/server/academy-release \
      2>&1
)"
release_revision_exit=$?
set -e
[[ "${release_revision_exit}" -eq 1 ]]
grep -Fq "revision production-образа не совпадает с SHA релиза" \
  <<< "${release_revision_output}"
unset FAKE_IMAGE_REVISION

ln -sfn "${release_directory}" "${academy_root}/current"
printf '%s\n' "${release_image}" \
  > "${academy_root}/shared/current-image"
export FAKE_IMAGE_REVISION="${other_sha}"
export FAKE_DOCKER_LOGIN_MARKER="${academy_root}/revision-login-called"
set +e
previous_revision_output="$(
  printf '%s\n' "ghp_test_registry_token_value_1234567890" | \
    env \
      SSH_ORIGINAL_COMMAND="deploy ${release_sha} ${release_image} Etogerman" \
      /workspace/deploy/server/academy-release \
      2>&1
)"
previous_revision_exit=$?
set -e
[[ "${previous_revision_exit}" -eq 1 ]]
grep -Fq "revision текущего production-образа не совпадает с SHA релиза" \
  <<< "${previous_revision_output}"
[[ ! -e "${FAKE_DOCKER_LOGIN_MARKER}" ]]
unset FAKE_IMAGE_REVISION
unset FAKE_DOCKER_LOGIN_MARKER

printf '%s:%s\n' "${image_repository}" "${release_sha}" \
  > "${academy_root}/shared/current-image"
expect_failure "текущий образ не привязан к точному sha256 digest Академии"

printf '%s\n' "${release_image}" \
  > "${academy_root}/shared/current-image"
expect_failure "production-приложение запущено не ровно в одном экземпляре"

export FAKE_RUNNING="true"
export FAKE_ACTIVE_IMAGE="${other_image}"
expect_failure "запущенный production-образ не совпадает с текущим релизом"

export FAKE_ACTIVE_IMAGE="${release_image}"
export FAKE_ACTIVE_REVISION="${other_sha}"
expect_failure "revision production-приложения не совпадает с SHA текущего релиза"
set +e
task_revision_output="$(run_task 2>&1)"
task_revision_exit=$?
set -e
[[ "${task_revision_exit}" -eq 1 ]]
grep -Fq "revision production-приложения не совпадает с SHA текущего релиза" \
  <<< "${task_revision_output}"

export FAKE_ACTIVE_REVISION="${release_sha}"
success_output="$(run_admin)"
grep -Fq "fake-compose-run-ok" <<< "${success_output}"

task_output="$(run_task)"
grep -Fq "fake-compose-run-ok" <<< "${task_output}"

printf '%s\n' "Проверки production wrapper успешно завершены."
