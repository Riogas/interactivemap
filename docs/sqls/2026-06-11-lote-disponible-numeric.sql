-- ============================================================
-- Migración: zonas_cap_entrega.lote_disponible  INT -> NUMERIC
--
-- Motivo (CapEntrega.docx 2026-06-11): el prorrateo de capacidad
-- pasa a ser PONDERADO:
--   aporte(zona) = (lote_libre / Σpesos) * peso_zona
--   peso prioridad = 1 ; peso transito = peso_transito_alpha
-- Con esta fórmula el aporte puede ser NO entero (ej. 1.7143),
-- por lo que la columna debe permitir decimales.
--
-- NUMERIC(12,4): hasta 4 decimales (coincide con el redondeo
-- aplicado en lib/zonas-cap-entrega.ts). La vista vw_zona_capacidad
-- (SUM(lote_disponible)) hereda el tipo numérico automáticamente.
--
-- Idempotente: solo altera si el tipo actual no es numeric.
-- Correr una sola vez en Supabase self-hosted.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'zonas_cap_entrega'
      AND column_name  = 'lote_disponible'
      AND data_type    <> 'numeric'
  ) THEN
    ALTER TABLE public.zonas_cap_entrega
      ALTER COLUMN lote_disponible TYPE NUMERIC(12,4)
      USING lote_disponible::NUMERIC(12,4);
  END IF;
END $$;
