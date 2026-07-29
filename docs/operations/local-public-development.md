# Постоянный публичный адрес локальной разработки

Для Telegram OIDC локальная Академия использует именованный Cloudflare Tunnel:

- публичный адрес: `https://academy-dev.abrikosoff.com`;
- локальный адрес приложения: `http://127.0.0.1:3100`;
- имя туннеля: `abrikosoff-academy-local`.

Адрес и DNS остаются постоянными. Сайт доступен по нему, пока на компьютере
запущены приложение и `cloudflared`.

Production-подобная сборка и туннель запускаются только на время приёмочной
сессии и останавливаются сразу после неё. Постоянным остаётся DNS-адрес, а не
доступ к локальному компьютеру.

## 1. Разделение локальной и боевой среды

Для локальной среды используются:

- отдельная база PostgreSQL без данных реальных учеников;
- `PAYMENTS_MODE=demo`;
- отдельный Telegram-бот `@local_AbrikosoffBot`;
- отдельный OIDC-клиент этого бота с Client ID `8965978102`;
- отдельные локальные секреты в `.env.local`.

Боевые ключи Telegram, ЮKassa и production-базы в локальную среду не
копируются.

Для проверки Telegram в BotFather регистрируются точные значения:

```text
Origin:
https://academy-dev.abrikosoff.com

Redirect URI:
https://academy-dev.abrikosoff.com/api/auth/telegram/callback
```

В `.env.local` задаются:

```dotenv
APP_BASE_URL=https://academy-dev.abrikosoff.com
AUTH_DEMO_MODE=disabled
EMAIL_AUTH_MODE=disabled
ADMINISTRATION_ENABLED=true
ADMINISTRATION_MODE=owner_preview
TELEGRAM_OIDC_CLIENT_ID=8965978102
TELEGRAM_OIDC_CLIENT_SECRET=<из защищённого хранилища>
TELEGRAM_OIDC_REDIRECT_URI=https://academy-dev.abrikosoff.com/api/auth/telegram/callback
PAYMENTS_MODE=demo
PAYMENT_DEFAULT_PROVIDER=demo
```

`owner_preview` открывает на локальном приёмочном origin только текущий
защитный фундамент Administration. Режим `operational` не используется как
локальное значение по умолчанию до завершения обязательных зависимостей
этапа 2 административного ТЗ.

## 2. Однократное создание туннеля

`cloudflared` должен быть установлен, а зона `abrikosoff.com` — подключена к
Cloudflare.

```bash
cloudflared tunnel login
cloudflared tunnel create abrikosoff-academy-local
cloudflared tunnel route dns \
  abrikosoff-academy-local \
  academy-dev.abrikosoff.com
```

Команда создания выводит идентификатор туннеля и создаёт файл учётных данных
`~/.cloudflared/<TUNNEL_ID>.json`.

Создать локальный файл
`~/.cloudflared/abrikosoff-academy-local.yml` по образцу:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: <ABSOLUTE_PATH_TO_TUNNEL_CREDENTIALS>

ingress:
  - hostname: academy-dev.abrikosoff.com
    service: http://127.0.0.1:3100
  - service: http_status:404
```

В `credentials-file` подставляется полный путь, который вывела команда
`cloudflared tunnel create`, например
`/Users/local-user/.cloudflared/<TUNNEL_ID>.json`. В YAML используется
абсолютный путь, а не сокращение `~`.

Перед первым запуском конфигурация проверяется локально:

```bash
cloudflared tunnel \
  --config "$HOME/.cloudflared/abrikosoff-academy-local.yml" \
  ingress validate
```

Файл учётных данных и локальную конфигурацию не добавляют в Git.

## 3. Локальная разработка и приёмка

Во время написания кода Next.js запускается только на localhost:

```bash
npm run dev
```

Полная проверка Telegram OIDC через публичный HTTPS-адрес выполняется на
production-подобной локальной сборке. Так проверяются те же защищённые cookies,
что и в production:

```bash
npm run build
npm start -- --hostname 127.0.0.1 --port 3100
```

Во втором терминале запускается туннель:

```bash
cloudflared tunnel \
  --config "$HOME/.cloudflared/abrikosoff-academy-local.yml" \
  run abrikosoff-academy-local
```

Для фонового запуска в macOS можно использовать отдельную сессию `screen`:

```bash
screen -dmS academy-abrikosoff-local /bin/zsh -lc \
  'cd <PROJECT_DIR> && exec npm start -- --hostname 127.0.0.1 --port 3100'

screen -dmS academy-abrikosoff-tunnel \
  cloudflared tunnel \
    --config "$HOME/.cloudflared/abrikosoff-academy-local.yml" \
    run abrikosoff-academy-local
```

## 4. Проверка

```bash
curl --fail --silent --show-error \
  https://academy-dev.abrikosoff.com/api/health
```

Ответ должен содержать `"status":"ok"`. После этого проверяются начало входа
через Telegram и возврат на точный Redirect URI.

Состояние фоновых процессов:

```bash
screen -ls
```

После завершения приёмочной сессии останавливаются оба процесса:

```bash
screen -S academy-abrikosoff-local -X quit
screen -S academy-abrikosoff-tunnel -X quit
```

## 5. Диагностика

- `502 Bad Gateway` означает, что туннель работает, но приложение не слушает
  `127.0.0.1:3100`.
- Ошибка DNS означает, что маршрут
  `academy-dev.abrikosoff.com` не создан или ещё не распространился.
- Возврат Telegram на страницу входа означает, что `Origin`, Redirect URI и
  переменные локального приложения нужно сравнить посимвольно.
- Сообщение «Вход через Telegram ещё не настроен» означает, что Client ID,
  Client Secret или Redirect URI отсутствует либо не прошёл проверку формата.
- Туннель не заменяет локальный сервер: после перезагрузки компьютера оба
  процесса нужно запустить снова либо оформить как пользовательские службы.
