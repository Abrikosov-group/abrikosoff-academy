# Начальный шлюз интеграционного релизного поезда

Инструкция относится только к одноразовой регистрации существующей ветки
`codex/admin-operational-mvp` операцией `register_existing`. Она реализует
начальную часть [ADR-0009](../decisions/0009-integration-release-train.md) с
Team/private-уточнением
[ADR-0010](../decisions/0010-team-private-release-train-bootstrap.md).

Операции `create_new`, `abort`, `close`, `fail`, `recover`, `reconcile`,
candidate-build, staging, manifest и production promotion этой инструкцией не
реализуются. Успешный `open` не разрешает финальный production-выпуск.

## 1. Почему шлюз выполняется локально

Репозиторий Академии является private-репозиторием организации на GitHub Team.
Deployment branch policies для него доступны, но GitHub не предоставляет
настройку запрета административного обхода Environment. Поэтому API возвращает
`can_admins_bypass: true`, а private key в Environment мог бы быть получен
изменённым workflow после принудительного обхода.

Принятый профиль:

- private key остаётся только на локальной машине владельца;
- `.github/workflows/train-lifecycle.yml` не получает Environment, secret или
  App token и всегда завершается безопасным отказом;
- локальный процесс создаёт GitHub App JWT и installation token только в
  памяти;
- token ограничивается одним репозиторием и правами текущей операции
  `actions:read`, `administration:write`, `contents:write`, `metadata:read`;
  `actions:read` используется только для чтения production Environment и, если
  уже включён custom-режим, его deployment branch policies; после операции
  token отзывается;
- все удалённые мутации выполняет служебный GitHub App, а не пользовательский
  token владельца;
- неизбежный `can_admins_bypass: true` принимается только точным локальным
  профилем `github_team_private_local_owner` и сохраняется в append-only аудите.

Это не технический запрет действий злонамеренного владельца организации.
Владелец и его локальная машина входят в явную границу доверия до перехода на
Enterprise либо внешний OIDC-bound secret broker.

## 2. Защитные инварианты

- Команда запускается только из корня чистого `main`.
- Перед token выполняется `git fetch`; локальный `HEAD` обязан совпасть с
  `origin/main`.
- `origin` обязан указывать на
  `Abrikosov-group/abrikosoff-academy`.
- GitHub CLI обязан быть авторизован как пользователь с ID `224131170`, с
  активной ролью `admin` в `Abrikosov-group`.
- Организация обязана иметь план `team`, репозиторий — visibility `private`,
  default branch — `main`.
- Принимается только GitHub App:
  - App ID `4473722`;
  - Client ID `Iv23lihDWOdXtSQ50Lt7`;
  - slug `abrikosoff-academy-train`;
  - владелец `Abrikosov-group`.
- Installation обязана быть активной, без webhook events, только для выбранных
  репозиториев и с точными permissions:
  `actions:read`, `administration:write`, `contents:write`, `metadata:read`.
- Installation token запрашивается только для `abrikosoff-academy`.
- PEM обязан быть обычным RSA-файлом не короче 2048 бит, принадлежать текущему
  системному пользователю и не иметь прав группы или остальных пользователей.
- Стабильный `operation_id` сохраняется в `.git` до получения token и
  повторно используется после прерывания.
- Production Environment после операции разрешает deployment только из точной
  ветки `main`; wait timer и required reviewers, если платформа когда-либо их
  вернёт, сохраняются.
- Ветка поезда защищается с `enforce_admins`, обязательными PR, четырьмя точными
  CI-контекстами, закрытием обсуждений, запретом force-push и удаления.
