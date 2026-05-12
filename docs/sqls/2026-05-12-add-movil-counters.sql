-- ============================================================
-- Migration: Agregar contadores cant_ped / cant_serv / capacidad
-- a la tabla moviles
-- Fecha: 2026-05-12
-- Ticket: persistir capacidad por movil en tiempo real
-- ============================================================
--
-- PROPÓSITO:
--   Persistir en cada fila de moviles la cantidad de pedidos
--   pendientes (cant_ped), servicios pendientes (cant_serv) y
--   la suma de ambos (capacidad).
--
-- CRITERIO "PENDIENTE": estado_nro = 1
--   (confirmado en app/dashboard/page.tsx líneas 1624-1627)
--
-- LÓGICA DE ACTUALIZACIÓN:
--   Los campos se actualizan por código TypeScript (Opción A)
--   vía el helper lib/movil-counters.ts, NO por triggers DB.
--   Si en el futuro se agregan endpoints que olvidan llamar
--   al helper, considerar migrar a triggers SQL (Opción B).
--
-- APLICAR: vía Supabase SQL Editor o supabase CLI
-- ============================================================

-- Paso 1: Agregar las 3 columnas (idempotente con IF NOT EXISTS)
ALTER TABLE moviles
  ADD COLUMN IF NOT EXISTS cant_ped  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cant_serv INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capacidad INT NOT NULL DEFAULT 0;

-- Paso 2: Backfill — recalcular para todos los moviles existentes
-- a partir del estado actual de pedidos y services.
-- Usa subqueries correlacionadas por m.nro (identificador numérico
-- que referencia la columna `movil` en pedidos y services).
UPDATE moviles m
SET
  cant_ped = COALESCE((
    SELECT COUNT(*)::INT
    FROM pedidos p
    WHERE p.movil = m.nro
      AND p.estado_nro = 1
  ), 0),
  cant_serv = COALESCE((
    SELECT COUNT(*)::INT
    FROM services s
    WHERE s.movil = m.nro
      AND s.estado_nro = 1
  ), 0),
  capacidad = COALESCE((
    SELECT COUNT(*)::INT
    FROM pedidos p
    WHERE p.movil = m.nro
      AND p.estado_nro = 1
  ), 0)
  +
  COALESCE((
    SELECT COUNT(*)::INT
    FROM services s
    WHERE s.movil = m.nro
      AND s.estado_nro = 1
  ), 0);

-- Verificación post-backfill (ejecutar manualmente para auditar):
-- SELECT nro, cant_ped, cant_serv, capacidad,
--        (cant_ped + cant_serv) AS check_capacidad,
--        CASE WHEN capacidad = cant_ped + cant_serv THEN 'OK' ELSE 'INVARIANT_BROKEN' END AS invariant
-- FROM moviles
-- WHERE cant_ped > 0 OR cant_serv > 0
-- ORDER BY capacidad DESC;
