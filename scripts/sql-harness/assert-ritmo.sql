\set ON_ERROR_STOP on
TRUNCATE moviles_zonas;
TRUNCATE metricas_cumplimiento;

-- Poblamos el universo de moviles_zonas: zonas 100, 200, 300 con tipos URGENTE, NOCTURNO, SERVICE.
INSERT INTO moviles_zonas (escenario_id, zona_id, tipo_de_servicio, activa)
VALUES
  (1000, 100, 'URGENTE', true),
  (1000, 100, 'NOCTURNO', true),
  (1000, 100, 'SERVICE', true),
  (1000, 200, 'URGENTE', true),
  (1000, 200, 'NOCTURNO', true),
  (1000, 200, 'SERVICE', true),
  (1000, 300, 'URGENTE', true),
  (1000, 300, 'NOCTURNO', true),
  (1000, 300, 'SERVICE', true);

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

-- Zona 300 URGENTE: en universo pero sin hechos -> fallback a GLOBAL.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=300 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'GLOBAL' THEN RAISE EXCEPTION 'zona 300 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok zona en universo sin hechos: devuelve fila, origen GLOBAL, valores del global';
END $$;

-- Tipo NOCTURNO: sin hechos en toda la ventana -> estadisticas NULL, muestras=0.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='NOCTURNO';
  IF r.ritmo_origen <> 'GLOBAL' THEN RAISE EXCEPTION 'zona 100 NOCTURNO origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  IF r.ritmo_media IS NOT NULL OR r.ritmo_mediana IS NOT NULL OR r.ritmo_p75 IS NOT NULL OR r.ritmo_p90 IS NOT NULL THEN
    RAISE EXCEPTION 'zona 100 NOCTURNO: estadisticas deben ser NULL (sin datos globales)';
  END IF;
  IF r.ritmo_muestras <> 0 THEN RAISE EXCEPTION 'zona 100 NOCTURNO: muestras debe ser 0, es %', r.ritmo_muestras; END IF;
  RAISE NOTICE 'ok tipo sin hechos globales: estadisticas=NULL, muestras=0';
END $$;
