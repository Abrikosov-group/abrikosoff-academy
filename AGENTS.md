<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Правила проекта

- Пользовательские тексты и документацию пиши на русском языке.
- Сохраняй архитектуру модульного монолита. Не добавляй микросервисы без отдельного архитектурного решения.
- Деньги храни целым числом в минимальных единицах валюты; не используй числа с плавающей точкой.
- Все входящие события платежей обрабатывай идемпотентно и сохраняй их внешний идентификатор.
- Сроки доступа и даты в базе храни в UTC.
- Не записывай в журналы пароли, токены, платёжные данные и персональные данные учеников.
- Не публикуй порты PostgreSQL, Redis и внутренних сервисов в production.
- Перед коммитом запускай `npm run check` и `npm run audit:production`.
- Секреты храни только в переменных окружения; файлы `.env` не добавляй в Git.
