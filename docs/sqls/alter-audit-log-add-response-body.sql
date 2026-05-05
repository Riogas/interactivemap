-- ============================================================
-- ALTER: agregar response_body al audit_log.
-- Correr una sola vez en el Supabase self-hosted.
-- ============================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS response_body JSONB;

-- Opcional: si querés evitar que la columna crezca sin control,
-- podés capar en el server (truncate a N KB antes del insert).
-- Ya está implementado en lib/audit-log.ts con MAX_BODY_BYTES.
