-- =====================================================================
-- Métricas de cumplimiento — buckets (OTROS + ESPECIAL) + definición de cumplido
-- Fecha: 2026-07-23 (rev. 2026-07-24) | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Cambios cubiertos por esta migración:
--  1) El bucket "resto" pasa de COMUN a OTROS, y se separa ESPECIAL en su
--     propio bucket (servicio_nombre que empieza con 'ESPECIAL'). tipo_servicio
--     válidos: URGENTE / NOCTURNO / ESPECIAL / OTROS / SERVICE.
--  2) La definición de "cumplido genuino" en el endpoint pasa a exigir
--     estado_nro=2 AND sub_estado_nro=3 (los demás sub_estados eran fruta:
--     cierres en lote, etc.). Ese filtro vive en el código del run; acá NO
--     hay cambio de esquema por eso — pero SÍ hay que re-backfillear.
--
-- ORDEN IMPORTANTE: primero se saca el CHECK viejo, DESPUÉS se relabela. El
-- CHECK viejo sólo permite 'COMUN', así que si se hiciera el UPDATE a 'OTROS'
-- con el constraint viejo puesto, el propio UPDATE lo violaría y abortaría.
-- =====================================================================

-- 1) Sacar el CHECK viejo primero (el nombre autogenerado por Postgres para el
--    CHECK inline de la tabla es <tabla>_<columna>_check).
ALTER TABLE metricas_cumplimiento
  DROP CONSTRAINT IF EXISTS metricas_cumplimiento_tipo_servicio_check;

-- 2) Relabel de filas existentes COMUN → OTROS (ya sin constraint que lo bloquee).
--    (Los ESPECIAL nuevos salen del re-backfill; este UPDATE es sólo para el
--     histórico previo que estaba etiquetado como COMUN.)
UPDATE metricas_cumplimiento SET tipo_servicio = 'OTROS' WHERE tipo_servicio = 'COMUN';

-- 3) Poner el CHECK nuevo con los 5 buckets.
ALTER TABLE metricas_cumplimiento
  ADD CONSTRAINT metricas_cumplimiento_tipo_servicio_check
  CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','ESPECIAL','OTROS','SERVICE'));

-- ─── Verificación ─────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'metricas_cumplimiento'::regclass AND contype = 'c';
--   → la definición debe incluir 'ESPECIAL' y 'OTROS'.
-- SELECT tipo_servicio, count(*) FROM metricas_cumplimiento GROUP BY tipo_servicio;
--   → no debe quedar ninguna fila 'COMUN'.
--
-- ─── IMPORTANTE: re-backfill tras deployar el código ──────────────────
-- El nuevo filtro sub_estado_nro=3 achica el conjunto y la separación de
-- ESPECIAL requiere el código nuevo. Recomputar desde cero:
--
--   TRUNCATE metricas_cumplimiento;
--   -- luego correr el endpoint sobre el rango completo (backfill):
--   -- POST /api/metricas/cumplimiento/run?desde=<hace ~30d>&hasta=<ayer>
--
-- (El run purga por diff de PKs sólo dentro del rango que se le pasa; el
--  TRUNCATE garantiza que no queden hechos viejos fuera de ese rango.)
