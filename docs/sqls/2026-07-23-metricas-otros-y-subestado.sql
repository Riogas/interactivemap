-- =====================================================================
-- Métricas de cumplimiento — rename COMUN → OTROS + definición de cumplido
-- Fecha: 2026-07-23 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Dos cambios de esta migración:
--  1) El bucket "resto" pasa a llamarse OTROS (antes COMUN), alineado con
--     capacidad-snapshot. Se relabelan las filas existentes y se cambia el
--     CHECK de tipo_servicio.
--  2) La definición de "cumplido genuino" en el endpoint pasa a exigir
--     estado_nro=2 AND sub_estado_nro=3 (los demás sub_estados eran fruta:
--     cierres en lote, etc.). Ese filtro vive en el código del run; acá NO
--     hay cambio de esquema por eso — pero SÍ hay que re-backfillear para que
--     los hechos viejos que ya no califican se purguen (ver nota al final).
-- =====================================================================

-- 1) Relabel de filas existentes (antes de tocar el CHECK, sino violan la nueva regla).
UPDATE metricas_cumplimiento SET tipo_servicio = 'OTROS' WHERE tipo_servicio = 'COMUN';

-- 2) Swap del CHECK constraint (el nombre autogenerado por Postgres para el
--    CHECK inline de la tabla es <tabla>_<columna>_check).
ALTER TABLE metricas_cumplimiento
  DROP CONSTRAINT IF EXISTS metricas_cumplimiento_tipo_servicio_check;
ALTER TABLE metricas_cumplimiento
  ADD CONSTRAINT metricas_cumplimiento_tipo_servicio_check
  CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','OTROS','SERVICE'));

-- ─── Verificación ─────────────────────────────────────────────────────
-- SELECT tipo_servicio, count(*) FROM metricas_cumplimiento GROUP BY tipo_servicio;
--   → no debe quedar ninguna fila 'COMUN'.
--
-- ─── IMPORTANTE: re-backfill tras deployar el código ──────────────────
-- El nuevo filtro sub_estado_nro=3 achica el conjunto de hechos. La forma
-- limpia de reflejarlo es recomputar desde cero. Opción recomendada:
--
--   TRUNCATE metricas_cumplimiento;
--   -- luego correr el endpoint sobre el rango completo (backfill):
--   -- POST /api/metricas/cumplimiento/run?desde=<hace ~30d>&hasta=<ayer>
--
-- (El run purga por diff de PKs sólo dentro del rango que se le pasa; el
--  TRUNCATE garantiza que no queden hechos viejos fuera de ese rango.)
