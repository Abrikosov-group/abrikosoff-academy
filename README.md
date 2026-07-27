# Академия Абрикософф

Веб-платформа для курсов, подписок и личного кабинета Академии Абрикософф.

Продакшен-домен: [academy.abrikosoff.com](https://academy.abrikosoff.com)

## Состояние

Репозиторий содержит первоначальный технический каркас. Оплата, авторизация,
личный кабинет и выдача доступа ещё не подключены. Текущая страница закрыта от
поисковой индексации до полноценного запуска.

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
npm run dev
```

Приложение откроется по адресу [http://localhost:3000](http://localhost:3000).
Проверка состояния доступна на
[http://localhost:3000/api/health](http://localhost:3000/api/health).

## Проверки

```bash
npm run lint
npm run typecheck
npm run build
npm run audit:production
```

Все основные проверки одной командой:

```bash
npm run check
```

## Структура

```text
src/app/                 маршруты и интерфейс Next.js
src/app/api/health/      проверка состояния приложения
deploy/                  production-конфигурация Docker и Caddy
docs/                    архитектурные решения и эксплуатационные документы
.github/workflows/       автоматические проверки
```

Проект развивается как модульный монолит. Границы будущих модулей описаны в
[архитектурном документе](docs/architecture.md).

## Секреты

Файлы `.env` не добавляются в Git. В репозитории разрешены только примеры без
настоящих токенов и паролей. Ключи ЮKassa, Telegram, SSH и данные учеников нельзя
помещать в исходный код, журналы или GitHub.

## Production

Production-конфигурация находится в `deploy/compose.production.yaml`.
Автоматическая сборка образа и выкладка на московский сервер будут добавлены
отдельным этапом после настройки GitHub Container Registry и резервного
копирования PostgreSQL.
