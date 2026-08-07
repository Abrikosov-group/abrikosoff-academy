# ADR-0011: локальный production-выпуск владельцем

- Статус: принято
- Дата: 2026-08-06
- Подтверждено владельцем: 2026-08-06
- Изменяет: действующий production-выпуск и эксплуатационную часть ADR-0009

## Контекст

В private-репозитории организации на GitHub Team production Environment не
создаёт достаточной границы от административного обхода. Кроме того, по
[официальному контракту повторных запусков](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
пользователь с правом `Write` способен повторять jobs до 30 дней после исходного
run, а повтор использует SHA, ref и привилегии первоначального actor. Проверка
`GITHUB_TRIGGERING_ACTOR` внутри нового workflow защищает только запуски,
созданные из уже исправленного определения, и не инвалидирует старые запуски с
SSH-секретом.

Для стартапа с одним владельцем выпуска, одним разработчиком и ИИ-агентами
разумная временная граница проходит через отдельную доверенную машину владельца.
GitHub остаётся источником кода, pull request и результатов CI, но не хранит и
не получает реквизиты production-доступа.

## Решение

1. Workflow `.github/workflows/release.yml` удаляется. GitHub Actions выполняет
   только проверки из `.github/workflows/ci.yml` с `contents: read`, без
   production Environment, SSH-секретов и права `packages: write`.
2. Production не изменяется автоматически после merge. Выпуск выполняется
   владельцем командой `scripts/release-train/local-release.mjs` из доверенной
   локальной машины.
3. Локальный шлюз до первого изменяющего действия проверяет:
   - корень чистого checkout, ветку `main`, доверенный `origin` и совпадение
     `HEAD` с заново полученным `origin/main`;
   - GitHub CLI identity по неизменяемому ID владельца, активную роль
     администратора, план Team, private visibility и default branch `main`;
   - ровно один слитый PR для точного SHA `main`, слияние этим же владельцем и
     допустимый класс релиза;
   - четыре обязательных app-bound GitHub Actions checks со статусом
     `completed/success` на том же SHA;
   - доступность локальных Docker Buildx, Docker daemon, SSH и tar.
   Непосредственно перед публикацией образов шлюз заново получает
   `origin/main`; после публикации и до первого SSH-вызова эта проверка
   выполняется ещё раз. Изменение `main` закрывает выпуск.
4. Режим `--verify` выполняет только чтение и выводит точную фразу подтверждения.
   Режим `--release` принимает SSH-параметры и требует фразу
   `ВЫПУСТИТЬ PRODUCTION <40-значный SHA>`.
5. Для GHCR используется отдельный classic personal access token владельца с
   минимальными scopes `write:packages` и `read:packages`, как требует
   [контракт Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
   Шлюз проверяет владельца token и принимает только точный allowlist
   `write:packages` с необязательным `read:packages`. Любой иной scope,
   включая ранее не перечисленный GitHub scope, закрывает выпуск.
6. GHCR token:
   - передаётся локальному процессу только через стандартный ввод;
   - не передаётся в аргументах, environment, GitHub Secrets или файлах
     репозитория;
   - поступает в `docker login` и серверный wrapper через stdin;
   - используется с временным `DOCKER_CONFIG`, который удаляется в `finally`;
   - обнуляется в локальных Buffer после успеха или ошибки.
7. На доверенной машине собираются Linux/AMD64-образы приложения и
   Telegram-egress с SBOM и provenance. Теги SHA и `main` публикуются только
   как удобные изменяемые указатели и не входят в production trust boundary.
   Buildx обязан записать metadata-файл, из которого шлюз извлекает и проверяет
   точный `sha256` digest опубликованного OCI-образа по
   [официальному контракту `--metadata-file`](https://docs.docker.com/reference/cli/docker/buildx/build/#metadata-file).
   Только digest приложения передаётся серверу вместе с `Caddyfile` и
   Compose-конфигурацией.
8. Сервер по-прежнему принимает только `upload <sha>` и
   `deploy <sha> <image@sha256:digest> <registry-user>`, проверяет OCI label
   `org.opencontainers.image.revision` нового и предыдущего образов на
   совпадение с их SHA. Legacy tag или неполные metadata текущего релиза
   отклоняются до чтения токена и Docker-изменений. Сервер сериализует операции,
   применяет миграции, проверяет health и выполняет откат. Интерактивная SSH
   shell для release-ключа не разрешается. Административный и task-wrapper
   перед изменяющей командой также сверяют digest и OCI revision реально
   работающего контейнера с SHA текущего каталога релиза.
9. После ответа wrapper локальная машина независимо проверяет публичный
   `/api/health` и точный SHA. Ошибка закрывает команду, но не маскирует
   фактическое состояние сервера; оператор следует runbook отката.

## Обязательный переход

Удаление workflow из Git не обезвреживает уже существующие workflow runs.
До возврата любому сотруднику права `Write` владелец выполняет один
согласованный переход:

1. принимает этот инфраструктурный PR в `main`; сам PR имеет класс
   `infrastructure-no-deploy` и production не меняет;
2. создаёт на доверенной машине отдельный release SSH key и фиксирует host key
   сервера через независимый доверенный канал;
3. под общей exclusive-блокировкой из точного принятого `main` через отдельную
   доверенную обслуживаемую сессию устанавливает digest-aware версии
   `academy-release`, `academy-admin` и `academy-task` как `root:root 0755`,
   предварительно выполняет `bash -n` и сверяет установленные файлы с
   локальными; для уже работающего контейнера одновременно получает его точный
   GHCR digest, проверяет repository, OCI revision и SHA каталога текущего
   релиза, затем атомарно переводит `current-image` с прежнего tag на digest.
   При любом несовпадении переход останавливается; старый tag-only
   release-wrapper несовместим с новым локальным шлюзом, а старые
   административная и фоновая обёртки несовместимы с новым форматом
   `current-image`;
4. добавляет новый public key в `authorized_keys` пользователя `deploy` с тем
   же forced-command wrapper и запретами PTY, forwarding и agent forwarding;
5. в той же обслуживаемой сессии удаляет прежний public key GitHub Actions и
   проверяет, что новый ключ вызывает только wrapper;
6. удаляет из GitHub production Environment значения
   `PRODUCTION_SSH_PRIVATE_KEY`, `PRODUCTION_SSH_KNOWN_HOSTS` и более не нужные
   release variables; проверяет отсутствие копий на уровне repository и
   organization secrets;
7. для packages `abrikosoff-academy` и
   `abrikosoff-academy-telegram-egress` отключает наследование доступа от
   репозитория, удаляет доступ Actions на запись и проверяет, что ни сотрудник,
   ни команда с правом `Write` в репозитории не имеют package-роли `Write` или
   `Admin`; запись остаётся только у владельца по
   [granular package permissions](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility);
8. создаёт отдельный package-only GHCR token, сохраняет его в менеджере
   секретов владельца и не добавляет в GitHub;
9. запускает `--verify` из актуального чистого `main`;
10. только после доказанного отзыва старого SSH-ключа, удаления GitHub secrets
   и ограничения package ACL
   пересматривает доступ разработчика с `Read` на `Write`.

Шаги 3–8 изменяют production и настройки GitHub, поэтому выполняются отдельной
явно подтверждённой операцией владельца, а не самим merge этого PR.

## Последствия

- Merge и deployment становятся двумя разными решениями владельца.
- Компрометация Write-аккаунта или исторического workflow после перехода не
  предоставляет SSH-доступ к production.
- Недоступность доверенной машины владельца означает остановку плановых
  выпусков. Исходники на production не копируются, сборка на production не
  выполняется.
- Выпуск всё ещё зависит от успешного CI точного SHA. Недоступность GitHub
  Actions закрывает выпуск; обход возможен только отдельной break-glass
  процедурой, которой это решение не создаёт.
- Для роста команды следующим шагом будет отдельный release runner либо
  OIDC-bound secret broker с короткоживущими credentials и независимым
  подтверждением, а не возврат долговечных production secrets в Actions.

## Отклонённые варианты

### Оставить production в Actions и проверять только triggering actor

Отклонено: новый guard не инвалидирует исторические runs и остаётся внутри
границы, которую администратор GitHub Team/private способен изменить.

### Удалить также CI из Actions

Отклонено на текущем этапе: независимые обязательные проверки PR снижают риск
ошибки двух разработчиков и ИИ-агентов. CI не получает production-секретов и не
публикует артефакты.

### Собирать приложение на production-сервере

Отклонено: это расширяет production trust boundary до исходников, package
manager и build toolchain и повышает последствия supply-chain ошибки.

## Критерии приёмки

- в `.github/workflows` нет production release, GitHub secrets, SSH-команд,
  production Environment или `packages: write`;
- локальный `--verify` не читает GHCR token и не выполняет build, push, upload
  или deploy;
- выпуск закрывается при другом owner ID, merger, repository, branch, SHA,
  PR-классе, GitHub App проверки или неуспешном check;
- GHCR token проходит только через stdin и отклоняется при любом scope вне
  точного package-only allowlist;
- SSH использует точный private key, pinned `known_hosts`,
  `StrictHostKeyChecking=yes` и неизменяемый `image@sha256:digest`;
- `main` повторно проверяется перед публикацией и после сборок до SSH-вызова;
- release-wrapper до Docker-изменений отклоняет legacy или несогласованные
  metadata текущего релиза, а admin/task-wrapper сверяют OCI revision
  работающего контейнера с SHA каталога;
- unit- и contract-тесты подтверждают эти инварианты;
- фактический cutover считается завершённым только после отзыва прежнего
  серверного ключа, удаления production secrets из GitHub, установки
  digest-aware wrapper-ов и ограничения package ACL.
