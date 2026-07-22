-- =====================================================================
-- Tabla de hechos: metricas_cumplimiento (grano: pedido/service cumplido)
-- Fecha: 2026-07-22 | Idempotente | Inmutable (se conserva para siempre)
-- Sin RLS: acceso solo vía getServerSupabaseClient() (service_role).
-- =====================================================================
CREATE TABLE IF NOT EXISTS metricas_cumplimiento (
  origen                text        NOT NULL CHECK (origen IN ('PEDIDO','SERVICE')),
  pedido_id             bigint      NOT NULL,
  escenario             integer     NOT NULL,
  fecha                 date        NOT NULL,                       -- día de cumplimiento en America/Montevideo
  tipo_servicio         text        NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','COMUN','SERVICE')),
  servicio_nombre       text,                                       -- valor crudo de origen (puede ser null)
  movil                 integer,                                    -- puede ser null/0 (cumplido sin móvil)
  zona_nro              integer,                                    -- null → bucket propio en la vista de zona
  empresa_fletera_id    integer,
  chofer                text,                                       -- null si no atribuible (nombre-texto, sin ID estable)
  fch_hora_asignado     timestamptz,                                -- null cuando asignado_source='DERIVADO'
  fch_hora_finalizacion timestamptz NOT NULL,
  demora_mins           numeric     NOT NULL,                       -- >= 0 (negativos se excluyen en el run)
  asignado_source       text        NOT NULL CHECK (asignado_source IN ('CAMPO','DERIVADO')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origen, pedido_id, escenario)
);

CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_fecha        ON metricas_cumplimiento (fecha);
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_fecha_movil  ON metricas_cumplimiento (fecha, movil);
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_fecha_zona   ON metricas_cumplimiento (fecha, zona_nro);
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_fecha_chofer ON metricas_cumplimiento (fecha, chofer);

COMMENT ON TABLE metricas_cumplimiento IS
  'Hechos inmutables de demora asignado→cumplido por pedido/service. Poblada por POST /api/metricas/cumplimiento/run (cron 00:15 UY). Agregados vía vw_metricas_cumplimiento_*.';

-- ─── Verificación (correr post-apply) ─────────────────────────────────
-- SELECT count(*) FROM metricas_cumplimiento;                 -- 0 recién creada
-- \d metricas_cumplimiento                                    -- PK (origen,pedido_id,escenario) + 4 índices
-- SELECT indexname FROM pg_indexes WHERE tablename = 'metricas_cumplimiento';
