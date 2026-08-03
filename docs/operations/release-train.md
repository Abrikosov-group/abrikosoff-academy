# Начальный шлюз релизного поезда

Эта инструкция вводит в действие только начальный шлюз ADR-0009: доставляет
доверенные workflow в `main`, запрещает случайный production-выпуск
инфраструктурного PR, ограничивает production Environment, защищает точную
интеграционную ветку и регистрирует один активный поезд в append-only реестре.

Инструкция не выполняет финальный выпуск. Candidate-build, staging, release
manifest, promotion образов по digest и переходы `abort`, `close`, `fail`,
`recover`, `reconcile` входят в отдельный финальный шлюз.

## 1. Границы полномочий

- Слияние PR, создание GitHub App, изменение Environment и Actions secrets
  выполняет только владелец репозитория.
- Разработчик готовит и проверяет код, но не сливает PR и не запускает `open`
  без отдельного решения владельца.
- `train-lifecycle` загружается только из `main` и до создания installation
  token проверяет репозиторий, ref, точный workflow SHA, GitHub actor ID,
  повторного инициатора и текст подтверждения; после создания token эти гейты
  проверяются повторно перед любой мутацией.
- Для записи используется installation token отдельного GitHub App. Обычный
  `GITHUB_TOKEN` не может писать в реестр или менять защиты.
- Запись `train_opened` создаётся последним шагом. Любой предшествующий отказ
  оставляет поезд неактивным.

## 2. Что должно быть готово до слияния инфраструктурного PR

1. В PR изменяются только пути из закрытого
   `INFRASTRUCTURE_NO_DEPLOY_PATHS` в
   `scripts/release-train/config.mjs`.
2. PR имеет точную метку `release:infrastructure-no-deploy` до слияния.
3. Точный head SHA прошёл CI, независимое ревью, внешний ИИ-review и Copilot
   review; все применимые обсуждения закрыты.
4. `node --test tests/release-train/*.test.mjs`, `npm run check`,
   `npm run test:e2e` и `npm run audit:production` успешны локально.
5. Владелец проверил, что PR направлен в `main` и не содержит функциональных
   изменений приложения.

Метка является частью fail-closed классификации уже слитого PR. Если её нет,
release workflow завершится ошибкой до сборки и deployment. Это безопасный
отказ, но он потребует отдельного исправляющего инфраструктурного PR.

## 3. Отдельный GitHub App

В организации создаётся новый GitHub App, предназначенный только для
`train-lifecycle`.

Настройки приложения:

- webhooks отключены;
- repository permission `Actions`: `Read-only`;
- repository permission `Administration`: `Read and write`;
- repository permission `Contents`: `Read and write`;
- остальные изменяющие permissions не выдаются;
- установка выполняется только в `Abrikosov-group` и только для репозитория
  `abrikosoff-academy`;
- private key создаётся отдельно и не сохраняется в репозитории.

Перед добавлением ключа владелец создаёт отдельный Environment
`release-train-lifecycle`:

- deployment branch policy — custom, ровно одна ветка `main`;
- административный обход protection rules отключён;
- секреты и переменные этого Environment не дублируются на уровне репозитория.

Job `open` всегда ссылается на этот Environment. Workflow из другой ветки не
получит private key ещё до запуска пользовательского кода, поэтому проверка
`GITHUB_REF` внутри скрипта является дополнительной, а не единственной границей
доверия.

В settings Environment `release-train-lifecycle` добавляются:

| Вид | Имя | Значение |
|---|---|---|
| Variable | `TRAIN_LIFECYCLE_APP_CLIENT_ID` | Client ID созданного GitHub App |
| Variable | `TRAIN_LIFECYCLE_OWNER_ID` | неизменяемый числовой GitHub user ID владельца |
| Secret | `TRAIN_LIFECYCLE_APP_PRIVATE_KEY` | полный PEM private key GitHub App |

Граница проверяется read-only командами:

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy/environments/release-train-lifecycle \
  --jq '{name, can_admins_bypass, deployment_branch_policy}'

gh api \
  'repos/Abrikosov-group/abrikosoff-academy/environments/release-train-lifecycle/deployment-branch-policies?per_page=100' \
  --jq '.branch_policies | map({id, name, type})'
