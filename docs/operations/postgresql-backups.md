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

После успешной локальной проверки отдельный systemd-сервис:

1. сверяет локальный архив с `last-success`;
2. шифрует его публичным ключом `age`;
3. загружает шифротекст в закрытый Yandex Object Storage;
4. передаёт обязательный `Content-MD5`;
5. проверяет размер, SHA-256 и строгую блокировку `COMPLIANCE`;
6. скачивает созданную версию объекта и повторно сверяет SHA-256.

Закрытый ключ расшифрования на production-сервер не передаётся.

## Расписание и хранение

- запуск: ежедневно в 03:15 по Москве;
- случайная задержка: до 15 минут, чтобы избежать одновременной фоновой нагрузки;
- пропущенный запуск выполняется после следующего включения сервера;
- локальное хранение: 14 суток;
- каталог: `/opt/academy/backups/postgres`;
- архивы и контрольные суммы доступны только пользователю `deploy`.
- внешний бакет: `abrikosoff-academy-backups-prod-2026`;
- блокировка каждой внешней версии: `COMPLIANCE`, 35 суток;
- правило `postgres-retention-45d` для префикса `postgres/`: текущая версия
  становится нетекущей через 45 суток, а нетекущая версия удаляется ещё через
  7 суток;
- незавершённые составные загрузки с префиксом `postgres/` удаляются через
  7 суток;
- правило `postgres-delete-markers` удаляет маркеры, у которых больше нет
  нетекущих версий;
- лимит бакета: 50 ГБ;
- бюджет облака: 300 ₽ в месяц с порогами 50%, 80% и 100%.

При штатной ежедневной загрузке зашифрованная копия физически хранится около
52 суток. Жизненный цикл обрабатывается Yandex Object Storage раз в сутки,
поэтому фактическое удаление может произойти на несколько часов позже.
Строгая блокировка заканчивается раньше первого действия жизненного цикла и
сохраняет десятисуточный запас между обязательным и плановым сроками хранения.

Таймер работает независимо от GitHub Actions.

## Проверка состояния

```bash
sudo systemctl status academy-postgres-backup.timer
sudo systemctl status academy-postgres-backup.service
sudo systemctl status academy-postgres-offsite-backup.service
sudo journalctl -u academy-postgres-backup.service --since today
sudo journalctl -u academy-postgres-offsite-backup.service --since today
sudo cat /opt/academy/backups/postgres/last-success
sudo cat /opt/academy/backups/postgres/last-offsite-success
```

Проверка последнего архива:

```bash
cd /opt/academy/backups/postgres
sha256sum --check latest.dump.sha256
```

`last-success` должен содержать `restore_verified=true`.
`last-offsite-success` должен содержать `download_verified=true` и
`object_lock_mode=COMPLIANCE`.

## Ручной запуск

```bash
sudo systemctl start academy-postgres-backup.service
sudo systemctl status academy-postgres-backup.service
sudo systemctl status academy-postgres-offsite-backup.service
```

Локальный и внешний сценарии используют отдельные блокировки и не запускают
две одинаковые операции одновременно. Сбой внешнего хранилища не отменяет уже
созданную и проверенную локальную копию.

## Установка на сервер

Версионируемые исходники:

- `deploy/server/academy-postgres-backup`;
- `deploy/server/academy-postgres-offsite-backup`;
- `deploy/systemd/academy-postgres-backup.service`;
- `deploy/systemd/academy-postgres-offsite-backup.service`;
- `deploy/systemd/academy-postgres-backup.timer`.

На сервере они устанавливаются как root-owned файлы:

```text
/usr/local/sbin/academy-postgres-backup
/usr/local/sbin/academy-postgres-offsite-backup
/etc/systemd/system/academy-postgres-backup.service
/etc/systemd/system/academy-postgres-offsite-backup.service
/etc/systemd/system/academy-postgres-backup.timer
```

После изменения unit-файлов необходимо выполнить `systemctl daemon-reload`.

Неверсионируемые настройки внешней копии находятся только на сервере:

```text
/etc/academy-backup/age-recipient
/etc/academy-backup/aws-access-key-id
/etc/academy-backup/aws-secret-access-key
```

Оба файла статического ключа принадлежат `root:root` и имеют права `0600`.
Systemd передаёт их процессу через временный каталог credentials. В журнал и
переменные GitHub Actions значения не попадают.

Каталог `/etc/academy-backup` имеет права `0711`: пользователь сервиса может
прочитать публичный `age-recipient`, но не может прочитать файлы статического
ключа. На сервере установлены `age` из репозитория Ubuntu и официальный AWS CLI
v2 для S3-совместимого API.

## Ключ восстановления

Закрытый ключ хранится на рабочем Mac:

```text
~/.config/abrikosoff-academy/backup-recovery.agekey
```

Права файла — `0600`, права каталога — `0700`. Необходимо сохранить ещё одну
копию этого файла в менеджере паролей или на отдельном зашифрованном носителе.
Без закрытого ключа содержимое внешних копий расшифровать невозможно.

## Восстановление из внешней копии

1. В Yandex Cloud выбрать нужную версию объекта из бакета
   `abrikosoff-academy-backups-prod-2026`.
2. Скачать файл `*.dump.age` на доверенный компьютер.
3. Расшифровать архив:

   ```bash
   age \
     --decrypt \
     --identity \
       ~/.config/abrikosoff-academy/backup-recovery.agekey \
     --output academy-recovered.dump \
     academy-*.dump.age
   ```

4. Проверить структуру и восстановить в отдельную базу:

   ```bash
   pg_restore --list academy-recovered.dump >/dev/null
   createdb academy_recovery_test
   pg_restore \
     --exit-on-error \
     --single-transaction \
     --no-owner \
     --no-privileges \
     --dbname academy_recovery_test \
     academy-recovered.dump
   ```

5. Выполнить прикладные проверки данных и только после них использовать
   восстановленную базу.
