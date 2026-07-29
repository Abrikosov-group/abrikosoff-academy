#!/usr/bin/env bash

set -Eeuo pipefail

readonly wrapper="/workspace/deploy/server/academy-admin"
readonly academy_root="/opt/academy"
readonly image_prefix="ghcr.io/abrikosov-group/abrikosoff-academy:"
readonly release_sha="1111111111111111111111111111111111111111"
readonly other_sha="2222222222222222222222222222222222222222"
readonly release_directory="${academy_root}/releases/${release_sha}"

docker() {
  if [[ " $* " == *" ps --quiet --status running app "* ]]; then
    if [[ "${FAKE_RUNNING:-false}" == "true" ]]; then
      printf '%s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    fi
    return
  fi

  if [[ "${1:-}" == "inspect" ]]; then
    printf '%s\n' "${FAKE_ACTIVE_IMAGE:-}"
    return
  fi

  if [[ " $* " == *" run --rm --no-deps -T app "* ]]; then
    printf '%s\n' "fake-compose-run-ok"
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

printf '%s%s\n' "${image_prefix}" "${other_sha}" \
  > "${academy_root}/shared/current-image"
expect_failure "метаданные текущего релиза и образа не совпадают"

printf '%s%s\n' "${image_prefix}" "${release_sha}" \
  > "${academy_root}/shared/current-image"
expect_failure "production-приложение запущено не ровно в одном экземпляре"

export FAKE_RUNNING="true"
export FAKE_ACTIVE_IMAGE="${image_prefix}${other_sha}"
expect_failure "запущенный production-образ не совпадает с текущим релизом"

export FAKE_ACTIVE_IMAGE="${image_prefix}${release_sha}"
success_output="$(run_admin)"
grep -Fq "fake-compose-run-ok" <<< "${success_output}"

printf '%s\n' "Проверки production wrapper успешно завершены."
