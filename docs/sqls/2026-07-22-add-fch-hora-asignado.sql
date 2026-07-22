-- =====================================================================
-- Métricas de cumplimiento — Columna fch_hora_asignado
-- Fecha: 2026-07-22
-- Idempotente. Aplicar en: Supabase SQL Editor.
-- =====================================================================
ALTER TABLE pedidos  ADD COLUMN IF NOT EXISTS fch_hora_asignado timestamptz NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS fch_hora_asignado timestamptz NULL;

COMMENT ON COLUMN pedidos.fch_hora_asignado  IS
  'Instante de asignación al móvil (origen Firestore FchHoraAsignado). NULL hasta que el sender lo emita; mientras tanto la demora se deriva de demora_movil_desde_asignacion_mins.';
COMMENT ON COLUMN services.fch_hora_asignado IS
  'Instante de asignación al móvil. Ver comentario homónimo en pedidos.';

-- ─── Verificación (correr post-apply) ─────────────────────────────────
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE column_name = 'fch_hora_asignado' AND table_name IN ('pedidos','services');
-- Esperado: 2 filas, data_type = 'timestamp with time zone', is_nullable = 'YES'.
