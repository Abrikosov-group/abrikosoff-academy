# Академия Абрикософф

Веб-платформа для курсов, подписок и личного кабинета Академии Абрикософф.

Продакшен-домен: [academy.abrikosoff.com](https://academy.abrikosoff.com)

## Состояние

Репозиторий содержит интерфейс MVP, Identity-модуль и независимое от провайдера
платёжное ядро. Локальные вход и оплата работают в demo-режиме без отправки
писем и реальных списаний. Пользователи, сессии, заказы и подписки сохраняются
в PostgreSQL. Адаптер ЮKassa подготовлен, но live-платежи остаются выключенными
до добавления реквизитов магазина и production-проверки. Текущая страница
закрыта от поисковой индексации до полноценного запуска.

## Технологии

- Next.js 16, App Router и TypeScript;
- React 19;
- Node.js 24 LTS;
- PostgreSQL 18;
- Docker Compose;
- Caddy с автоматическим HTTPS;
- GitHub Actions.

## Локальный запуск

Требуются Node.js 24, npm 11 и Docker.

```bash
cp .env.example .env
docker compose up -d database
npm ci
npm run db:migrate
npm run dev
```

Приложение откроется по адресу [http://localhost:3000](http://localhost:3000).
Проверка состояния доступна на
[http://localhost:3000/api/health](http://localhost:3000/api/health).

## Проверки

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run audit:production
```

Интеграционные и браузерные тесты используют отдельную базу из
`TEST_DATABASE_URL`. Команда подготовки принимает только имя базы с суффиксом
`_test` и не очищает основную базу разработки.

Все основные проверки одной командой:

```bash
npm run check
```

`npm run check` включает модульные и PostgreSQL-интеграционные тесты.
Браузерный сценарий запускается отдельно командой `npm run test:e2e`.

## Структура

```text
src/app/                 маршруты и интерфейс Next.js
src/app/api/             healthcheck и серверные платёжные маршруты
src/modules/identity/    пользователи, способы входа и серверные сессии
src/modules/billing/     платёжное ядро и адаптеры провайдеров
db/migrations/           версионируемая схема PostgreSQL
tests/                   unit-, integration- и E2E-тесты
deploy/                  production-конфигурация Docker и Caddy
docs/                    архитектурные решения и эксплуатационные документы
.github/workflows/       автоматические проверки
```

Проект развивается как модульный монолит. Границы будущих модулей описаны в
[архитектурном документе](docs/architecture.md).

## Платежи

Режим задаётся переменной `PAYMENTS_MODE`:

- `demo` — локальный сценарий без реального списания;
- `live` — ЮKassa, только после заполнения серверных секретов;
- `disabled` — приём платежей выключен; это безопасное значение по умолчанию
  для production.

Внутренние заказы и подписки не зависят от объектов ЮKassa. Решение и правила
добавления следующих провайдеров зафиксированы в
[ADR-0002](docs/decisions/0002-multi-provider-payments.md).

## Авторизация

Один внутренний аккаунт может иметь несколько подтверждённых способов входа:
Telegram, email и телефон. Локально доступны demo-Telegram и одноразовая ссылка
по почте. Production-вход Telegram включается после заполнения
`TELEGRAM_BOT_TOKEN`, задания `TELEGRAM_BOT_USERNAME` и привязки домена к боту
в BotFather. Модель сессий описана в
[ADR-0003](docs/decisions/0003-identity-and-sessions.md).

## Секреты

Файлы `.env` не добавляются в Git. В репозитории разрешены только примеры без
настоящих токенов и паролей. Ключи ЮKassa, Telegram, SSH и данные учеников нельзя
помещать в исходный код, журналы или GitHub.

## Production

Production-конфигурация находится в `deploy/compose.production.yaml`.
После изменения защищённой ветки `main` GitHub Actions собирает образ, публикует
его в приватный GitHub Container Registry и развёртывает на московском сервере.
Каждый релиз привязан к полному SHA коммита и проверяется через `/api/health`.
Подробности и порядок аварийной проверки описаны в
[инструкции по развёртыванию](deploy/README.md).

PostgreSQL ежедневно сохраняется локальным systemd-таймером. Каждый архив
проверяется полным восстановлением во временную базу; порядок контроля описан в
[инструкции по резервному копированию](docs/operations/postgresql-backups.md).
