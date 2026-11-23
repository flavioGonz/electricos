-- Reparto de potencia dinámico por sitio
ALTER TABLE sites ADD COLUMN IF NOT EXISTS phases INTEGER NOT NULL DEFAULT 3 CHECK (phases IN (1, 3));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS voltage INTEGER NOT NULL DEFAULT 230;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS contracted_kw NUMERIC(7,1);      -- potencia contratada con UTE para los cargadores
ALTER TABLE sites ADD COLUMN IF NOT EXISTS punta_kw NUMERIC(7,1);           -- límite opcional más bajo en horario punta
ALTER TABLE sites ADD COLUMN IF NOT EXISTS power_strategy TEXT NOT NULL DEFAULT 'igual' CHECK (power_strategy IN ('igual', 'llegada'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS limit_amps NUMERIC(5,1);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS limit_at TIMESTAMPTZ;
-- Los sitios que ya tenían límite en amperes pasan a kW (trifásico 230 V)
UPDATE sites SET contracted_kw = round(max_amps * 230 * 3 / 1000.0, 1) WHERE contracted_kw IS NULL AND max_amps IS NOT NULL;
