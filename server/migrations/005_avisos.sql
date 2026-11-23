-- Configuración general (WhatsApp, correo, avisos) y registro de avisos enviados
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings(key, value) VALUES
  ('whatsapp', '{"enabled":false,"url":"http://192.168.99.22:2785","session":"","api_key":""}'),
  ('email', '{"enabled":false,"host":"smtp.gmail.com","port":587,"secure":false,"user":"","pass":"","from":"Eléctricos Infratec <no-replay@infratec.com.uy>"}'),
  ('avisos', '{"fin_carga":true,"saldo_bajo":true,"saldo_bajo_umbral":200,"alertas":true,"respaldo":true,"admin_whatsapp":[],"admin_email":[]}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel     TEXT NOT NULL,            -- whatsapp | email
  to_addr     TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- fin_carga | saldo_bajo | alerta | respaldo | prueba | codigo
  subject     TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendiente',  -- enviado | error | omitido
  error       TEXT,
  ref         TEXT
);
CREATE INDEX IF NOT EXISTS notifications_at ON notifications (at DESC);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS notify_whatsapp BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS low_balance_notified_at TIMESTAMPTZ;
