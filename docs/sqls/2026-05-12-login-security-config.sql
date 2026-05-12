-- Migración: Login Security Config + Audit Trail de Unblocks
-- Fecha: 2026-05-12
-- Descripción: Tabla de configuración global de límites de bloqueo + campos de audit trail en login_blocks

-- ==============================================================================
-- TABLA: login_security_config
-- ==============================================================================
-- Tabla de configuración global (single-row) para límites de bloqueo.
-- Solo root puede leer/escribir esta tabla vía los endpoints admin.

CREATE TABLE IF NOT EXISTS login_security_config (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  max_intentos_usuario      INTEGER NOT NULL DEFAULT 3,
  max_intentos_ip           INTEGER NOT NULL DEFAULT 5,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                TEXT,
  CONSTRAINT single_row     CHECK (id = 1)
);

-- Insertar row default si no existe (idempotente)
INSERT INTO login_security_config (id, max_intentos_usuario, max_intentos_ip)
VALUES (1, 3, 5)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE login_security_config IS
  'Configuración global de límites de bloqueo anti-bruteforce. Single-row (id=1). Solo root puede modificar.';

COMMENT ON COLUMN login_security_config.max_intentos_usuario IS
  'Cantidad de intentos fallidos antes de bloquear al usuario. Default: 3.';

COMMENT ON COLUMN login_security_config.max_intentos_ip IS
  'Cantidad de usernames distintos fallidos desde una IP antes de bloquear la IP. Default: 5.';

-- ==============================================================================
-- ALTER: login_blocks — Campos de audit trail para desbloqueos manuales
-- ==============================================================================
-- Permite saber quién desbloqueó a quién y cuándo.
-- is_active=false + unblocked_at + unblocked_by → desbloqueo manual registrado.
-- El desbloqueo automático (blocked_until < now()) no cambia is_active.

ALTER TABLE login_blocks
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS unblocked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unblocked_by   TEXT;

-- Índice para filtrar activos/inactivos eficientemente
CREATE INDEX IF NOT EXISTS idx_login_blocks_is_active ON login_blocks (is_active);

COMMENT ON COLUMN login_blocks.is_active IS
  'TRUE = bloqueo activo. FALSE = desbloqueado manualmente por admin (ver unblocked_by/unblocked_at).';
COMMENT ON COLUMN login_blocks.unblocked_at IS
  'Timestamp del desbloqueo manual. NULL si no fue desbloqueado manualmente.';
COMMENT ON COLUMN login_blocks.unblocked_by IS
  'Username del admin que ejecutó el desbloqueo manual. NULL si no fue desbloqueado manualmente.';
