-- ============================================================
-- Tabla: incidents
-- Reportes de incidencia con grabación de pantalla hecha por el
-- usuario desde el botón flotante del track.
--
-- El video vive en Supabase Storage (bucket "incident-videos"),
-- esta tabla guarda la metadata y el path.
--
-- Correr en Supabase SQL Editor una sola vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.incidents (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id      TEXT,
  username     TEXT,
  description  TEXT,
  video_path   TEXT NOT NULL,          -- path dentro del bucket
  duration_s   INT,                    -- duración de la grabación en segundos
  size_bytes   BIGINT,                 -- tamaño del archivo
  mime_type    TEXT,                   -- ej. video/webm
  ip           TEXT,
  user_agent   TEXT,
  notes        TEXT,                   -- notas del admin al revisar
  status       TEXT DEFAULT 'open'     -- 'open' | 'in_review' | 'closed'
);

CREATE INDEX IF NOT EXISTS idx_incidents_ts     ON public.incidents (ts DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_user   ON public.incidents (username, ts DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents (status, ts DESC);

-- ============================================================
-- Bucket de Storage: incident-videos (privado)
-- ============================================================
-- Desde Supabase Studio: Storage → New bucket → nombre "incident-videos"
-- → marcar "Public bucket" OFF.
-- O via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-videos', 'incident-videos', false)
ON CONFLICT (id) DO NOTHING;

-- Opcional: limpieza automática de videos > 90 días (requiere pg_cron)
-- SELECT cron.schedule(
--   'incidents-cleanup',
--   '0 4 * * *',
--   $$ DELETE FROM public.incidents WHERE ts < NOW() - INTERVAL '90 days' $$
-- );
