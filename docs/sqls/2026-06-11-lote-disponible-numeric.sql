-- ============================================================
-- Migración: zonas_cap_entrega.lote_disponible  INT -> NUMERIC
--
-- Motivo (CapEntrega.docx 2026-06-11): el prorrateo de capacidad
-- pasa a ser PONDERADO:
--   aporte(zona) = (lote_libre / Σpesos) * peso_zona
--   peso prioridad = 1 ; peso transito = peso_transito_alpha
-- Con esta fórmula el aporte puede ser NO entero (ej. 1.7143),
-- por lo que la columna debe permitir decimales.
--
-- NOTA: la vista vw_zona_capacidad depende de lote_disponible, así que
-- Postgres no deja alterar el tipo con la vista viva. Solución:
--   1. DROP VIEW vw_zona_capacidad
--   2. ALTER COLUMN ... TYPE NUMERIC(12,4)
--   3. CREATE VIEW vw_zona_capacidad (idéntica a v2 2026-05-25)
--
-- Idempotente: el ALTER solo corre si el tipo actual no es numeric.
-- Correr una sola vez en Supabase self-hosted (SQL Editor).
-- ============================================================

-- 1. Soltar la vista que depende de la columna.
DROP VIEW IF EXISTS vw_zona_capacidad;

-- 2. Alterar el tipo de la columna (idempotente).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'zonas_cap_entrega'
      AND column_name  = 'lote_disponible'
      AND data_type    <> 'numeric'
  ) THEN
    ALTER TABLE public.zonas_cap_entrega
      ALTER COLUMN lote_disponible TYPE NUMERIC(12,4)
      USING lote_disponible::NUMERIC(12,4);
  END IF;
END $$;

-- 3. Recrear la vista v2 (idéntica a docs/sqls/2026-05-25-vw-zona-capacidad-v2.sql).
CREATE VIEW vw_zona_capacidad AS
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

COMMENT ON VIEW vw_zona_capacidad IS
  'Vista derivada de zonas_cap_entrega. Excluye móviles inactivos (estado_nro IN (3,5,15)). '
  'Consolida capacidad disponible por (escenario, zona, emp_fletera_id, tipo_servicio). '
  'moviles_prioridad/transito usan moviles_zonas.prioridad_o_transito (1=prio, otro=transito). '
  'Solo lectura — nunca escribir directamente. Actualizada por lib/zonas-cap-entrega.ts.';
