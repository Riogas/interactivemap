-- ============================================================
-- Tabla: audit_log
-- Registra cada acción que hace un usuario en TrackMovil
-- (calls a /api/*, clicks, navegaciones), asociado al JWT logueado.
--
-- Correr en Supabase self-hosted una sola vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id               BIGSERIAL PRIMARY KEY,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id          TEXT,
  username         TEXT,
  event_type       TEXT NOT NULL,    -- 'api_call' | 'navigation' | 'click' | 'custom'
  method           TEXT,             -- GET/POST/... (solo api_call)
  endpoint         TEXT,             -- '/api/pedidos?fecha=...' o '/dashboard'
  request_body     JSONB,
  request_query    JSONB,
  response_status  INT,
  response_size    INT,
  duration_ms      INT,
  ip               TEXT,
  user_agent       TEXT,
  source           TEXT NOT NULL,    -- 'client' | 'server'
  error            TEXT,
  extra            JSONB             -- payload libre para eventos custom
);

-- Índices para queries típicas
CREATE INDEX IF NOT EXISTS idx_audit_log_ts         ON public.audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user       ON public.audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON public.audit_log (event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_endpoint   ON public.audit_log (endpoint, ts DESC);

-- Permisos: el inserto lo hace el server con service_role (bypass RLS).
-- La lectura se hace también server-side para /admin/auditoria, con service_role.
-- No exponemos la tabla a anon ni authenticated directamente.

-- Política opcional: permitir SELECT desde service_role (ya lo tiene por default
-- cuando RLS está deshabilitado). Si activás RLS:
-- ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_all" ON public.audit_log FOR ALL TO service_role USING (true);

-- Limpieza automática (opcional): borrar logs > 90 días
-- Si tenés pg_cron instalado:
-- SELECT cron.schedule(
--   'audit-log-cleanup',
--   '0 3 * * *',
--   $$ DELETE FROM public.audit_log WHERE ts < NOW() - INTERVAL '90 days' $$
-- );
