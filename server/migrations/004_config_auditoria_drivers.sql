-- Usuarios del panel con roles, catálogo de cargadores compatibles (drivers) y auditoría

ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'operador', 'lectura'));
ALTER TABLE admins ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Un "driver" describe un modelo de cargador: cómo detectarlo y qué configuración OCPP aplicarle
CREATE TABLE IF NOT EXISTS charger_models (
  id               SERIAL PRIMARY KEY,
  vendor           TEXT NOT NULL,                       -- chargePointVendor que informa el equipo
  model_pattern    TEXT NOT NULL DEFAULT '*',           -- chargePointModel; admite * como comodín
  name             TEXT NOT NULL,
  ocpp_version     TEXT NOT NULL DEFAULT '1.6J',
  max_kw           NUMERIC(6,1),
  phases           INTEGER,
  connectors       INTEGER NOT NULL DEFAULT 1,
  connector_type   TEXT NOT NULL DEFAULT 'Tipo 2',
  rfid             BOOLEAN NOT NULL DEFAULT true,
  smart_charging   BOOLEAN NOT NULL DEFAULT true,
  local_list       BOOLEAN NOT NULL DEFAULT true,
  remote_start     BOOLEAN NOT NULL DEFAULT true,
  ute_approved     BOOLEAN NOT NULL DEFAULT false,
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- claves de ChangeConfiguration a aplicar al conectarse
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chargers ADD COLUMN IF NOT EXISTS model_id INTEGER REFERENCES charger_models(id) ON DELETE SET NULL;
ALTER TABLE chargers ADD COLUMN IF NOT EXISTS config_applied_at TIMESTAMPTZ;
ALTER TABLE chargers ADD COLUMN IF NOT EXISTS config_result JSONB;

INSERT INTO charger_models (vendor, model_pattern, name, notes, config)
SELECT '*', '*', 'Genérico OCPP 1.6J',
       'Perfil por defecto para cualquier equipo OCPP 1.6J que no tenga un driver propio.',
       '{"MeterValueSampleInterval":"30","MeterValuesSampledData":"Energy.Active.Import.Register,Power.Active.Import","StopTxnSampledData":"Energy.Active.Import.Register","AuthorizeRemoteTxRequests":"false","LocalPreAuthorize":"true","LocalAuthListEnabled":"true","HeartbeatInterval":"300"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM charger_models);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type  TEXT NOT NULL DEFAULT 'admin',   -- admin | app | sistema
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT NOT NULL,                   -- crear | editar | eliminar | ingreso | ingreso_fallido | comando | ...
  entity      TEXT,
  entity_id   TEXT,
  summary     TEXT NOT NULL,
  data        JSONB,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id);
