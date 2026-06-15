-- ===========================================================================
-- MIGRATION: 2026-06-09-perf-indexes-empresa-fch.sql
-- Objetivo: Mejorar performance de queries filtradas por empresa_fletera_id
--           + fecha en tablas pedidos y services.
--
-- Contexto: El dashboard para usuarios supervisor (no-root) aplica un filtro
-- empresa_fletera_id IN (...) combinado con fch_para = hoy. Sin índice compuesto,
-- PostgreSQL usa los índices individuales (idx_pedidos_empresa + idx_pedidos_fch_para)
-- con merge bitmap scan, que es significativamente más lento que un índice compuesto.
--
-- Impacto esperado: reducción de latencia de /api/pedidos y /api/services
-- para usuarios no-root de ~2-5x en tablas con >10k registros.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PEDIDOS
-- ---------------------------------------------------------------------------

-- Índice compuesto para el query principal del dashboard de supervisor:
-- WHERE escenario = X AND empresa_fletera_id IN (...) AND fch_para = 'YYYY-MM-DD'
-- Orden: escenario primero (alta selectividad), luego empresa, luego fecha.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_escenario_empresa_fchpara
  ON pedidos (escenario, empresa_fletera_id, fch_para);

-- Índice compuesto para queries con estado (usado en moviles-extended y filtros de estado):
-- WHERE escenario = X AND empresa_fletera_id = Y AND estado_nro = Z AND fch_para = 'D'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_escenario_empresa_estado_fchpara
  ON pedidos (escenario, empresa_fletera_id, estado_nro, fch_para);

-- Índice para arrastre (feature 2026-05-29): pendientes del día anterior.
-- WHERE fch_para = ayer AND estado_nro = 1 — ya cubierto por el índice anterior,
-- pero un índice parcial es más liviano para este caso específico.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_pendientes_fchpara
  ON pedidos (fch_para, escenario, empresa_fletera_id)
  WHERE estado_nro = 1;

-- ---------------------------------------------------------------------------
-- SERVICES
-- ---------------------------------------------------------------------------

-- Índice compuesto para el query principal del dashboard de supervisor:
-- WHERE escenario = X AND empresa_fletera_id IN (...) AND fch_para = 'YYYY-MM-DD'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_escenario_empresa_fchpara
  ON services (escenario, empresa_fletera_id, fch_para);

-- Índice compuesto con estado:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_escenario_empresa_estado_fchpara
  ON services (escenario, empresa_fletera_id, estado_nro, fch_para);

-- Índice parcial para pendientes (análogo al de pedidos):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_pendientes_fchpara
  ON services (fch_para, escenario, empresa_fletera_id)
  WHERE estado_nro = 1;

-- ---------------------------------------------------------------------------
-- MOVILES
-- ---------------------------------------------------------------------------

-- Índice compuesto para all-positions + moviles-extended:
-- WHERE mostrar_en_mapa = true AND empresa_fletera_id IN (...)
-- El índice parcial evita incluir filas con mostrar_en_mapa=false.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_moviles_mostrar_empresa
  ON moviles (empresa_fletera_id)
  WHERE mostrar_en_mapa = true;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- Ejecutar después de la migración para confirmar que los índices existen:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('pedidos', 'services', 'moviles')
--   AND indexname LIKE 'idx_%empresa%'
-- ORDER BY tablename, indexname;
