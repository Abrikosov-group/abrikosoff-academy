# ADR-0010: локальный начальный шлюз релизного поезда для GitHub Team/private

- Статус: принято
- Дата: 2026-08-03
- Подтверждено владельцем: 2026-08-03
- Изменяет: только начальную операцию `register_existing` из ADR-0009

## Контекст

ADR-0009 требует, чтобы private key отдельного GitHub App выдавался только
доверенному `train-lifecycle` из `main`, а административный обход Environment
был запрещён. После создания реального App и Environment выяснилось, что
репозиторий Академии является private-репозиторием организации на плане GitHub
Team. Для такого сочетания GitHub предоставляет deployment branch policies, но
не предоставляет настройку запрета административного обхода protection rules.
API поэтому стабильно возвращает `can_admins_bypass: true`, а переключатель в
интерфейсе отсутствует.

Это ограничение зафиксировано в первичной документации GitHub:

- [deployment branches доступны private-репозиториям на GitHub Team](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags);
- [на Free, Pro и Team настройка административного обхода доступна только
  public-репозиториям](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#allow-administrators-to-bypass-configured-protection-rules).

Сохранение private key в таком Environment создало бы ложную границу доверия.
Администратор мог бы принудительно продолжить job из изменённого workflow и
получить секрет до выполнения проверок прикладного скрипта. Простое принятие
`can_admins_bypass: true` внутри прежнего Actions-пути поэтому отклонено.

Одновременно план GitHub Team позволяет применить точную deployment branch
policy `main`, а branch protection поддерживает `enforce_admins`, запрет прямых
изменений и push restrictions для служебного App. Начальный шлюз можно выполнить
без хранения private key в GitHub, сохранив узкую служебную identity и
append-only аудит.

## Решение

1. Для текущего сочетания `organization plan = team` и
   `repository visibility = private` начальный `open` в режиме
   `register_existing` выполняется только локальной командой владельца из
   чистого и актуального `main`.
2. Private key GitHub App:
   - хранится отдельным локальным PEM-файлом владельца с правами не шире
     `0600`;
   - не записывается в GitHub Environment, Actions secret, `.env`, Git,
     аргумент API, журнал или файл состояния операции;
   - загружается только в память локального процесса и используется для
     RS256 JWT с временем жизни менее десяти минут.
3. Локальная команда до первой удалённой мутации независимо проверяет:
   - запуск из корня репозитория, чистый worktree, точную ветку `main` и
     совпадение `HEAD` с заново полученным `origin/main`;
   - точный `origin` репозитория Академии;
   - GitHub CLI identity по неизменяемому user ID владельца, активную роль
     администратора организации, план `team`, private visibility и default
     branch `main`;
   - точные App ID, Client ID, slug и владельца App;
   - установку App только на выбранные репозитории, отсутствие событий,
     отсутствие suspension и точные permissions `actions:read`,
     `administration:write`, `contents:write`, `metadata:read`.
4. Installation token создаётся официальным App API только для
   `abrikosoff-academy` и с минимальными правами текущей операции:
   `administration:write`, `contents:write` и неотключаемым `metadata:read`.
   Installation может дополнительно иметь `actions:read` для целевого
   lifecycle, но локальный token это право не запрашивает. Формат и длина token
   не считаются стабильным контрактом. Ответ повторно проверяется, token никогда
   не выводится и отзывается через API после успеха либо ошибки.
5. До получения token локальная команда атомарно сохраняет в `.git` стабильный
   UUID операции. Повтор использует тот же UUID. Файл содержит только
   несекретные audit-данные, имеет права `0600` и привязан к точным владельцу,
   App, репозиторию и SHA `main`.
6. Событие `train_opened` в схеме реестра версии 2 хранит честное происхождение:
   - для локального шлюза — `lifecycle_invocation.kind=local_owner` и
     `operation_id`;
   - для будущего Actions-шлюза — `kind=github_actions`, `run_id` и
     `run_attempt`.
   Синтетические Actions run ID для локальной операции запрещены.
7. Локальная операция принимает `can_admins_bypass: true` только при
   одновременном доказательстве точного профиля Team/private, локального
   владельца и зафиксированного App. Actions-путь сохраняет прежнее строгое
   требование `can_admins_bypass: false`.
8. После этой узкой развилки общий алгоритм ADR-0009 не меняется: проверяется
   scope installation token, создаётся и защищается append-only реестр,
   production Environment ограничивается точной веткой `main`, проверяется
   существующая интеграционная ветка, к ней применяется точная защита, затем
   повторно проверяются `main`, source head и protections. `train_opened`
   остаётся последней мутацией.
9. Workflow `.github/workflows/train-lifecycle.yml` на текущем плане не получает
   Environment, private key или App token. Любой ручной запуск завершается
   явным безопасным отказом и направляет владельца к локальной инструкции.
10. Локальный шлюз не выполняет build, migration, deployment или изменение
    production-приложения. Он реализует только начальную регистрацию уже
    существующего релизного поезда и защитные настройки.

## Граница доверия и остаточный риск

Этот вариант не утверждает, что GitHub Team/private технически запрещает
администратору обход production Environment. Такой запрет на текущем плане
невозможен. Доверенной стороной становится единственный зафиксированный
владелец организации вместе с локальной машиной и private key. Точная branch
policy `main`, явный ref guard release workflow и локальное хранение ключа
защищают от обычного ошибочного запуска и от получения служебного ключа через
изменённый Actions workflow, но не от злонамеренного владельца организации,
который способен изменить настройки репозитория и самого App.

Поэтому:

- `github_team_private_local_owner` сохраняется в append-only событии как
  явное audit-свидетельство принятой границы;
- успешный initial open не означает готовность финального production-шлюза;
- финальный выпуск остаётся запрещён до staging, manifest, promotion по digest,
  обработки `close/fail/recover/reconcile` и отдельной пользовательской приёмки;
- смена плана, visibility, владельца, App identity, permissions или default
  branch закрывает локальный профиль по принципу fail-closed и требует нового
  архитектурного решения.

## Отклонённые варианты

### Хранить private key в текущем Environment

Отклонено: доступный административный обход позволяет получить секрет до
прикладного preflight изменённого workflow.

### Хранить private key как repository или organization secret

Отклонено: область выдачи становится шире, а исходная проблема доверия к
workflow не устраняется.

### Разрешить `can_admins_bypass: true` прежнему Actions workflow

Отклонено: это маскировало бы несовместимость платформы и ослабило исходный
инвариант без отдельной границы доверия.

### Подключить внешний secret broker или перейти на Enterprise немедленно

Технически допустимо, но несоразмерно одноразовой начальной операции стартапа.
Такой вариант можно принять для финального постоянно работающего lifecycle.

## Переход к целевой архитектуре

После перехода на план и конфигурацию, где административный обход действительно
запрещается, либо после внедрения внешнего OIDC-bound secret broker:

1. private key переносится в доказанно не обходящуюся границу;
2. Actions lifecycle восстанавливается отдельным инфраструктурным PR;
3. локальный Team/private-профиль отключается;
4. новые события используют `github_actions` с точными `run_id` и
   `run_attempt`;
5. существующее событие локального initial open остаётся неизменяемой частью
   истории и не переписывается.

## Критерии приёмки реализации

- workflow не содержит Environment, App action, private-key input или ссылку на
  GitHub secret;
- `--verify` выполняет только чтение, проверяет локальный checkout, владельца,
  Team/private, App, installation, token scope и отзыв token;
- `--open` требует точную фразу подтверждения и стабильный operation ID;
- любой другой владелец, план, visibility, origin, App, permission, event,
  repository scope, SHA или небезопасные права PEM закрывают операцию;
- строгий Actions-профиль продолжает отклонять `can_admins_bypass: true`;
- Team/private-профиль недоступен Actions invocation;
- `train_opened` создаётся только после production policy, branch protection и
  повторных проверок;
- unit-тесты покрывают подпись JWT, узкий token, профиль платформы, права PEM,
  идемпотентный локальный operation ID, отзыв token и обе политики Environment.
