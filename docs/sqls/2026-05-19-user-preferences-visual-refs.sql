-- ============================================================
-- Migration: user_preferences — agregar preferences_extra JSONB
-- Fecha: 2026-05-19
-- Aplicar manualmente en Supabase SQL Editor.
-- ============================================================
--
-- Esta migracion agrega la columna preferences_extra (JSONB) a la tabla
-- user_preferences si aun no existe.
-- El campo almacena preferencias flexibles (incluidos los colores de refs
-- visuales Ref#1..Ref#26) sin necesidad de alterar el schema columnar.
--
-- NOTA: Si la columna ya existe (fue creada en una migracion previa),
--       el IF NOT EXISTS la saltea sin error.
--
-- Estructura de preferences_extra:
--   {
--     "visualRefs": {
--       "Ref#1": "#9ca3af",
--       "Ref#2": "#86efac",
--       ...
--     },
--     "zonaOpacity": 50,
--     "lightMode": true,
--     ...
--   }
--
-- El user_id en esta tabla es el username del SecuritySuite (TEXT), no UUID.
-- ============================================================

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS preferences_extra JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_preferences.preferences_extra IS
  'Preferencias flexibles en JSONB. Incluye visualRefs (colores Ref#1..Ref#26),
   zonaOpacity, lightMode, halos, zonaPattern y cualquier campo futuro.
   El shape esperado esta en lib/visual-refs-catalog.ts y components/ui/PreferencesModal.tsx.';
