-- Migracion: mensaje de bloqueo especifico por IP
-- Fecha: 2026-06-18
-- Descripcion:
--   Agrega la columna mensaje_bloqueo_ip a login_security_config para poder
--   mostrar un texto distinto cuando el bloqueo es por IP (block_type=ip) vs
--   el bloqueo de usuario. Si queda vacio, el sistema usa mensaje_bloqueo.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Seguro de correr multiples veces.
-- IMPORTANTE: correr en Supabase SQL Editor o via CLI.

-- ─── 1. Agregar columna ────────────────────────────────────────────────────────

ALTER TABLE login_security_config
  ADD COLUMN IF NOT EXISTS mensaje_bloqueo_ip TEXT NOT NULL
    DEFAULT 'Tu acceso fue bloqueado por demasiados intentos desde tu red. Contacta al administrador.';

-- ─── 2. Comentario de documentacion ────────────────────────────────────────────

COMMENT ON COLUMN login_security_config.mensaje_bloqueo_ip IS
  'Mensaje que ve el usuario cuando el bloqueo es por IP (block_type=ip). Si esta vacio, se usa mensaje_bloqueo. Max 500 caracteres (validado en la API).';

-- ─── 3. Poblar row existente con el default si quedo en NULL/'' ────────────────

UPDATE login_security_config
SET mensaje_bloqueo_ip = 'Tu acceso fue bloqueado por demasiados intentos desde tu red. Contacta al administrador.'
WHERE id = 1
  AND (mensaje_bloqueo_ip IS NULL OR TRIM(mensaje_bloqueo_ip) = '');

-- ─── Rollback (ejecutar manualmente si es necesario) ──────────────────────────
-- ALTER TABLE login_security_config DROP COLUMN IF EXISTS mensaje_bloqueo_ip;
