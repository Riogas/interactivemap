-- ============================================================
-- Migration: Agregar columna counters_updated_at a la tabla moviles
-- Fecha: 2026-05-12
-- Ticket: diagnóstico de contadores stale (cant_ped/cant_serv/capacidad)
-- ============================================================
--
-- PROPÓSITO:
--   Registrar el último momento en que el helper recomputeMovilCounters
--   actualizó los campos cant_ped / cant_serv / capacidad de un móvil.
--   Los tres campos siempre se actualizan juntos (transacción única),
--   por lo que una sola columna de timestamp es suficiente.
--
--   Permite diagnosticar si el recompute efectivamente corre cuando se
--   ejecutan los endpoints de mutación:
--     SELECT nro, cant_ped, cant_serv, capacidad, counters_updated_at
--     FROM moviles WHERE nro = 24;
--   Si counters_updated_at no cambia tras ejecutar el endpoint → el endpoint
--   no está wired al helper (call-site faltante).
--
-- DECISIÓN DE DISEÑO:
--   Una sola columna (counters_updated_at) en lugar de tres separadas
--   (cant_ped_updated_at, cant_serv_updated_at, capacidad_updated_at)
--   porque los tres campos SIEMPRE se escriben juntos. Tres columnas
--   separadas serían redundantes y no aportan información extra.
--
-- APLICAR: vía Supabase SQL Editor o supabase CLI
-- ============================================================

ALTER TABLE moviles
  ADD COLUMN IF NOT EXISTS counters_updated_at TIMESTAMPTZ;

-- Verificación post-migración (ejecutar manualmente):
-- SELECT nro, cant_ped, cant_serv, capacidad, counters_updated_at
-- FROM moviles
-- ORDER BY counters_updated_at DESC NULLS LAST
-- LIMIT 20;
