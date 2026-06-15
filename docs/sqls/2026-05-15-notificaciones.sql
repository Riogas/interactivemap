-- =============================================================================
-- Migration: Notificaciones de novedades
-- Fecha: 2026-05-15
-- Aplicar en: Supabase SQL Editor (manualmente)
-- =============================================================================

-- NOTA PREVIA: Bucket de Storage
-- Crear el bucket 'notificaciones-media' manualmente desde el dashboard de Supabase:
--   Storage → New bucket → Name: notificaciones-media → Public: ON
-- (Public ON permite que los usuarios vean las imagenes/videos sin autenticacion)
-- El endpoint de upload usa service_role (no el cliente anon), asi que no se necesita
-- policy de escritura especial — el service_role bypasea todas las policies de Storage.

-- =============================================================================
-- Tabla principal de notificaciones (las "novedades")
-- =============================================================================

CREATE TABLE IF NOT EXISTS notificaciones (
  id              SERIAL PRIMARY KEY,
  titulo          TEXT NOT NULL,
  descripcion     TEXT NOT NULL,
  fecha_inicio    TIMESTAMPTZ NOT NULL,
  fecha_fin       TIMESTAMPTZ NOT NULL,
  activa          BOOLEAN NOT NULL DEFAULT TRUE,
  roles_target    TEXT[] NOT NULL DEFAULT '{}',  -- ej. ['Distribuidor', 'Dashboard', 'Despacho']
  media_url       TEXT,                          -- URL en Supabase Storage; null si no tiene media
  media_type      TEXT CHECK (media_type IN ('image', 'video')),  -- 'image' | 'video' | null
  created_by      TEXT NOT NULL,                 -- username del root que la creo
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index para el endpoint /pending (filtro activa + fechas)
CREATE INDEX IF NOT EXISTS idx_notif_activa_fechas
  ON notificaciones (activa, fecha_inicio, fecha_fin);

-- =============================================================================
-- Tabla de tracking: que usuario vio que notificacion y/o la dismissio
-- =============================================================================

CREATE TABLE IF NOT EXISTS notificaciones_user_state (
  notificacion_id  INT NOT NULL REFERENCES notificaciones(id) ON DELETE CASCADE,
  username         TEXT NOT NULL,
  visto_at         TIMESTAMPTZ,                  -- primera vez que se mostro al usuario
  dismissed_at     TIMESTAMPTZ,                  -- click "No recordar mas"
  PRIMARY KEY (notificacion_id, username)
);

-- Index para queries por usuario (endpoint /pending filtra dismissed por username)
CREATE INDEX IF NOT EXISTS idx_notif_state_user
  ON notificaciones_user_state (username);

-- =============================================================================
-- NOTA RLS
-- Estas tablas NO tienen RLS habilitado intencionalmente.
-- Todos los accesos se hacen desde API routes usando getServerSupabaseClient()
-- que usa la service_role key y bypasea RLS.
-- Si se necesita RLS en el futuro, revisar que todos los endpoints usen service_role.
-- =============================================================================
