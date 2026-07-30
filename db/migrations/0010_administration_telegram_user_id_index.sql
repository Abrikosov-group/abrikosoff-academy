CREATE INDEX IF NOT EXISTS identity_methods_telegram_user_id_idx
  ON identity_methods ((metadata ->> 'telegramUserId'))
  WHERE method_type = 'telegram' AND metadata ? 'telegramUserId';
