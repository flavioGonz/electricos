-- Esquema inicial de la plataforma de carga

CREATE TABLE admins (
  id           SERIAL PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tarifa: precio por kWh con franja valle opcional, cargo fijo por sesión
CREATE TABLE tariffs (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'UYU',
  price_kwh           NUMERIC(12,4) NOT NULL,          -- precio normal por kWh
  offpeak_price_kwh   NUMERIC(12,4),                   -- precio en franja valle (opcional)
  offpeak_start_hour  SMALLINT CHECK (offpeak_start_hour BETWEEN 0 AND 23),
  offpeak_end_hour    SMALLINT CHECK (offpeak_end_hour BETWEEN 0 AND 23),
  session_fee         NUMERIC(12,4) NOT NULL DEFAULT 0, -- cargo fijo por sesión
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sitio: edificio o barrio
CREATE TABLE sites (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'edificio' CHECK (kind IN ('edificio','barrio','otro')),
  address     TEXT NOT NULL DEFAULT '',
  max_amps    INTEGER,                                  -- límite total para gestión de potencia (A por fase), NULL = sin límite
  tariff_id   INTEGER REFERENCES tariffs(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chargers (
  id              TEXT PRIMARY KEY,                     -- identidad OCPP (último segmento de la URL)
  site_id         INTEGER REFERENCES sites(id),
  name            TEXT NOT NULL DEFAULT '',
  approved        BOOLEAN NOT NULL DEFAULT false,
  vendor          TEXT,
  model           TEXT,
  serial          TEXT,
  firmware        TEXT,
  max_amps        INTEGER NOT NULL DEFAULT 32,
  owner_account_id INTEGER,                             -- si está asignado a una cochera: solo esa cuenta puede usarlo
  connected       BOOLEAN NOT NULL DEFAULT false,
  last_seen       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connectors (
  charger_id   TEXT NOT NULL REFERENCES chargers(id) ON DELETE CASCADE,
  connector_id INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Unknown',
  error_code   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (charger_id, connector_id)
);

-- Cuenta: unidad del edificio, familia, empresa
CREATE TABLE accounts (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER REFERENCES sites(id),
  name         TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT '',               -- ej. "Apto 302"
  email        TEXT,
  phone        TEXT,
  billing_mode TEXT NOT NULL DEFAULT 'postpaid' CHECK (billing_mode IN ('postpaid','prepaid')),
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,       -- prepago: saldo negativo permitido
  tariff_id    INTEGER REFERENCES tariffs(id),         -- sobreescribe la tarifa del sitio
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chargers ADD CONSTRAINT chargers_owner_fk FOREIGN KEY (owner_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- Tarjeta RFID (idTag OCPP)
CREATE TABLE cards (
  id_tag      TEXT PRIMARY KEY,                       -- UID de la tarjeta, normalizado en mayúsculas
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id              SERIAL PRIMARY KEY,                 -- transactionId OCPP
  charger_id      TEXT NOT NULL REFERENCES chargers(id),
  connector_id    INTEGER NOT NULL,
  id_tag          TEXT NOT NULL,
  account_id      INTEGER REFERENCES accounts(id),
  tariff_id       INTEGER REFERENCES tariffs(id),
  started_at      TIMESTAMPTZ NOT NULL,
  stopped_at      TIMESTAMPTZ,
  meter_start_wh  BIGINT NOT NULL,
  meter_stop_wh   BIGINT,
  last_meter_wh   BIGINT,
  power_w         INTEGER,
  stop_reason     TEXT,
  energy_wh       BIGINT,
  amount          NUMERIC(12,2),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions(account_id, started_at);
CREATE INDEX sessions_charger_idx ON sessions(charger_id, started_at);

-- Lecturas de energía acumulada (para valorizar por franja y graficar)
CREATE TABLE meter_values (
  id          BIGSERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL,
  energy_wh   BIGINT,
  power_w     INTEGER
);
CREATE INDEX meter_values_session_idx ON meter_values(session_id, ts);

-- Libro de movimientos de cuenta: cargos (negativos), pagos y ajustes
CREATE TABLE movements (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('charge','payment','adjustment')),
  amount      NUMERIC(12,2) NOT NULL,                 -- negativo = consumo, positivo = pago/crédito
  description TEXT NOT NULL DEFAULT '',
  session_id  INTEGER REFERENCES sessions(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX movements_account_idx ON movements(account_id, created_at);

-- Registro de mensajes OCPP (diagnóstico)
CREATE TABLE ocpp_log (
  id          BIGSERIAL PRIMARY KEY,
  charger_id  TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  action      TEXT NOT NULL,
  payload     JSONB,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ocpp_log_charger_idx ON ocpp_log(charger_id, ts DESC);
