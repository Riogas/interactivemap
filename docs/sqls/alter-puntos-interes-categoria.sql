-- ============================================================
-- ALTER: Agregar columna 'categoria' a puntos_interes
-- Para clasificar POIs importados desde OpenStreetMap
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- Agregar columna categoria (nullable para no romper registros existentes)
ALTER TABLE public.puntos_interes
  ADD COLUMN IF NOT EXISTS categoria text NULL;

-- Índice para filtrar por categoria
CREATE INDEX IF NOT EXISTS idx_puntos_categoria
  ON public.puntos_interes (categoria);

-- Comentario descriptivo
COMMENT ON COLUMN public.puntos_interes.categoria IS
  'Categoría del POI: planta-riogas, punto-venta-riogas, gobierno, hospital, estacion-servicio, educacion, policia, bomberos, etc.';

-- Ampliar constraint de tipo para incluir 'osm' (importado de OpenStreetMap)
ALTER TABLE public.puntos_interes DROP CONSTRAINT IF EXISTS puntos_interes_tipo_check;
ALTER TABLE public.puntos_interes ADD CONSTRAINT puntos_interes_tipo_check
  CHECK (tipo IN ('publico', 'privado', 'osm'));