```

Ожидаются `can_admins_bypass: false`, custom policy и ровно одна запись
`{name: "main", type: "branch"}`.

Числовой ID владельца можно получить read-only командой:

```bash
gh api /user --jq '.id'
```

Workflow дополнительно сужает installation token до `Actions: read`,
`Administration: write` и `Contents: write`. Код проверяет, что token видит
ровно один репозиторий —
`Abrikosov-group/abrikosoff-academy`. Несовпадение завершает `open` без записи
`train_opened`.

## 4. Слияние без production deployment

Слияние выполняет владелец. После него workflow
`Выпуск production-версии` должен:

1. найти ровно один связанный слитый PR для нового SHA `main`;
2. подтвердить базу `main`, тот же репозиторий, merge SHA, точную метку и полный
   список изменённых и предыдущих путей;
3. вернуть класс `infrastructure-no-deploy`;
4. завершить job классификации успешно;
5. пропустить оба job сборки образов и job production deployment.

Проверка через GitHub CLI:

```bash
gh run list --workflow release.yml --branch main --limit 3
gh run view RUN_ID
```

В summary ожидаются класс `infrastructure-no-deploy` и сообщение, что сборка и
deployment пропущены. Любой запущенный build, опубликованный новый образ или
production deployment означает провал приёмки; `open` в этом случае не
запускается.

## 5. Отключение административного обхода Environment

GitHub REST API позволяет управлять deployment branch policy, но используемый
контракт API не предоставляет поле для отключения административного обхода.
Поэтому владелец один раз вручную открывает настройки Environment
`production` и отключает возможность администраторам обходить protection
rules.

После изменения нужно убедиться, что API возвращает `false`:

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy/environments/production \
  --jq '{name, can_admins_bypass, deployment_branch_policy}'
```

Если `can_admins_bypass` не равно `false`, `train-lifecycle` остановится до
изменения Environment, защиты интеграционной ветки и записи реестра.

## 6. Регистрация существующего поезда

Текущий экземпляр регистрируется только в режиме `register_existing`.
Код принимает единственную пару:

- `source_branch`: `codex/admin-operational-mvp`;
- ожидаемый head до регистрации:
  `bb6e69adeefe59aa31ddb7e118d6c685074f4dd1`;
- `opened_from_main_sha`:
  `cb7cca60d11f22ec18aa1751ec607ab30f6b3787`.

Перед запуском владелец проверяет отсутствие других активных запусков
`train-lifecycle`, затем выполняет:

```bash
gh workflow run train-lifecycle.yml \
  --ref main \
  -f confirmation='ОТКРЫТЬ РЕЛИЗНЫЙ ПОЕЗД'
```

Полученный run отслеживается до терминального результата:

```bash
gh run list --workflow train-lifecycle.yml --branch main --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID
```

Операция использует ту же repository-wide concurrency-группу
`production-release`, что и действующий release workflow. Поэтому изменение
production Environment и production-выпуск не выполняются одновременно. Под
этой блокировкой операция:

1. повторно проверяет доверенный контекст запуска и scope служебного App;
2. создаёт либо полностью перечитывает append-only реестр;
3. отклоняет второй активный поезд;
4. требует уже отключённый admin bypass;
5. сохраняет существующие wait timer и required reviewers, отклоняет неизвестный
   тип protection rule и оставляет у production Environment ровно одну branch
   policy `main`;
6. проверяет Git-происхождение существующей ветки;
7. применяет и повторно читает точную branch protection;
8. повторно проверяет неизменность head ветки и `main`;
9. последним шагом добавляет `train_opened` и перечитывает всю историю реестра.

Повторный успешный `open` запрещён наличием активного поезда. Это не
идемпотентный no-op: второй запуск должен завершиться кодом
`TRAIN_ALREADY_ACTIVE` и ничего не изменить.

## 7. Проверка четырёх условий начального шлюза

### 7.1. Production Environment

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy/environments/production \
  --jq '{can_admins_bypass, deployment_branch_policy}'

gh api \
  'repos/Abrikosov-group/abrikosoff-academy/environments/production/deployment-branch-policies?per_page=100' \
  --jq '.branch_policies | map({id, name, type})'
```

Ожидается:

- `can_admins_bypass: false`;
- `protected_branches: false`;
- `custom_branch_policies: true`;
- ровно одна policy `{name: "main", type: "branch"}`.

### 7.2. Защита точной интеграционной ветки

```bash
gh api \
  'repos/Abrikosov-group/abrikosoff-academy/branches/codex%2Fadmin-operational-mvp/protection'
```

Ожидаются:

- `enforce_admins.enabled: true`;
- pull request обязателен, approvals могут оставаться `0`;
- stale approvals сбрасываются, bypass actors отсутствуют;
- обязательны четыре точных CI-контекста из
  `SOURCE_BRANCH_REQUIRED_CHECKS`, каждый от GitHub Actions App ID `15368`;
- required checks работают в strict-режиме;
- обсуждения должны быть закрыты;
- force-push и удаление запрещены;
- linear history отключена, потому что sync PR сохраняет merge-коммит из
  актуального `main`.

### 7.3. Append-only реестр

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy/git/ref/heads/release-train-registry \
  --jq '{ref, sha: .object.sha}'

gh api \
  repos/Abrikosov-group/abrikosoff-academy/branches/release-train-registry/protection
```

