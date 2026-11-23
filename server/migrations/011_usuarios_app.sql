-- Gestión de usuarios de la app: último ingreso y cierre de sesiones desde el panel
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS audit_log_actor ON audit_log (actor_type, actor_id);
