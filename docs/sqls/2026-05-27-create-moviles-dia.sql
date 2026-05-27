-- ============================================================
-- Migration: Crear tabla moviles_dia (read model de carga de móviles)
-- Fecha: 2026-05-27
-- Spec: docs/superpowers/specs/2026-05-27-moviles-dia-projection-design.md
-- Plan: docs/superpowers/plans/2026-05-27-moviles-dia.md (Task 1.1)
-- ============================================================
--
-- PROPÓSITO:
--   Tabla desnormalizada (read model / proyección) con una fila por
--   (escenario_id, movil_id, fecha). Permite cargar la lista completa
--   de móviles del dashboard con 1 query + 1 canal Realtime en lugar
--   de ~5 queries + joins en el cliente.
--
-- FUENTES QUE ALIMENTAN ESTA TABLA:
--   - moviles          → empresa_fletera_id, matricula, descripcion,
--                        estado_nro, estado_desc, tamano_lote, activo, oculto_operativo
--   - pedidos          → pedidos_pendientes (estado_nro=1, fch_para=hoy)
--   - services         → services_pendientes (estado_nro=1, fch_para=hoy)
--   - gps_latest_positions → last_gps_lat/lng/datetime
--
-- NATURALEZA:
--   Rebuildable: puede truncarse y reconstruirse desde las tablas origen
--   sin pérdida de información. No es fuente de verdad — nunca escribir
--   directamente desde el cliente.
--
-- LÓGICA DE ACTUALIZACIÓN:
--   Actualizada por triggers/funciones SQL (Tasks 1.2 y siguientes).
--   Para fechas pasadas, pedidos_pendientes y services_pendientes son NULL
--   (no tiene sentido recontarlos fuera del día actual).
--
-- APLICAR: vía Supabase SQL Editor (manual, sin CLI)
-- ============================================================

CREATE TABLE IF NOT EXISTS moviles_dia (
  -- ── Clave primaria compuesta ──────────────────────────────────────────────────
  escenario_id          INTEGER       NOT NULL,
  movil_id              INTEGER       NOT NULL,
  fecha                 DATE          NOT NULL,

  -- ── Datos denormalizados de moviles ──────────────────────────────────────────
  empresa_fletera_id    INTEGER,
  matricula             TEXT,
  descripcion           TEXT,
  estado_nro            INTEGER,
  estado_desc           TEXT,
  tamano_lote           INTEGER,

  -- ── Contadores de carga (NULL para fechas pasadas) ───────────────────────────
  pedidos_pendientes    INTEGER,
  services_pendientes   INTEGER,

  -- ── Última posición GPS conocida ─────────────────────────────────────────────
  last_gps_lat          DOUBLE PRECISION,
  last_gps_lng          DOUBLE PRECISION,
  last_gps_datetime     TIMESTAMPTZ,

  -- ── Flags operativos ─────────────────────────────────────────────────────────
  activo                BOOLEAN       NOT NULL DEFAULT false,
  oculto_operativo      BOOLEAN       NOT NULL DEFAULT false,
  inactivo_del_dia      BOOLEAN       NOT NULL DEFAULT false,

  -- ── Control ──────────────────────────────────────────────────────────────────
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  PRIMARY KEY (escenario_id, movil_id, fecha)
);

-- ─── Índices ──────────────────────────────────────────────────────────────────

-- Filtrado por empresa dentro de un escenario/fecha (caso de uso principal del dashboard)
CREATE INDEX IF NOT EXISTS idx_moviles_dia_esc_fecha_empresa
  ON moviles_dia (escenario_id, fecha, empresa_fletera_id);

-- Filtrado por móviles activos dentro de un escenario/fecha
CREATE INDEX IF NOT EXISTS idx_moviles_dia_esc_fecha_activo
  ON moviles_dia (escenario_id, fecha, activo);

-- Índice parcial: solo las filas con posición GPS conocida
-- (útil para queries del mapa que filtran last_gps_datetime IS NOT NULL)
CREATE INDEX IF NOT EXISTS idx_moviles_dia_esc_fecha_con_gps
  ON moviles_dia (escenario_id, fecha)
  WHERE last_gps_datetime IS NOT NULL;

-- ─── Comentario de la tabla ───────────────────────────────────────────────────

COMMENT ON TABLE moviles_dia IS
  'Read model desnormalizado: una fila por (escenario_id, movil_id, fecha). '
  'Alimentado por triggers desde moviles, pedidos, services y gps_latest_positions. '
  'Rebuildable — no es fuente de verdad. No escribir directamente desde el cliente.';

-- ─── Verificación (ejecutar manualmente post-apply) ───────────────────────────
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'moviles_dia'
-- ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'moviles_dia';
