-- Facturación electrónica (CFE de DGI): datos fiscales de las cuentas y comprobantes mensuales
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'CI' CHECK (doc_type IN ('CI', 'RUT', 'otro'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS doc_number TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS billing_email TEXT;

CREATE TABLE IF NOT EXISTS invoices (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  period          TEXT NOT NULL,                       -- AAAA-MM
  cfe_type        TEXT NOT NULL,                       -- e-Ticket (CI) | e-Factura (RUT)
  status          TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'emitida', 'anulada', 'error')),
  currency        TEXT NOT NULL DEFAULT 'UYU',
  net             NUMERIC(12,2) NOT NULL,
  iva             NUMERIC(12,2) NOT NULL,
  total           NUMERIC(12,2) NOT NULL,
  iva_rate        NUMERIC(5,2) NOT NULL,
  lines           JSONB NOT NULL,
  receiver        JSONB NOT NULL,
  series          TEXT,
  number          TEXT,
  issued_at       TIMESTAMPTZ,
  provider_ref    TEXT,
  provider_msg    TEXT,
  pdf_url         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_period ON invoices (account_id, period) WHERE status <> 'anulada';

INSERT INTO app_settings(key, value) VALUES
  ('facturacion', '{"iva_rate":22,"prices_include_iva":true,"emisor_rut":"","emisor_nombre":"","emisor_domicilio":"","provider":"ninguno","provider_url":"","provider_token":""}')
ON CONFLICT (key) DO NOTHING;
