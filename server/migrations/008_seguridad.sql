-- Doble factor (TOTP o código por WhatsApp) y bloqueo tras intentos fallidos
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_pending text;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
INSERT INTO app_settings(key, value) VALUES ('seguridad', '{"max_attempts": 5, "lock_minutes": 15, "require_2fa_admins": false}') ON CONFLICT DO NOTHING;
