-- Canal Telegram: bot propio, vinculación de chats de administradores y usuarios de la app
INSERT INTO app_settings(key, value) VALUES ('telegram', '{"enabled":false,"bot_token":"","bot_username":""}') ON CONFLICT (key) DO NOTHING;
UPDATE app_settings SET value = value || '{"admin_telegram":[]}'::jsonb WHERE key='avisos' AND NOT value ? 'admin_telegram';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS notify_telegram BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS telegram_links (
  code        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('admin', 'app_user')),
  ref_id      INTEGER NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