Корневой коммит отдельной ветки содержит только `registry.json`. Каждый
следующий однородительский коммит добавляет ровно один новый файл
`events/NNNNNNNN-*.json`, не меняя предыдущие blob. Push разрешён только
служебному GitHub App; force-push, удаление и нелинейная история запрещены.

В первом event должны совпадать `train_id`, точная `source_branch`,
`opened_from_main_sha`, `lifecycle_run_id`, `lifecycle_run_attempt`, actor и UTC
время. Прямое редактирование или удаление ветки реестра запрещено.

### 7.4. Активный шаблон PR

После появления шаблона в `main` новый PR должен автоматически содержать поля:

- базовая ветка;
- тип поставки;
- актуальная базовая ветка в чек-листе готовности.

Уже открытые PR не обновляются автоматически. Их описание приводится к шаблону
вручную до нового полного раунда ревью.

## 8. Синхронизация инфраструктурного PR в поезд

После успешного `open` новый `main` должен быть включён в историю текущей
интеграционной ветки отдельным sync PR. Прямой push запрещён.

Перед подготовкой sync PR проверяется, что репозиторий разрешает merge-коммиты:

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy \
  --jq '.allow_merge_commit'
```

Ожидается `true`. Если настройка изменилась, синхронизация останавливается до
решения владельца: подменять обязательный merge-коммит squash, rebase или
cherry-pick нельзя.

Исходная sync-ветка создаётся от `codex/admin-operational-mvp`, после чего в неё
merge-коммитом включается точный актуальный `origin/main`. Squash, rebase и
cherry-pick для этой синхронизации не применяются. После CI и ревью PR
направляется в `codex/admin-operational-mvp`; слияние выполняет владелец методом
merge commit.

После слияния проверяется инвариант:

```bash
git fetch origin main codex/admin-operational-mvp
git merge-base --is-ancestor \
  origin/main \
  origin/codex/admin-operational-mvp
```

Нулевой код подтверждает, что инфраструктурный `main` является предком
текущего кандидата.

## 9. Отказы и восстановление начального open

- Отказ до `train_opened` не создаёт активный поезд. Исправляется первопричина,
  затем весь `open` запускается повторно.
- Если ветка реестра создана с корректным единственным metadata-коммитом, но
  установка её защиты не завершилась, повторный `open` применяет точный контракт
  защиты и повторно проверяет, что пустой реестр не изменился. Непустой реестр с
  неверной защитой автоматически не исправляется: это отдельный инцидент.
- Если `train_opened` уже записан, но workflow потерял ответ при контрольном
  чтении, повтор того же GitHub Actions run с тем же `run_id` подтверждает
  существующую запись и возвращает исходный результат. Новый `workflow_dispatch`
  с другим `run_id` остаётся заблокированным как второй `open`.
- Для `register_existing` исходная интеграционная ветка не создаётся и при
  отказе не удаляется.
- Создание нового поезда (`create_new`) этим начальным workflow намеренно не
  предоставляется. Оно добавляется только вместе с полным проверенным
  жизненным циклом в отдельном пакете.
- После успешного `train_opened` удалять реестр или ветку для «отмены» нельзя.
  До реализации проверенного `abort` поезд остаётся активным. Поэтому `open`
  запускается только после полной технической приёмки начального шлюза и
  решения продолжать текущий поезд.
- Если Environment, branch protection или реестр после успешного `open`
  отличаются от контракта, функциональные слияния останавливаются до
  расследования; данные вручную не «подправляются».

## 10. Критерий завершения

Начальный шлюз считается действующим только когда одновременно доказаны:

1. инфраструктурный PR принят в `main`, а его release run завершился как
   `infrastructure-no-deploy` без сборки и deployment;
2. production Environment допускает только `main` и не имеет admin bypass;
3. `codex/admin-operational-mvp` защищена точными правилами, применимыми к
   администраторам;
4. append-only реестр содержит ровно один активный `train_opened` для этой
   ветки;
5. новый PR получает шаблон из default-ветки;
6. инфраструктурный `main` синхронизирован в ветку поезда через проверенный
   merge PR.

До выполнения всех пунктов новый функциональный пакет не сливается в
интеграционную ветку. Даже после их выполнения финальный PR поезда в `main`
остаётся запрещён до отдельного финального шлюза выпуска.
