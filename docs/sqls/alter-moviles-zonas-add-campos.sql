-- ============================================================
-- Agregar campos faltantes a moviles_zonas para recibir datos de Genexus
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Tipo de zona (ej: "Reparto", "Transito", etc.)
ALTER TABLE public.moviles_zonas
  ADD COLUMN IF NOT EXISTS tipo_de_zona text NULL DEFAULT '';

-- Tipo de servicio (ej: "GAS", "AGUA", etc.)
ALTER TABLE public.moviles_zonas
  ADD COLUMN IF NOT EXISTS tipo_de_servicio text NULL DEFAULT '';

-- Prioridad o tiempo de tránsito (minutos u orden de prioridad)
ALTER TABLE public.moviles_zonas
  ADD COLUMN IF NOT EXISTS prioridad_o_transito integer NULL DEFAULT 0;

-- Índice para filtrar por tipo de servicio (consultas frecuentes)
CREATE INDEX IF NOT EXISTS idx_moviles_zonas_tipo_servicio
  ON public.moviles_zonas USING btree (tipo_de_servicio) TABLESPACE pg_default;
