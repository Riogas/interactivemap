-- ============================================================
-- Migracion: timeout global de inactividad de sesion
-- Fecha: 2026-06-18
-- Descripcion:
--   Agrega session_idle_timeout_minutes a realtime_settings (singleton id=1).
--   Es el timeout GLOBAL de inactividad (minutos) antes de cerrar sesion.
--   Default 480 (8 h). Un atributo de rol 'TiempoInactividadMin' del SecuritySuite
--   lo overridea por usuario (gana el del usuario si es mayor).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Seguro de correr multiples veces.
-- Correr en Supabase self-hosted.
-- ============================================================

ALTER TABLE public.realtime_settings
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes integer NOT NULL DEFAULT 480;

COMMENT ON COLUMN public.realtime_settings.session_idle_timeout_minutes IS
  'Timeout GLOBAL de inactividad de sesion en minutos (default 480 = 8h). Override por usuario via atributo de rol TiempoInactividadMin.';

-- Poblar la fila existente con el default si quedo NULL (no deberia, por el NOT NULL DEFAULT).
UPDATE public.realtime_settings
SET session_idle_timeout_minutes = 480
WHERE id = 1 AND session_idle_timeout_minutes IS NULL;

-- ─── Rollback (manual) ────────────────────────────────────────────────────────
-- ALTER TABLE public.realtime_settings DROP COLUMN IF EXISTS session_idle_timeout_minutes;
