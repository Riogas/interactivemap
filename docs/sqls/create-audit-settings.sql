-- ============================================================
-- Tabla: audit_settings (singleton)
-- Controla si el sistema de auditoría está activo o no.
-- Solo puede existir una fila (id = 1).
-- Solo root puede modificarla via POST /api/audit/config.
--
-- Correr en Supabase self-hosted una sola vez, DESPUÉS de
-- crear audit_log (create-audit-log.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_settings (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Fila inicial: auditoría desactivada por defecto
INSERT INTO public.audit_settings (id, enabled, updated_at, updated_by)
VALUES (1, false, now(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Permisos: misma política que audit_log — acceso solo via service_role.
-- No exponer a anon ni authenticated directamente.
