# Изолированные runner’ы двойного ревью Academy

Организационный workflow двойного ИИ-ревью использует три отдельных self-hosted
runner’а на VPS `srv1909949.hstgr.cloud` (`187.124.113.218`). Старые IP в именах
runner’ов других проектов не описывают фактический адрес сервера и не должны
использоваться для настройки Academy.

| Назначение | Runner | Label |
| --- | --- | --- |
| Оркестрация и публикация | `abrikosoff-academy-review-orchestration-01` | `abrikosoff-academy-review-orchestration` |
| Анализ Codex | `abrikosoff-academy-review-codex-01` | `abrikosoff-academy-review-codex` |
| Анализ Claude | `abrikosoff-academy-review-claude-01` | `abrikosoff-academy-review-claude` |

Все три runner’а принадлежат закрытой организационной группе
`abrikosoff-academy-review`. Группа:

- доступна только репозиторию `Abrikosov-group/abrikosoff-academy`;
- разрешает public repository, поскольку Academy публична;
- ограничена exact reusable workflow
  `Abrikosov-group/.github/.github/workflows/review-all.yml@5fb3bc99efb0703cb5e979295ba1c75f2f0cce1f`;
- не содержит runner’ов Sawabook, production или staging.

## Граница доверия

Каждый runner работает от отдельного Unix-пользователя, имеет отдельные home,
work и diag-каталоги и точный systemd service. Job-start hook разрешает только:

- репозиторий `Abrikosov-group/abrikosoff-academy`;
- защищённый default branch `main`;
- entry workflow `.github/workflows/review-all.yml` из `main`;
- события `pull_request_target` и `issue_comment` с проверяемым payload;
- точное соответствие runner и job.

Модельные runner’ы очищают workspace и модельный home до и после job. Codex
сохраняет только отдельную копию `auth.json`; Claude получает OAuth-токен только
из GitHub Actions secret. Все runner services используют `ProtectProc=invisible`,
`NoNewPrivileges=true`, `ProtectSystem=full`, пустой capability set и отдельные
лимиты памяти, CPU и процессов.

## Первичная установка

`install.sh` предназначен только для чистой первичной установки и завершится с
ошибкой при обнаружении существующего Academy runner root, service или
Unix-пользователя. Он не изменяет и не перезапускает существующие runner’ы.

Перед запуском оператор должен проверить:

1. Все существующие `actions.runner.*` имеют `ProtectProc=invisible`.
2. Runner group имеет точные настройки, перечисленные выше, и пока пуста.
3. На сервере установлены GitHub Actions Runner `2.336.0`, Codex CLI `0.147.0`
   и Claude Code `2.1.226` либо доступна загрузка закреплённого runner archive.
4. Источник Codex OAuth
   `/var/lib/sawabook-review-codex/.codex/auth.json` является обычным файлом
   `sawabookreviewcodex:sawabookreviewcodex:600`. Скрипт копирует его в отдельный
   Academy home и не выводит содержимое.

Для каждого runner создаётся отдельный одночасовой organization registration
token. Три токена передаются скрипту тремя строками через stdin; аргументы,
файлы репозитория и журналы их не содержат.

```bash
printf '%s\n%s\n%s\n' \
  "$orchestration_token" \
  "$codex_token" \
  "$claude_token" |
  sudo infra/github-runners/abrikosoff-academy-review/install.sh
```

После установки обязательны две независимые проверки:

```bash
gh api orgs/Abrikosov-group/actions/runner-groups/9/runners \
  --jq '.runners[] | {name,status,busy,labels:[.labels[].name]}'

systemctl show \
  actions.runner.Abrikosov-group.abrikosoff-academy-review-orchestration-01.service \
  actions.runner.Abrikosov-group.abrikosoff-academy-review-codex-01.service \
  actions.runner.Abrikosov-group.abrikosoff-academy-review-claude-01.service \
  --property=Id --property=ActiveState --property=SubState \
  --property=User --property=ProtectProc --property=NoNewPrivileges
```

## Безопасный откат первичной установки

Откат выполняется только после подтверждения `busy=false` у всех трёх runner’ов.
Сначала сервисы останавливаются и отключаются, затем удаляются через `svc.sh
uninstall`, а точные runner IDs удаляются из группы GitHub API. Каталоги и
Unix-пользователи сохраняются до отдельного аудита; автоматическое рекурсивное
удаление намеренно отсутствует.

Службы Sawabook и `codex-spark-review` не входят в откат Academy.
