-- =============================================================================
-- MIGRATION: Agregar columna permisos_sa a tabla users
-- Fecha: 2026-05-08
-- Descripcion: Columna JSONB para override granular de permisos "sin asignar".
--
-- Shape esperado:
--   { "acumulados": true, "x_zona": true, "unitarios": true }
--
-- Comportamiento:
--   - null (default): derivar permisos por rol (backwards-compatible).
--     Root, RolId 48/49/50 -> todos true. Distribuidor -> todos false.
--   - no null: override explícito, gana sobre derivación por rol.
--     Permite un distribuidor con unitarios=true excepcionalmente.
--
-- Para aplicar:
--   psql $DATABASE_URL < docs/sqls/alter-users-add-permisos-sa.sql
-- O via Supabase Studio: ejecutar el bloque ALTER TABLE abajo.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS permisos_sa jsonb;

-- No se hace backfill — null preserva comportamiento actual para todos los usuarios.
-- Para setear manualmente un override:
--   UPDATE users SET permisos_sa = '{"acumulados":true,"x_zona":true,"unitarios":true}'
--   WHERE id = <user_id>;
