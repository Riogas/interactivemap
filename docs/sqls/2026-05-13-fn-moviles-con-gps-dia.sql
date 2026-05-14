-- Migration: función moviles_con_gps_en_dia
-- Fecha: 2026-05-13
-- Aplicar manualmente en Supabase SQL Editor
-- Propósito: devolver los movil_id distintos que tienen al menos una posición
--            en gps_tracking_history dentro del día calendario indicado.
--            DISTINCT server-side evita traer miles de rows al cliente.

-- NOTA: gps_tracking_history.movil_id es TEXT (no int) en el schema actual
-- (ver types/supabase.ts). El endpoint TS hace Number(r.movil_id) para
-- convertir, así que el return type text es lo correcto.
CREATE OR REPLACE FUNCTION moviles_con_gps_en_dia(p_date date)
RETURNS TABLE(movil_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT gth.movil_id
  FROM gps_tracking_history gth
  WHERE gth.fecha_hora >= p_date::timestamp
    AND gth.fecha_hora < (p_date::timestamp + interval '1 day');
$$;

-- Comentario de uso desde Supabase JS:
--   const { data } = await supabase.rpc('moviles_con_gps_en_dia', { p_date: '2026-05-13' });
