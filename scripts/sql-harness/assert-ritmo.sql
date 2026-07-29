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
  IF r.ritmo_origen IS DISTINCT FROM 'ZONA' THEN RAISE EXCEPTION 'zona 100 origen: % (esperaba ZONA)', r.ritmo_origen; END IF;
  IF r.ritmo_muestras IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'zona 100 muestras: %', r.ritmo_muestras; END IF;
  IF round(r.ritmo_mediana,2) IS DISTINCT FROM 30.00 THEN RAISE EXCEPTION 'mediana: % (esperaba 30)', r.ritmo_mediana; END IF;
  IF round(r.ritmo_media,2) IS DISTINCT FROM 40.00 THEN RAISE EXCEPTION 'media: % (esperaba 40)', r.ritmo_media; END IF;
  IF r.ritmo_p90 IS DISTINCT FROM NULL AND r.ritmo_p90 <= r.ritmo_mediana THEN RAISE EXCEPTION 'p90 debe superar la mediana'; END IF;
  RAISE NOTICE 'ok zona con muestras suficientes';
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'GLOBAL' THEN RAISE EXCEPTION 'zona 200 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  -- Cuando cae al global, ritmo_muestras es el count del global (7 = 5 de zona 100 + 2 de zona 200)
  IF r.ritmo_muestras IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'zona 200 muestras: % (esperaba 7 del global)', r.ritmo_muestras; END IF;
  RAISE NOTICE 'ok fallback a global por pocas muestras';
END $$;

-- Zona 300 URGENTE: en universo pero sin hechos -> fallback a GLOBAL.
-- Valores deben coincidir con el global de URGENTE.
DO $$
DECLARE r record; r_global record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=300 AND tipo_servicio='URGENTE';
  -- Obtener el global de URGENTE desde zona 200 que tiene origen='GLOBAL'
  SELECT * INTO r_global FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'GLOBAL' THEN RAISE EXCEPTION 'zona 300 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  -- Zona 300 sin hechos debe tener los mismos valores que el global (sacado del global del tipo URGENTE)
  IF r.ritmo_media IS DISTINCT FROM r_global.ritmo_media THEN RAISE EXCEPTION 'zona 300 media: % (esperaba %)', r.ritmo_media, r_global.ritmo_media; END IF;
  IF r.ritmo_mediana IS DISTINCT FROM r_global.ritmo_mediana THEN RAISE EXCEPTION 'zona 300 mediana: % (esperaba %)', r.ritmo_mediana, r_global.ritmo_mediana; END IF;
  RAISE NOTICE 'ok zona en universo sin hechos: devuelve fila, origen GLOBAL, valores del global';
END $$;

-- Tipo NOCTURNO: sin hechos en toda la ventana -> estadisticas NULL, muestras=0.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='NOCTURNO';
  IF r.ritmo_origen IS DISTINCT FROM 'GLOBAL' THEN RAISE EXCEPTION 'zona 100 NOCTURNO origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  IF r.ritmo_media IS NOT NULL OR r.ritmo_mediana IS NOT NULL OR r.ritmo_p75 IS NOT NULL OR r.ritmo_p90 IS NOT NULL THEN
    RAISE EXCEPTION 'zona 100 NOCTURNO: estadisticas deben ser NULL (sin datos globales)';
  END IF;
  IF r.ritmo_muestras IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'zona 100 NOCTURNO: muestras debe ser 0, es %', r.ritmo_muestras; END IF;
  RAISE NOTICE 'ok tipo sin hechos globales: estadisticas=NULL, muestras=0';
END $$;

-- =====================================================================
-- Cascada de 4 niveles (Task 10): CHOFER -> MOVIL -> ZONA -> GLOBAL.
--
-- IMPORTANTE: estos fixtures van DESPUES de los asserts de arriba a
-- proposito. Los asserts viejos ya corrieron contra un movil_id NULL en
-- moviles_zonas (nadie matchea moviles_dia), asi que CHOFER y MOVIL
-- salen con 0 muestras y la cascada por defecto sigue resolviendo por
-- ZONA/GLOBAL como antes. Si estos INSERT se movieran antes, la zona
-- 100 URGENTE pasaria a resolver por CHOFER y los asserts viejos (que
-- exigen origen='ZONA') fallarian sin que la funcion este mal: el chofer
-- ANA maneja el movil 10 y sus 5 hechos son exactamente los mismos 5 de
-- la zona 100, asi que media/mediana coinciden entre ZONA y CHOFER.
--
-- Movil 10 ya aparece en metricas_cumplimiento (5 hechos, chofer ANA,
-- zona 100, URGENTE) desde el fixture de arriba. Lo activamos como
-- movil real en moviles_zonas/moviles_dia para que el aporte ponderado
-- (el mismo prorrateo de demoras_capacidad) tenga algo que ponderar.
-- Unica zona/tipo del movil -> su aporte normalizado es 1 (peso/w=1/1).
-- =====================================================================
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('10', 100, 1000, 'URGENTE', 1);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 10, DATE '2026-07-29', true);

-- Cascada por defecto: con datos suficientes de chofer, gana CHOFER.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'CHOFER' THEN RAISE EXCEPTION 'esperaba CHOFER, obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok cascada default gana CHOFER';
END $$;

-- Sacando CHOFER de la lista, el mismo dato debe resolver por MOVIL.
UPDATE demoras_config SET ritmo_cascada='MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'MOVIL' THEN RAISE EXCEPTION 'esperaba MOVIL, obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok orden configurable saltea CHOFER';
END $$;

-- Lista solo con ZONA: debe resolver por ZONA, y caer a GLOBAL si no alcanza.
UPDATE demoras_config SET ritmo_cascada='ZONA' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'GLOBAL' THEN RAISE EXCEPTION 'GLOBAL debe ser la red final, obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok GLOBAL es red final aunque no este en la lista';
END $$;

-- Lista basura: cae al default sin romper.
UPDATE demoras_config SET ritmo_cascada='FRUTA,,XX' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS NULL THEN RAISE EXCEPTION 'lista basura no debe romper'; END IF;
  RAISE NOTICE 'ok lista invalida cae al default';
END $$;
UPDATE demoras_config SET ritmo_cascada='CHOFER,MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
