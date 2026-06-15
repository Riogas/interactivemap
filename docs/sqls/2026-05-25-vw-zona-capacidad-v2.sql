-- ============================================================
-- Migration: Recrear vw_zona_capacidad v2 — excluir inactivos
-- Fecha: 2026-05-25
-- PR: fix/cap-entrega-excluir-moviles-inactivos
-- ============================================================
--
-- PROBLEMA:
--   La vista original (2026-05-22-vw-zona-capacidad.sql) no filtraba
--   móviles inactivos. Un móvil con estado_nro IN (3, 5, 15) seguía
--   apareciendo en la capacidad total y en el detalle del endpoint.
--
--   Caso reproducible: zona 79, móvil #778 con estado_nro=3 aparecía
--   en MÓVILES EN PRIORIDAD con aporte 4.
--
-- CAMBIO:
--   Se agrega INNER JOIN moviles m ON m.nro = zce.movil
--   con condición WHERE m.estado_nro NOT IN (3, 5, 15).
--
--   Los estados inactivos {3, 5, 15} están hardcodeados por decisión
--   del equipo (sync con MOVIL_ESTADOS_INACTIVOS en lib/movil-estados.ts).
--
-- IDEMPOTENCIA:
--   CREATE OR REPLACE VIEW no requiere DROP previo. El shape de columnas
--   no cambia (mismas columnas, mismos tipos) — queries existentes siguen
--   funcionando sin cambios.
--
-- APLICAR: vía Supabase SQL Editor (manual, sin CLI)
-- ============================================================

CREATE OR REPLACE VIEW vw_zona_capacidad AS
SELECT
  zce.escenario,
  zce.zona,
  zce.emp_fletera_id,
  zce.tipo_servicio,
  SUM(zce.lote_disponible)                                              AS capacidad_total,
  COUNT(DISTINCT zce.movil)                                             AS moviles_count,
  COUNT(DISTINCT zce.movil) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM   moviles_zonas mz
      WHERE  mz.movil_id::int    = zce.movil
        AND  mz.zona_id          = zce.zona
        AND  mz.escenario_id     = zce.escenario
        AND  mz.prioridad_o_transito = 1
    )
  )                                                                     AS moviles_prioridad,
  COUNT(DISTINCT zce.movil) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM   moviles_zonas mz
      WHERE  mz.movil_id::int    = zce.movil
        AND  mz.zona_id          = zce.zona
        AND  mz.escenario_id     = zce.escenario
        AND  mz.prioridad_o_transito != 1
    )
  )                                                                     AS moviles_transito,
  MAX(zce.updated_at)                                                   AS last_sync
FROM zonas_cap_entrega zce
INNER JOIN moviles m
  ON m.nro = zce.movil
WHERE m.estado_nro NOT IN (3, 5, 15)   -- excluir móviles inactivos (sync con lib/movil-estados.ts)
GROUP BY
  zce.escenario,
  zce.zona,
  zce.emp_fletera_id,
  zce.tipo_servicio;

-- ─── Comentario de la vista ───────────────────────────────────────────────────

COMMENT ON VIEW vw_zona_capacidad IS
  'Vista derivada de zonas_cap_entrega. Excluye móviles inactivos (estado_nro IN (3,5,15)). '
  'Consolida capacidad disponible por (escenario, zona, emp_fletera_id, tipo_servicio). '
  'moviles_prioridad/transito usan moviles_zonas.prioridad_o_transito (1=prio, otro=transito). '
  'Solo lectura — nunca escribir directamente. Actualizada por lib/zonas-cap-entrega.ts.';

-- ─── Verificación (ejecutar manualmente post-apply) ───────────────────────────
--
-- -- Verificar que el shape de columnas no cambió:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'vw_zona_capacidad'
-- ORDER BY ordinal_position;
--
-- -- Verificar que los inactivos ya no aparecen (reemplazar 79 con zona real):
-- SELECT * FROM vw_zona_capacidad WHERE zona = 79 ORDER BY tipo_servicio;
--
-- -- Verificar que #778 y #336 ya no cuentan en zona 79:
-- SELECT movil, lote_disponible
-- FROM zonas_cap_entrega zce
-- LEFT JOIN moviles m ON m.nro = zce.movil
-- WHERE zce.zona = 79 AND m.estado_nro IN (3, 5, 15);
-- -- Esperado: 0 rows en la vista, aunque existan en zonas_cap_entrega.
