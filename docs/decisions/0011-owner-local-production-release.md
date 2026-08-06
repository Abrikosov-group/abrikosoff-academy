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
4. Режим `--verify` выполняет только чтение и выводит точную фразу подтверждения.
   Режим `--release` принимает SSH-параметры и требует фразу
   `ВЫПУСТИТЬ PRODUCTION <40-значный SHA>`.
5. Для GHCR используется отдельный classic personal access token владельца с
   минимальными scopes `write:packages` и `read:packages`, как требует
   [контракт Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
   Шлюз проверяет
   владельца token и отклоняет scopes `repo`, `workflow`, `admin:org` и
   `delete:packages`.
6. GHCR token:
   - передаётся локальному процессу только через стандартный ввод;
   - не передаётся в аргументах, environment, GitHub Secrets или файлах
     репозитория;
   - поступает в `docker login` и серверный wrapper через stdin;
   - используется с временным `DOCKER_CONFIG`, который удаляется в `finally`;
   - обнуляется в локальных Buffer после успеха или ошибки.
7. На доверенной машине собираются Linux/AMD64-образы приложения и
   Telegram-egress с SBOM, provenance, неизменяемым тегом SHA и указателем
   `main`. Только после успешной публикации локальный процесс передаёт
   `Caddyfile` и Compose-конфигурацию существующему ограниченному SSH-wrapper.
8. Сервер по-прежнему принимает только `upload <sha>` и
   `deploy <sha> <точный-image:sha> <registry-user>`, сериализует операции,
   применяет миграции, проверяет health и выполняет откат. Интерактивная SSH
   shell для release-ключа не разрешается.
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
3. добавляет новый public key в `authorized_keys` пользователя `deploy` с тем
   же forced-command wrapper и запретами PTY, forwarding и agent forwarding;
4. в той же обслуживаемой сессии удаляет прежний public key GitHub Actions и
   проверяет, что новый ключ вызывает только wrapper;
5. удаляет из GitHub production Environment значения
   `PRODUCTION_SSH_PRIVATE_KEY`, `PRODUCTION_SSH_KNOWN_HOSTS` и более не нужные
   release variables; проверяет отсутствие копий на уровне repository и
   organization secrets;
6. создаёт отдельный package-only GHCR token, сохраняет его в менеджере
   секретов владельца и не добавляет в GitHub;
7. запускает `--verify` из актуального чистого `main`;
8. только после доказанного отзыва старого SSH-ключа и удаления GitHub secrets
   пересматривает доступ разработчика с `Read` на `Write`.

Шаги 3–5 изменяют production и настройки GitHub, поэтому выполняются отдельной
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
- GHCR token проходит только через stdin и отклоняется при избыточных scopes;
- SSH использует точный private key, pinned `known_hosts`,
  `StrictHostKeyChecking=yes` и неизменяемый image tag SHA;
- unit- и contract-тесты подтверждают эти инварианты;
- фактический cutover считается завершённым только после отзыва прежнего
  серверного ключа и удаления production secrets из GitHub.
