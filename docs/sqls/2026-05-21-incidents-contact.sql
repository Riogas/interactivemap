-- ============================================================================
-- 2026-05-21 — incidents: contacto del reporter + nombre completo
-- ============================================================================
--
-- Contexto: el form "Reportar incidencia" pide al usuario contacto opcional
-- (email + celular) para que despachadores puedan llamarlo de vuelta. Tambien
-- guardamos el nombre completo del reporter (de SecuritySuite) al momento del
-- upload, asi la pantalla /admin/incidencias muestra "Juan Perez (@jperez)"
-- en lugar de solo el username.
--
-- La tabla `incidents` ya tiene `username` (string) y `user_id`. Estos campos
-- nuevos son todos nullables, asi que es retro-compatible: incidencias viejas
-- van a quedar con NULL en estas columnas y el frontend cae al render sin
-- contacto.
--
-- Aplicar en: Supabase Studio → SQL Editor (proyecto trackmovil).
-- ============================================================================

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS contact_email   text,
  ADD COLUMN IF NOT EXISTS contact_celular text,
  ADD COLUMN IF NOT EXISTS reporter_nombre text;

COMMENT ON COLUMN incidents.contact_email   IS 'Email opcional que el reporter dejo para que lo contactemos. No validado (texto libre).';
COMMENT ON COLUMN incidents.contact_celular IS 'Celular/telefono opcional que el reporter dejo para contacto. Texto libre.';
COMMENT ON COLUMN incidents.reporter_nombre IS 'Nombre completo del reporter al momento del upload (snapshot desde SecuritySuite/AuthContext). Username vive en la columna `username`.';
