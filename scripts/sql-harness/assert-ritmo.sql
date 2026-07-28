\set ON_ERROR_STOP on
TRUNCATE metricas_cumplimiento;

-- Zona 100 URGENTE: 5 hechos -> alcanza el minimo, origen ZONA.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', g, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
       now(), v, v, 'CAMPO'
FROM (VALUES (1,10.0),(2,20.0),(3,30.0),(4,40.0),(5,100.0)) AS t(g,v);

-- Zona 200 URGENTE: 2 hechos -> NO alcanza, debe caer a GLOBAL.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', g, 1000, DATE '2026-07-28', 'URGENTE', 11, 200, 'BETO',
       now(), v, v, 'CAMPO'
FROM (VALUES (101,500.0),(102,600.0)) AS t(g,v);

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'ZONA' THEN RAISE EXCEPTION 'zona 100 origen: % (esperaba ZONA)', r.ritmo_origen; END IF;
  IF r.ritmo_muestras <> 5 THEN RAISE EXCEPTION 'zona 100 muestras: %', r.ritmo_muestras; END IF;
  IF round(r.ritmo_mediana,2) <> 30.00 THEN RAISE EXCEPTION 'mediana: % (esperaba 30)', r.ritmo_mediana; END IF;
  IF round(r.ritmo_media,2) <> 40.00 THEN RAISE EXCEPTION 'media: % (esperaba 40)', r.ritmo_media; END IF;
  IF r.ritmo_p90 <= r.ritmo_mediana THEN RAISE EXCEPTION 'p90 debe superar la mediana'; END IF;
  RAISE NOTICE 'ok zona con muestras suficientes';
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'GLOBAL' THEN RAISE EXCEPTION 'zona 200 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok fallback a global por pocas muestras';
END $$;
