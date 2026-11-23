-- Auditoría de seguridad (2026-11):
-- 1) Sesiones del panel revocables: se invalidan los tokens emitidos antes de esta fecha
--    (al restablecer la contraseña, deshabilitar el usuario, cambiarle el rol o quitarle el doble factor).
ALTER TABLE admins ADD COLUMN IF NOT EXISTS tokens_valid_after timestamptz;
-- 2) Contraseña propia por cargador (OCPP Security Profile 1/2, HTTP Basic). Se guarda solo el hash.
ALTER TABLE chargers ADD COLUMN IF NOT EXISTS ocpp_password_hash text;
ALTER TABLE chargers ADD COLUMN IF NOT EXISTS ocpp_password_set_at timestamptz;
-- 3) Pagos devueltos o con contracargo: se revierte la recarga
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversal_movement_id integer REFERENCES movements(id);
