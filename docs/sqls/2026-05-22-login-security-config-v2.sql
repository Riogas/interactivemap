-- Migracion: login_security_config v2
-- Fecha: 2026-05-22
-- Descripcion:
--   - Renombra tiempo_bloqueo_minutos → tiempo_bloqueo_usuario_minutos
--   - Agrega tiempo_bloqueo_ip_minutos (bloqueo de IP independiente del de usuario)
--   - Agrega ip_whitelist_patterns (IPs que no se bloquean automaticamente)
--
-- Idempotencia: segura para correr multiples veces en una BD nueva.
-- En BD con la columna vieja, el RENAME la mueve; en BD ya migrada,
-- el ALTER TABLE ... IF NOT EXISTS no hace nada.
--
-- IMPORTANTE: correr en Supabase SQL Editor o via CLI.
-- Rollback: ver comentarios al final.

-- ─── 1. Renombrar columna vieja ────────────────────────────────────────────────
-- Solo si existe la columna con el nombre viejo. Esto es idempotente:
-- si ya se renombro, la columna vieja no existe y el comando falla silenciosamente
-- (Postgres no tiene IF EXISTS para RENAME COLUMN en versiones antiguas, pero
-- Supabase usa Postgres 15+ que si lo soporta via DO block).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'login_security_config'
      AND column_name = 'tiempo_bloqueo_minutos'
  ) THEN
    ALTER TABLE login_security_config
      RENAME COLUMN tiempo_bloqueo_minutos TO tiempo_bloqueo_usuario_minutos;
  END IF;
END $$;

-- ─── 2. Agregar nuevas columnas ────────────────────────────────────────────────

ALTER TABLE login_security_config
  ADD COLUMN IF NOT EXISTS tiempo_bloqueo_ip_minutos INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ip_whitelist_patterns TEXT[] NOT NULL DEFAULT '{}';

-- ─── 3. Comentarios de documentacion ──────────────────────────────────────────

COMMENT ON COLUMN login_security_config.tiempo_bloqueo_usuario_minutos IS
  'Minutos que dura el bloqueo de un usuario (block_type=user). Default: 15.';

COMMENT ON COLUMN login_security_config.tiempo_bloqueo_ip_minutos IS
  'Minutos que dura el bloqueo de una IP (block_type=ip). Default: 15.';

COMMENT ON COLUMN login_security_config.ip_whitelist_patterns IS
  'Array de patrones de IP con asteriscos como wildcard por octeto (ej. 192.168.*.*, 10.0.0.*). Una IP que matchea cualquier patron NO entra al sistema de bloqueo automatico. Los attempts se siguen logeando con whitelisted=true.';

-- ─── 4. Actualizar row existente para poblar nuevos campos con defaults ────────
-- Garantiza que el row id=1 tiene valores validos tras la migracion.

UPDATE login_security_config
SET
  tiempo_bloqueo_ip_minutos = COALESCE(tiempo_bloqueo_usuario_minutos, 15),
  ip_whitelist_patterns = '{}'
WHERE id = 1
  AND tiempo_bloqueo_ip_minutos = 15  -- solo si tiene el default (no sobreescribir si ya fue configurado)
  AND ip_whitelist_patterns = '{}';   -- idem

-- ─── Rollback (ejecutar manualmente si es necesario) ──────────────────────────
-- ALTER TABLE login_security_config
--   RENAME COLUMN tiempo_bloqueo_usuario_minutos TO tiempo_bloqueo_minutos;
-- ALTER TABLE login_security_config
--   DROP COLUMN IF EXISTS tiempo_bloqueo_ip_minutos,
--   DROP COLUMN IF EXISTS ip_whitelist_patterns;
