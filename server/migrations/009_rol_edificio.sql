-- Usuarios de la administración del edificio: solo lectura y solo de sus sitios
ALTER TABLE admins ADD COLUMN IF NOT EXISTS site_ids int[];
DO $$ BEGIN
  ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('admin', 'operador', 'lectura', 'edificio'));
