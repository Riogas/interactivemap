-- ============================================================
-- Migration: Crear tabla derivada zonas_cap_entrega
-- Fecha: 2026-05-12
-- ============================================================
--
-- PROPÓSITO:
--   Tabla derivada que almacena la capacidad disponible (lote_disponible)
--   de cada móvil por combinación de (escenario, zona, tipo_servicio,
--   movil, emp_fletera_id). Permite consultar rápidamente cuánto lote
--   le queda a cada móvil en cada zona sin recalcular on-the-fly.
--
-- FÓRMULA:
--   lote_disponible = moviles.tamano_lote - moviles.capacidad
--   Puede ser negativo (sobrecupo real — no se clampea a 0).
--
-- MANTENIMIENTO:
--   Esta tabla NO se escribe manualmente. Siempre se actualiza vía
--   el helper TypeScript lib/zonas-cap-entrega.ts, función
--   syncMovilZonasCapEntrega(). Usar recomputeMovilAndCapEntrega()
--   en todos los call-sites de mutación.
--
-- SINCRONIZACIÓN:
--   UPSERT de filas existentes + DELETE de filas stale por movil.
--   Idempotente: puede re-ejecutarse sin efectos secundarios.
--
-- APLICAR: vía Supabase SQL Editor (manual, sin CLI)
-- ============================================================

-- ─── Paso 1: Crear tabla ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zonas_cap_entrega (
  escenario        INT NOT NULL,
  zona             INT NOT NULL,
  tipo_servicio    TEXT NOT NULL,
  movil            INT NOT NULL,
  emp_fletera_id   INT NOT NULL,
  lote_disponible  INT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (escenario, zona, tipo_servicio, movil, emp_fletera_id)
);

COMMENT ON TABLE zonas_cap_entrega IS
  'Tabla derivada: lote_disponible por (escenario, zona, tipo_servicio, movil, emp_fletera_id). '
  'Sincronizada vía helper TS lib/zonas-cap-entrega.ts, NO por triggers SQL. '
  'No escribir manualmente.';

-- ─── Paso 2: Índices secundarios ─────────────────────────────────────────────

-- Para filtrar todos los móviles de una empresa fletera en cualquier zona/escenario.
CREATE INDEX IF NOT EXISTS idx_zonas_cap_entrega_emp_fletera
  ON zonas_cap_entrega (emp_fletera_id);

-- Para invalidación reverse-lookup desde mutaciones de pedidos/services:
-- "¿qué filas de zonas_cap_entrega afectan a este movil?"
CREATE INDEX IF NOT EXISTS idx_zonas_cap_entrega_movil
  ON zonas_cap_entrega (movil);

-- ─── Paso 3: Backfill inicial ─────────────────────────────────────────────────
--
-- Puebla la tabla por primera vez desde el estado actual de moviles + moviles_zonas.
-- Condiciones para insertar una fila:
--   1. El móvil tiene tamano_lote NOT NULL (sin él no hay lote que calcular).
--   2. La asignación zona está activa (activa = true en moviles_zonas).
--   3. tipo_de_servicio NOT NULL y NOT '' (campo obligatorio del PK).
--
-- NOTA: Este INSERT es idempotente gracias al ON CONFLICT DO UPDATE.
-- Se puede re-ejecutar si los datos de moviles cambian antes de que el
-- helper TS esté activo.

INSERT INTO zonas_cap_entrega (
  escenario,
  zona,
  tipo_servicio,
  movil,
  emp_fletera_id,
  lote_disponible,
  updated_at
)
SELECT
  m.escenario_id                          AS escenario,
  mz.zona_id                              AS zona,
  mz.tipo_de_servicio                     AS tipo_servicio,
  m.nro                                   AS movil,
  m.empresa_fletera_id                    AS emp_fletera_id,
  m.tamano_lote - m.capacidad             AS lote_disponible,
  NOW()                                   AS updated_at
FROM moviles m
JOIN moviles_zonas mz
  ON mz.movil_id = m.nro::TEXT
 AND mz.activa = true
WHERE
  m.nro IS NOT NULL
  AND m.tamano_lote IS NOT NULL
  AND mz.tipo_de_servicio IS NOT NULL
  AND mz.tipo_de_servicio <> ''
ON CONFLICT (escenario, zona, tipo_servicio, movil, emp_fletera_id)
DO UPDATE SET
  lote_disponible = EXCLUDED.lote_disponible,
  updated_at      = NOW();

-- ─── Verificación post-backfill (ejecutar manualmente para auditar) ───────────
--
-- SELECT
--   zce.*,
--   (SELECT tamano_lote FROM moviles m WHERE m.nro = zce.movil LIMIT 1) AS tamano_lote,
--   (SELECT capacidad   FROM moviles m WHERE m.nro = zce.movil LIMIT 1) AS capacidad
-- FROM zonas_cap_entrega zce
-- ORDER BY zce.escenario, zce.zona, zce.movil
-- LIMIT 50;
