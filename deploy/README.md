# Production-развёртывание

Конфигурация рассчитана на московский сервер Академии и запускает три сервиса:

- `caddy` — единственная публичная точка входа на портах 80 и 443;
- `app` — приложение на внутреннем порту 3000;
- `database` — PostgreSQL только во внутренней сети Docker.

## Подготовка

```bash
cp .env.example .env
```

В `.env` необходимо установить уникальный пароль PostgreSQL, корректный
`DATABASE_URL`, версию образа и ключи интеграций. Файл `.env` не передаётся в
GitHub.

## Проверка конфигурации

```bash
ACADEMY_ENV_FILE=.env.example \
  docker compose --env-file .env.example -f compose.production.yaml config --quiet
```

## Запуск

```bash
docker compose --env-file .env -f compose.production.yaml pull
docker compose --env-file .env -f compose.production.yaml up -d
docker compose --env-file .env -f compose.production.yaml ps
```

Фактическая выкладка будет выполняться автоматизированным процессом с проверкой
health-check и возможностью возврата к предыдущему образу.
