-- App de usuario, reservas, alertas y pagos online

ALTER TABLE accounts ADD COLUMN invite_code TEXT UNIQUE;  -- código para que los residentes se unan a la cuenta desde la app

CREATE TABLE app_users (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cards ADD COLUMN app_user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE; -- tarjeta virtual de la app

CREATE TABLE reservations (
  id          SERIAL PRIMARY KEY,
  charger_id  TEXT NOT NULL REFERENCES chargers(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  app_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX reservations_charger_idx ON reservations(charger_id, starts_at);

CREATE TABLE alerts (
  id          SERIAL PRIMARY KEY,
  charger_id  TEXT REFERENCES chargers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- offline | faulted | stuck_session
  message     TEXT NOT NULL,
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notified    BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX alerts_open_uniq ON alerts(charger_id, kind) WHERE resolved_at IS NULL;

CREATE TABLE payments (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  app_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  provider     TEXT NOT NULL DEFAULT 'mercadopago',
  amount       NUMERIC(12,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'UYU',
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  external_id  TEXT,                            -- id de pago del proveedor
  preference_id TEXT,
  movement_id  INTEGER REFERENCES movements(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_external_uniq ON payments(provider, external_id) WHERE external_id IS NOT NULL;