- Для существующей source branch push restrictions отключены, поэтому
  `block_creations=false`: по
  [контракту GitHub](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2026-03-10#update-branch-protection)
  этот параметр действует только через `restrictions`. Прямые изменения
  запрещает обязательный PR, а повторное создание существующей ветки исключает
  отдельный запрет удаления. Для append-only реестра `block_creations=true`
  сохраняется вместе с ограничением записи точным служебным App.
- Исходящий `required_status_checks` для ветки поезда передаёт только `strict`
  и app-bound `checks`; поле `contexts` не передаётся. GitHub REST API
  [предписывает использовать `checks` вместо `contexts` для более точного
  контроля](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2026-03-10#update-branch-protection),
  а одновременная передача обеих форм отклоняется. После применения защиты в
  ответе проверяются и точные `checks`, и производный список `contexts`.
- Append-only реестр разрешает push только служебному App.
- В ответе branch protection GitHub может пропустить отключённые необязательные
  разделы вместо явного `null`. Только эти две формы считаются эквивалентным
  подтверждением отключения; любой объект по-прежнему отклоняется.
- `train_opened` записывается последним, после повторной проверки `main`, source
  head и обеих branch protection.
- Любое несовпадение завершает операцию без `train_opened`.

## 3. Предварительное состояние GitHub App

App должен быть установлен только на репозиторий
`Abrikosov-group/abrikosoff-academy`. В настройках App ожидаются:

| Область | Уровень |
|---|---|
| Actions | Read-only |
| Administration | Read and write |
| Contents | Read and write |
| Metadata | Read-only |
| Webhook events | ни одного |

Private key создаётся на странице App один раз и сохраняется вне репозитория.
Файл нельзя добавлять в `.env`, GitHub secret, облачный диск, Git, сообщение или
журнал. Перед использованием:

```bash
chmod 600 /absolute/path/abrikosoff-academy-train.private-key.pem
```

Environment `release-train-lifecycle`, созданный во время первоначальной
настройки, не является границей секрета на GitHub Team/private. В нём не должно
быть `TRAIN_LIFECYCLE_APP_PRIVATE_KEY`; workflow его не использует. Удаление
самого Environment выполняется только отдельным явным решением владельца и не
нужно для локального `open`.

## 4. Что проверяет режим `--verify`

`--verify` не меняет refs, protections, Environment или реестр. Он:

1. проверяет локальный checkout и заново получает `origin/main`;
2. проверяет GitHub CLI identity, роль владельца, plan и visibility;
3. проверяет права и криптографический тип PEM;
4. подписывает RS256 JWT с временем жизни девять минут;
5. проверяет точную App identity и installation;
6. создаёт installation token для одного репозитория и минимальных прав;
7. повторно проверяет scope token и SHA удалённого `main`;
8. проверяет взаимоисключающий режим deployment branch policy production
   Environment; список custom policies читает только при уже включённом
   `custom_branch_policies=true`;
9. отзывает installation token;
10. не создаёт локальный operation state.

Запускать команду можно только после того, как содержащий её инфраструктурный
PR принят владельцем в `main`, а локальный `main` синхронизирован. Из корня
репозитория:

```bash
node scripts/release-train/local-bootstrap.mjs \
  --verify \
  --private-key /absolute/path/abrikosoff-academy-train.private-key.pem
```

Успешная строка содержит только репозиторий, SHA и slug App. JWT, installation
token и private key не выводятся.

## 5. Локальный `open`

Перед изменяющим запуском владелец повторно проверяет:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
gh api user --jq '{id,login}'
gh api orgs/Abrikosov-group --jq '{login,plan:.plan.name}'
gh api repos/Abrikosov-group/abrikosoff-academy \
  --jq '{full_name,visibility,default_branch}'
```

Ожидаются чистый `main`, два одинаковых SHA, user ID `224131170`, plan `team`,
visibility `private` и default branch `main`.

После успешного `--verify` запускается ровно одна команда:

```bash
node scripts/release-train/local-bootstrap.mjs \
  --open \
  --private-key /absolute/path/abrikosoff-academy-train.private-key.pem \
  --confirmation "ОТКРЫТЬ РЕЛИЗНЫЙ ПОЕЗД"
```

До удалённых мутаций команда атомарно создаёт:

```text
.git/abrikosoff-release-train-bootstrap.json
```

Файл имеет права `0600` и содержит только несекретные поля: schema version,
репозиторий, режим, App ID, actor, точный SHA `main`, UTC-время и стабильный
UUID операции. Его не удаляют между повторами одного `open`.

Далее общий lifecycle:

1. подтверждает scope installation token;
2. читает реестр и останавливается при другом активном поезде;
3. повторно проверяет удалённый `main`;
4. создаёт пустой append-only реестр либо проверяет существующий;
5. подтверждает Team/private-профиль production Environment;
6. сохраняет существующие protection rules и включает custom branch policy;
7. удаляет все deployment branch policies, кроме точной `main`, либо создаёт
   её;
8. проверяет точные происхождение и head существующей source branch;
9. применяет и перечитывает точную branch protection source branch;
10. повторно проверяет неизменность source head и `main`;
11. добавляет `train_opened` схемы 2 с
    `lifecycle_invocation.kind=local_owner`, стабильным `operation_id` и
    `environment_admin_bypass_policy=github_team_private_local_owner`;
12. перечитывает всю append-only историю;
13. отзывает installation token.

Повтор с тем же локальным state после потери ответа возвращает уже созданный
`train_id`, если actor, operation ID, source branch, opened-from SHA и политика
совпадают. Другой operation ID не может подтвердить активный поезд.

## 6. Доказательная проверка после `open`

### 6.1. Production Environment

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy/environments/production \
  --jq '{name,can_admins_bypass,deployment_branch_policy}'

gh api \
  'repos/Abrikosov-group/abrikosoff-academy/environments/production/deployment-branch-policies?per_page=100' \
  --jq '.branch_policies | map({id,name,type})'
```

Ожидаются:

- `can_admins_bypass: true` — задокументированное ограничение Team/private, а
  не выполненный исходный запрет;
- `custom_branch_policies: true` и `protected_branches: false`;
- ровно одна policy `{name: "main", type: "branch"}`.

### 6.2. Source branch

```bash
gh api \
  'repos/Abrikosov-group/abrikosoff-academy/branches/codex%2Fadmin-operational-mvp/protection'
```

Проверяются `enforce_admins`, PR requirement, strict status checks, четыре
точных контекста GitHub Actions, conversation resolution, запрет bypass,
force-push, deletion и recreation.

### 6.3. Append-only реестр

```bash
gh api \
  repos/Abrikosov-group/abrikosoff-academy/git/ref/heads/release-train-registry \
  --jq '{ref,sha:.object.sha}'

gh api \
  repos/Abrikosov-group/abrikosoff-academy/branches/release-train-registry/protection
```

Ветка обязана иметь линейную историю без force-push и удаления, а push
restrictions — ровно один App `abrikosoff-academy-train`. В дереве ожидаются
канонический `registry.json` схемы 2 и ровно одно событие `train_opened`.
Событие должно содержать:

- точные `train_id`, `source_branch`, `opened_from_main_sha`;
- owner actor ID и текущий login;
- UTC `occurred_at`;
- `lifecycle_invocation.kind=local_owner` и UUID `operation_id`;
- `environment_admin_bypass_policy=github_team_private_local_owner`.

### 6.4. Отсутствие deployment

Начальный `open` не запускает release workflow и не создаёт production
deployment. После него `/api/health` и production SHA не должны измениться.

## 7. Ошибки и безопасный повтор

- Отказ до `train_opened` не создаёт активный поезд. Устраняется первопричина,
  затем повторяется та же команда с сохранённым локальным state.
- Если пустой реестр создан, но его protection не применён, повтор может
  восстановить protection только пока в реестре нет событий и head не изменён.
- Protection непустого реестра автоматически не ремонтируется: требуется
  расследование.
- Отказ применения защиты source branch может произойти после успешной
  настройки production Environment. Пока `train_opened` отсутствует, это не
  создаёт активный поезд: точная policy `main` сохраняется, локальный state не
  удаляется, а повтор разрешён только после устранения причины и повторной
  проверки реестра, Environment и source branch.
- GitHub возвращает `block_creations=false` для source branch без push
  restrictions, даже если запрос передал `true`. Такой отказ post-check не
  создаёт `train_opened`; совместимый контракт обязан явно запрашивать и
  проверять `false`, не ослабляя отдельную защиту реестра.
- Если `train_opened` уже записан, повтор с тем же operation ID подтверждает
  результат без второй записи.
- Несовпадение локального state с новым SHA `main` закрывает повтор. Перед
  удалением или заменой state сначала вручную доказывается отсутствие
  `train_opened` для его operation ID.
- Ошибка отзыва installation token считается ошибкой шлюза. Не выводя token,
  владелец проверяет App audit, при необходимости отзывает private key; сам
  installation token в любом случае ограничен одним часом.
- После успешного `train_opened` удалять реестр, source branch или локальную
  запись ради «отмены» нельзя. Для отмены нужна ещё не реализованная операция
  `abort` из финального lifecycle.

## 8. Локальные проверки пакета до PR

Изменение самого шлюза проверяется из feature-ветки, но `--verify` и `--open`
из неё не запускаются: команды требуют точный `main`.

```bash
node --check scripts/release-train/local-bootstrap.mjs
node --test tests/release-train/*.test.mjs
npm run check
npm run test:e2e
npm run audit:production
```

PR этого пакета является инфраструктурным, использует метку
`release:infrastructure-no-deploy`, проходит полный раунд ревью и сливается
только владельцем. Успешная классификация должна пропустить build и deployment.

## 9. Критерий готовности начального шлюза

Начальный шлюз можно признать действующим только после отдельного подтверждения
владельца, когда одновременно:

1. пакет ADR-0010 принят в `main` без deployment;
2. `--verify` завершён успешно на точном актуальном `main`;
3. `--open` завершён успешно и installation token отозван;
4. production Environment содержит только точную policy `main`, а неизбежный
   admin bypass явно зафиксирован как Team/private-риск;
5. source branch имеет точную защиту;
6. append-only реестр схемы 2 содержит ровно один активный `train_opened` с
   локальным operation ID;
7. новый PR автоматически получает шаблон из default branch;
8. production SHA и deployments не изменились.

До выполнения всех пунктов карта реализации сохраняет статус «реализовано
локально, функциональная QA-проверка не выполнена», а функциональные слияния в
source branch остаются заблокированы.
