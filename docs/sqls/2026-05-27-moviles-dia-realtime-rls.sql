-- ============================================================
-- Migration: Realtime + RLS base para moviles_dia
-- Fecha: 2026-05-27
-- Spec: docs/superpowers/specs/2026-05-27-moviles-dia-projection-design.md
-- Plan: docs/superpowers/plans/2026-05-27-moviles-dia.md (Task 1.2)
-- ============================================================
--
-- PROPÓSITO:
--   Habilitar Supabase Realtime y Row Level Security (RLS) base
--   para la tabla moviles_dia.
--
-- PATRÓN ADOPTADO — RLS PERMISSIVO (USING true):
--   Todas las tablas realtime del repo usan el mismo patrón:
--   RLS habilitado + políticas permissivas USING (true) como placeholder.
--   Evidencia:
--     - supabase-full-migration.sql líneas 608-663: gps_latest_positions,
--       services, moviles, pedidos, etc. → todas con ENABLE ROW LEVEL SECURITY
--       + public_read (FOR SELECT USING (true)) + full_access (FOR ALL USING (true))
--     - create-services-table.sql líneas 112-120: mismo patrón en migración
--       individual de una tabla realtime
--   Por lo tanto se aplica el mismo patrón aquí. El hardening empresa-scoped
--   (filtrar por empresa_fletera_id según el usuario autenticado) está
--   diferido a Task 3.3 según el plan técnico.
--
-- PUBLICACIÓN REALTIME:
--   Nombre confirmado: supabase_realtime
--   Fuente: supabase-full-migration.sql líneas 674-704 y supabase-setup.sql líneas 12-15
--
-- APLICAR: vía Supabase SQL Editor (manual, sin CLI)
-- ============================================================


-- ─── 1. Realtime ──────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE moviles_dia;


-- ─── 2. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE moviles_dia ENABLE ROW LEVEL SECURITY;

-- Política de LECTURA pública — placeholder permissivo.
-- TASK 3.3: reemplazar USING (true) por USING (empresa_fletera_id = current_setting('app.empresa_id')::int)
-- o el predicado que corresponda al modelo de autenticación multi-tenant.
DROP POLICY IF EXISTS "public_read_moviles_dia" ON moviles_dia;
CREATE POLICY "public_read_moviles_dia"
  ON moviles_dia
  FOR SELECT
  USING (true);

-- Política de ESCRITURA completa — solo para service_role / triggers internos.
-- El cliente nunca debe escribir directamente en moviles_dia (es un read model).
-- TASK 3.3: restringir este acceso si se expone un endpoint de escritura autenticado.
DROP POLICY IF EXISTS "full_access_moviles_dia" ON moviles_dia;
CREATE POLICY "full_access_moviles_dia"
  ON moviles_dia
  FOR ALL
  USING (true)
  WITH CHECK (true);


-- ─── Verificación (ejecutar manualmente post-apply) ───────────────────────────
--
-- Confirma que moviles_dia está en la publicación realtime:
-- SELECT schemaname, tablename, pubname
-- FROM pg_publication_tables
-- WHERE tablename = 'moviles_dia';
--
-- Confirma que RLS está habilitado:
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE tablename = 'moviles_dia';
--
-- Lista políticas creadas:
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'moviles_dia';
