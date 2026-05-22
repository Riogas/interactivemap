-- ============================================================
-- Migration: Crear vista vw_zona_capacidad
-- Fecha: 2026-05-22
-- PR: PR1 — Backend zona-capacidad-snapshot
-- ============================================================
--
-- PROPÓSITO:
--   Vista que consolida la capacidad disponible por zona, agrupando
--   las filas de zonas_cap_entrega por (escenario, zona, emp_fletera_id,
--   tipo_servicio). Permite al endpoint GET /api/zonas/capacidad-snapshot
--   obtener la capacidad total de una zona sin recalcular en el cliente.
--
-- COLUMNAS:
--   capacidad_total    = SUM(lote_disponible)       — puede ser negativo
--   moviles_count      = COUNT(DISTINCT movil)       — total móviles en la zona
--   moviles_prioridad  = móviles con prioridad_o_transito = 1
--   moviles_transito   = móviles con prioridad_o_transito != 1
--   last_sync          = MAX(updated_at)             — última actualización
--
-- DIFERENCIA prioridad vs tránsito (de moviles_zonas.prioridad_o_transito):
--   1    → móvil en PRIORIDAD en esa zona
--   ≠1   → móvil en TRÁNSITO en esa zona
--
-- PERFORMANCE:
--   Si hay problemas de performance con el EXISTS correlacionado,
--   materializar la vista y refrescarla por trigger en zonas_cap_entrega.
--   Por ahora se usa vista regular (read-only, segura de crear).
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
GROUP BY
  zce.escenario,
  zce.zona,
  zce.emp_fletera_id,
  zce.tipo_servicio;

-- ─── Comentario de la vista ───────────────────────────────────────────────────

COMMENT ON VIEW vw_zona_capacidad IS
  'Vista derivada de zonas_cap_entrega. '
  'Consolida capacidad disponible (lote_disponible) por (escenario, zona, emp_fletera_id, tipo_servicio). '
  'moviles_prioridad/transito usan moviles_zonas.prioridad_o_transito (1=prio, otro=transito). '
  'Solo lectura — nunca escribir directamente. Actualizada por lib/zonas-cap-entrega.ts.';

-- ─── Verificación (ejecutar manualmente post-apply) ───────────────────────────
--
-- SELECT *
-- FROM vw_zona_capacidad
-- ORDER BY escenario, zona, emp_fletera_id
-- LIMIT 20;
--
-- Debe mostrar filas con capacidad_total, moviles_count,
-- moviles_prioridad + moviles_transito <= moviles_count.
