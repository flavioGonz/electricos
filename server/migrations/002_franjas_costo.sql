-- Tarifa por franjas UTE (punta / llano / valle) con costo de energía + margen,
-- y separación del importe entre costo de energía (para el dueño de la línea) y margen (para el operador).

ALTER TABLE tariffs
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'simple' CHECK (mode IN ('simple','franjas')),
  ADD COLUMN energy_cost_kwh NUMERIC(12,4),                 -- modo simple: costo UTE por kWh (opcional)
  ADD COLUMN punta_start_hour SMALLINT CHECK (punta_start_hour BETWEEN 0 AND 23),
  ADD COLUMN punta_end_hour   SMALLINT CHECK (punta_end_hour BETWEEN 0 AND 23),
  ADD COLUMN valle_start_hour SMALLINT CHECK (valle_start_hour BETWEEN 0 AND 23),
  ADD COLUMN valle_end_hour   SMALLINT CHECK (valle_end_hour BETWEEN 0 AND 23),
  ADD COLUMN punta_weekdays_only BOOLEAN NOT NULL DEFAULT true, -- fines de semana la punta se cobra como llano
  ADD COLUMN cost_punta NUMERIC(12,4), ADD COLUMN cost_llano NUMERIC(12,4), ADD COLUMN cost_valle NUMERIC(12,4),
  ADD COLUMN margin_punta NUMERIC(12,4), ADD COLUMN margin_llano NUMERIC(12,4), ADD COLUMN margin_valle NUMERIC(12,4);

ALTER TABLE tariffs ALTER COLUMN price_kwh DROP NOT NULL;

ALTER TABLE sites
  ADD COLUMN line_owner TEXT NOT NULL DEFAULT 'cliente' CHECK (line_owner IN ('cliente','operador')), -- de quién es el suministro UTE
  ADD COLUMN owner_name TEXT NOT NULL DEFAULT '',          -- a quién se le liquida la energía (consorcio, propietario)
  ADD COLUMN owner_contact TEXT NOT NULL DEFAULT '';

ALTER TABLE sessions
  ADD COLUMN energy_cost NUMERIC(12,2),                    -- parte del importe que es costo de energía
  ADD COLUMN margin NUMERIC(12,2),                         -- parte que es margen del operador
  ADD COLUMN breakdown JSONB;                              -- kWh e importe por franja
