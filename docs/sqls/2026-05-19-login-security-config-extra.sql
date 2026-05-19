-- Migration: agregar tiempo_bloqueo_minutos y mensaje_bloqueo a login_security_config
-- Aplicar manual en Supabase SQL Editor.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.

ALTER TABLE login_security_config
  ADD COLUMN IF NOT EXISTS tiempo_bloqueo_minutos INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS mensaje_bloqueo TEXT NOT NULL DEFAULT 'Tu acceso esta bloqueado temporalmente. Contacta al administrador.';

-- Actualizar el row existente con los defaults explícitos (por si ya existia el row sin las columnas)
UPDATE login_security_config
SET
  tiempo_bloqueo_minutos = COALESCE(tiempo_bloqueo_minutos, 15),
  mensaje_bloqueo        = COALESCE(NULLIF(TRIM(mensaje_bloqueo), ''), 'Tu acceso esta bloqueado temporalmente. Contacta al administrador.')
WHERE id = 1;
