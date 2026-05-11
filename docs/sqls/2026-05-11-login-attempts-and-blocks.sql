-- Migración: Login Security (Logs + Bloqueos automáticos)
-- Fecha: 2026-05-11
-- Descripción: Sistema de auditoría y protección anti-bruteforce para login

-- ==============================================================================
-- TABLA: login_attempts
-- ==============================================================================
-- Registra TODOS los intentos de login (success/fail/blocked/user_eq_pass)
-- Retención: 30 días (cleanup automático futuro vía cron)

CREATE TABLE IF NOT EXISTS login_attempts (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  escenario_id    INTEGER,                 -- nullable: a veces no se conoce hasta autenticar
  username        TEXT NOT NULL,
  ip              TEXT NOT NULL,
  user_agent      TEXT,
  estado          TEXT NOT NULL CHECK (estado IN ('success', 'fail', 'blocked_user', 'blocked_ip', 'user_eq_pass')),
  blocked_until   TIMESTAMPTZ,             -- si aplica
  whitelisted     BOOLEAN NOT NULL DEFAULT FALSE,
  extra           JSONB                    -- info adicional (response del upstream, etc.)
);

-- Índices para queries frecuentes
CREATE INDEX idx_login_attempts_ts ON login_attempts (ts DESC);
CREATE INDEX idx_login_attempts_username_ts ON login_attempts (username, ts DESC);
CREATE INDEX idx_login_attempts_ip_ts ON login_attempts (ip, ts DESC);
CREATE INDEX idx_login_attempts_estado_ts ON login_attempts (estado, ts DESC);

-- Comentario para limpieza futura
COMMENT ON TABLE login_attempts IS
  'Auditoría de intentos de login. Retención: 30 días. Cleanup futuro: DELETE FROM login_attempts WHERE ts < now() - INTERVAL ''30 days'';';

-- ==============================================================================
-- TABLA: login_blocks
-- ==============================================================================
-- Bloqueos activos de usuarios/IPs
-- Expiran automáticamente cuando blocked_until < now()

CREATE TABLE IF NOT EXISTS login_blocks (
  id              BIGSERIAL PRIMARY KEY,
  block_type      TEXT NOT NULL CHECK (block_type IN ('user', 'ip')),
  key             TEXT NOT NULL,            -- username si type=user, ip si type=ip
  blocked_until   TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT,                     -- 'too_many_failed_attempts' | 'manual_admin' | ...
  CONSTRAINT uq_active_block UNIQUE (block_type, key)
);

-- Índice para queries de expiración
CREATE INDEX idx_login_blocks_blocked_until ON login_blocks (blocked_until);

-- Comentario
COMMENT ON TABLE login_blocks IS
  'Bloqueos activos de usuarios/IPs. Expiran cuando blocked_until < now(). Cleanup periódico opcional: DELETE FROM login_blocks WHERE blocked_until < now() - INTERVAL ''7 days'';';
