# Резервные копии PostgreSQL

## Что настроено

Сервер ежедневно создаёт логическую резервную копию базы `academy` в custom
формате PostgreSQL. После каждого `pg_dump` система:

1. проверяет структуру архива через `pg_restore --list`;
2. создаёт отдельную временную базу из `template0`;
3. полностью восстанавливает архив одной транзакцией;
4. сравнивает количество пользовательских объектов;
5. выполняет контрольный SQL-запрос;
6. удаляет временную базу;
7. рассчитывает SHA-256 и только после проверки публикует архив как успешный.

Непроверенный или частично записанный файл не получает итоговое имя.

## Расписание и хранение

- запуск: ежедневно в 03:15 по Москве;
- случайная задержка: до 15 минут, чтобы избежать одновременной фоновой нагрузки;
- пропущенный запуск выполняется после следующего включения сервера;
- локальное хранение: 14 суток;
- каталог: `/opt/academy/backups/postgres`;
- архивы и контрольные суммы доступны только пользователю `deploy`.

Таймер работает независимо от GitHub Actions.

## Проверка состояния

```bash
sudo systemctl status academy-postgres-backup.timer
sudo systemctl status academy-postgres-backup.service
sudo journalctl -u academy-postgres-backup.service --since today
sudo cat /opt/academy/backups/postgres/last-success
```

Проверка последнего архива:

```bash
cd /opt/academy/backups/postgres
sha256sum --check latest.dump.sha256
```

`last-success` должен содержать `restore_verified=true`.

## Ручной запуск

```bash
sudo systemctl start academy-postgres-backup.service
sudo systemctl status academy-postgres-backup.service
```

Сценарий использует блокировку и не запускает две копии одновременно.

## Установка на сервер

Версионируемые исходники:

- `deploy/server/academy-postgres-backup`;
- `deploy/systemd/academy-postgres-backup.service`;
- `deploy/systemd/academy-postgres-backup.timer`.

На сервере они устанавливаются как root-owned файлы:

```text
/usr/local/sbin/academy-postgres-backup
/etc/systemd/system/academy-postgres-backup.service
/etc/systemd/system/academy-postgres-backup.timer
```

После изменения unit-файлов необходимо выполнить `systemctl daemon-reload`.

## Внешняя копия

Текущий уровень защищает от ошибок приложения и повреждения основной базы, но
архивы находятся на диске того же сервера. Для защиты от потери самого сервера
следующим уровнем добавляется зашифрованная выгрузка в отдельное объектное
хранилище с независимыми реквизитами доступа.
