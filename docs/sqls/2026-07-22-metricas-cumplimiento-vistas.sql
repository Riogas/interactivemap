-- =====================================================================
-- Vistas de agregación de metricas_cumplimiento
-- Fecha: 2026-07-22 | Solo lectura (CREATE OR REPLACE VIEW)
-- Percentiles con percentile_cont (interpola; N=1 → todos = el valor).
-- Semana: date_trunc('week') → lunes ISO. Mes: date_trunc('month').
--
-- MÉTRICA PRINCIPAL: demora_efectiva_mins (regla de agendados: si
-- asignado+60min < para el reloj arranca en la para, clamp 0). La demora
-- bruta queda disponible en la tabla de hechos. promedio_atraso_mins es
-- fin - para CON signo (negativo = entregó antes; AVG ignora los null).
-- =====================================================================

CREATE OR REPLACE VIEW vw_metricas_cumplimiento_diario AS
  SELECT 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         fecha AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*)                                                                 AS cantidad,
         ROUND(AVG(demora_efectiva_mins), 2)                                      AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)        AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)        AS p90_mins,
         MIN(demora_efectiva_mins)                                                AS min_mins,
         MAX(demora_efectiva_mins)                                                AS max_mins,
         ROUND(AVG(atraso_vs_para_mins), 2)                                       AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY chofer, fecha, tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT 'MOVIL', movil::text, fecha, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY movil, fecha, tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT 'ZONA', zona_nro::text, fecha, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY zona_nro, fecha, tipo_servicio, empresa_fletera_id;

CREATE OR REPLACE VIEW vw_metricas_cumplimiento_semanal AS
  -- Idéntica a la diaria pero periodo = date_trunc('week', fecha)::date (lunes ISO)
  -- y GROUP BY usa date_trunc('week', fecha)::date en lugar de fecha.
  SELECT 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         date_trunc('week', fecha)::date AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*) AS cantidad, ROUND(AVG(demora_efectiva_mins),2) AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins) AS min_mins, MAX(demora_efectiva_mins) AS max_mins,
         ROUND(AVG(atraso_vs_para_mins),2) AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY chofer, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT 'MOVIL', movil::text, date_trunc('week', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY movil, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT 'ZONA', zona_nro::text, date_trunc('week', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY zona_nro, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id;

CREATE OR REPLACE VIEW vw_metricas_cumplimiento_mensual AS
  -- Idéntica pero periodo = date_trunc('month', fecha)::date.
  SELECT 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         date_trunc('month', fecha)::date AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*) AS cantidad, ROUND(AVG(demora_efectiva_mins),2) AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins) AS min_mins, MAX(demora_efectiva_mins) AS max_mins,
         ROUND(AVG(atraso_vs_para_mins),2) AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY chofer, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT 'MOVIL', movil::text, date_trunc('month', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY movil, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT 'ZONA', zona_nro::text, date_trunc('month', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY zona_nro, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id;

-- ─── Verificación ─────────────────────────────────────────────────────
-- SELECT dimension, count(*) FROM vw_metricas_cumplimiento_diario GROUP BY dimension;
-- SELECT * FROM vw_metricas_cumplimiento_semanal ORDER BY periodo DESC LIMIT 20;
-- Chequear: mediana_mins entre min_mins y max_mins; cantidad >= 1.
--
-- Nota de tipos: percentile_cont devuelve double precision; mediana_mins/p90_mins
-- quedan como float (sin redondear). El panel (fuera de alcance) formatea a 2
-- decimales al mostrar.
