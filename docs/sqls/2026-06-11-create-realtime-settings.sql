-- ============================================================
-- Tabla: realtime_settings (singleton)
-- Configuración GLOBAL ÚNICA (para todo el sistema, sin importar
-- escenario ni usuario) de la conexión Realtime y los intervalos
-- de refresco automático.
--
-- Antes estos valores se guardaban por-usuario en user_preferences,
-- por lo que un cambio hecho por un admin NO lo veían los demás
-- (cada uno leía su propia fila → default). Ahora viven en una
-- única fila global (id = 1) que leen todos los usuarios.
--
-- Solo puede existir una fila (id = 1).
-- Se modifica via PUT /api/realtime-config (gate root/admin).
--
-- Correr en Supabase self-hosted una sola vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.realtime_settings (
  id                                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Realtime (avanzado)
  realtime_polling_reconcile_seconds integer NOT NULL DEFAULT 60,
  realtime_silence_timeout_seconds   integer NOT NULL DEFAULT 45,
  realtime_refetch_on_visible        boolean NOT NULL DEFAULT true,
  realtime_heartbeat_seconds         integer NOT NULL DEFAULT 15,
  realtime_events_per_second         integer NOT NULL DEFAULT 10,
  realtime_pause_on_hidden_enabled   boolean NOT NULL DEFAULT false,
  realtime_pause_on_hidden_minutes   integer NOT NULL DEFAULT 15,
  -- Intervalos de refresco automático
  demoras_polling_seconds            integer NOT NULL DEFAULT 120,
  moviles_zonas_polling_seconds      integer NOT NULL DEFAULT 90,
  -- Metadata
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  updated_by                         text
);

-- Fila inicial con los defaults conservadores del sistema.
INSERT INTO public.realtime_settings (id, updated_at, updated_by)
VALUES (1, now(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Permisos: acceso solo via service_role (los endpoints usan el server client).
-- No exponer a anon ni authenticated directamente.
