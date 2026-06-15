-- Migration: agregar empresa_fletera_id a gps_latest_positions
-- Fecha: 2026-05-18
-- Motivo: permitir filtrado server-side en canal Realtime GPS por empresa
-- El usuario aplica esta migration MANUAL en Supabase SQL Editor.
-- Es idempotente: puede correrse N veces sin error.

-- 1) Agregar columna
ALTER TABLE gps_latest_positions
  ADD COLUMN IF NOT EXISTS empresa_fletera_id INTEGER;

-- 2) Backfill desde moviles
UPDATE gps_latest_positions g
SET empresa_fletera_id = m.empresa_fletera_id
FROM moviles m
WHERE m.id::TEXT = g.movil_id AND g.empresa_fletera_id IS NULL;

-- 3) Trigger para mantener la columna sincronizada en cada INSERT/UPDATE
CREATE OR REPLACE FUNCTION gps_latest_set_empresa_fletera()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.movil_id IS NOT NULL AND NEW.empresa_fletera_id IS NULL THEN
    SELECT empresa_fletera_id INTO NEW.empresa_fletera_id
    FROM moviles WHERE id::TEXT = NEW.movil_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gps_latest_set_empresa_fletera ON gps_latest_positions;
CREATE TRIGGER trg_gps_latest_set_empresa_fletera
  BEFORE INSERT OR UPDATE ON gps_latest_positions
  FOR EACH ROW EXECUTE FUNCTION gps_latest_set_empresa_fletera();

-- 4) Indice para que el filter de Realtime sea rapido
CREATE INDEX IF NOT EXISTS idx_gps_latest_empresa_fletera
  ON gps_latest_positions (empresa_fletera_id);
