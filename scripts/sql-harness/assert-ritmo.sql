\set ON_ERROR_STOP on
-- moviles_dia se trunca aca tambien (fix round 1, Important 5): este
-- archivo inserta PKs (escenario_id, movil_id, fecha) que assert-run.sql
-- deja sin limpiar al final (nunca vuelve a truncar despues de su
-- TRUNCATE inicial). Sin esto, corriendo assert-run.sql antes que este
-- archivo en la misma invocacion del harness, el INSERT de mas abajo
-- (movil 10, 2026-07-29) choca con duplicate key. Autocontenido: no
-- depende de que se corra en un orden particular.
TRUNCATE moviles_zonas, moviles_dia;
TRUNCATE metricas_cumplimiento;
-- Defensivo (fix round 1, Important 5): no asumir que quien corrio antes
-- restauro peso_transito_alpha a 0.3. El assert de blend ponderado de
-- mas abajo calcula el numero esperado a mano asumiendo alpha=0.3.
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
-- Los asserts historicos de este archivo afirman estadisticas sobre
-- demora_efectiva_mins, asi que fijan la metrica vieja explicitamente en vez
-- de depender del default (que es ENTRE_ENTREGAS).
UPDATE demoras_modelo SET ritmo_metrica = 'ASIGNADO_A_ENTREGA' WHERE escenario_id = 1000;

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
  -- Con 5 muestras (10,20,30,40,100) el p90 es un numero real (76) y TIENE
  -- que superar la mediana (30). El guard anterior era `IS DISTINCT FROM
  -- NULL AND ...`: si el dia de manana la funcion devolviera NULL en
  -- ritmo_p90 para una zona con muestras suficientes, el assert lo dejaba
  -- pasar en silencio en vez de reprobarlo. Un NULL aca es exactamente el
  -- bug que este assert existe para atrapar, asi que se afirma, no se
  -- enmascara.
  IF r.ritmo_p90 IS NULL OR r.ritmo_p90 <= r.ritmo_mediana THEN
    RAISE EXCEPTION 'p90 debe existir y superar la mediana: p90=% mediana=%', r.ritmo_p90, r.ritmo_mediana;
  END IF;
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

-- CRITICAL 1 (fix round 1): 'GLOBAL' sola NO es lista vacia/mal formada,
-- es una configuracion valida (linea base estable cuando los datos de
-- chofer no son confiables). Zona 100 tiene de sobra para CHOFER/MOVIL/
-- ZONA (fixture de arriba): si 'GLOBAL' cayera al default completo por
-- error, esto resolveria CHOFER, no GLOBAL.
UPDATE demoras_config SET ritmo_cascada='GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'GLOBAL' THEN
    RAISE EXCEPTION 'cascada=GLOBAL debio resolver por GLOBAL (hay CHOFER/MOVIL/ZONA disponibles): obtuvo % -- GLOBAL solo esta cayendo al default completo, que es lo opuesto de lo configurado', r.ritmo_origen;
  END IF;
  RAISE NOTICE 'ok GLOBAL sola es una cascada valida, no dispara el fallback a default';
END $$;

-- Lista basura: cae al default completo (IMPORTANT 7, fix round 1: antes
-- este assert solo chequeaba IS NOT NULL, que nunca puede fallar porque
-- GLOBAL siempre se agrega -- no probaba nada. Con el fixture de zona
-- 100 (chofer ANA con 5 hechos) el default completo debe resolver
-- CHOFER, asi que ahora el assert puede efectivamente detectar que NO
-- cayo al default).
UPDATE demoras_config SET ritmo_cascada='FRUTA,,XX' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'CHOFER' THEN RAISE EXCEPTION 'lista basura debio caer al default completo (CHOFER,MOVIL,ZONA,GLOBAL -> gana CHOFER), obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok lista invalida cae al default completo (gana CHOFER, no solo "no es NULL")';
END $$;
UPDATE demoras_config SET ritmo_cascada='CHOFER,MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';

-- =====================================================================
-- CRITICAL 2 (fix round 1): el blend ponderado tiene que dar un NUMERO
-- exacto, no solo un origen. Los 4 asserts de arriba usan un unico
-- movil de peso 1 cuyos hechos son exactamente los de la zona: CHOFER,
-- MOVIL y ZONA dan la misma media/mediana ahi, asi que un denominador
-- mal armado, un FILTER cruzado o alpha ignorado pasarian igual.
--
-- Zona 500 SERVICE, dos moviles:
--   movil 50: PRIORIDAD, unica zona (500)              -> peso_norm = 1/1    = 1.00
--   movil 51: TRANSITO, repartido en 4 zonas (500..503) -> peso_norm = 0.3/(0.3*4) = 0.25
-- Choferes con ritmos bien distintos: CARLOS (movil 50) siempre 100,
-- DIEGO (movil 51) siempre 20 -- con todos los valores iguales dentro de
-- cada chofer, media=mediana=p75=p90 exactos, sin ambiguedad de
-- interpolacion.
--
-- blend = (1.00*100 + 0.25*20) / (1.00 + 0.25) = 105 / 1.25 = 84.00
--
-- Si el denominador no se normalizara (promedio simple) daria 60.00. Si
-- el FILTER se comiera un movil, daria 100.00 o 20.00 puros. Si alpha
-- se ignorara (peso_norm=1 para los dos) tambien daria 60.00.
-- =====================================================================
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('50', 500, 1000, 'SERVICE', 1),
  ('51', 500, 1000, 'SERVICE', 2),
  ('51', 501, 1000, 'SERVICE', 2),
  ('51', 502, 1000, 'SERVICE', 2),
  ('51', 503, 1000, 'SERVICE', 2);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 50, DATE '2026-07-29', true),
  (1000, 51, DATE '2026-07-29', true);
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 8000+g, 1000, DATE '2026-07-28', 'SERVICE', 50, 500, 'CARLOS',
       now(), 100.0, 100.0, 'CAMPO'
FROM generate_series(1,5) g;
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 8100+g, 1000, DATE '2026-07-28', 'SERVICE', 51, 500, 'DIEGO',
       now(), 20.0, 20.0, 'CAMPO'
FROM generate_series(1,5) g;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=500 AND tipo_servicio='SERVICE';
  IF r.ritmo_origen <> 'CHOFER' THEN RAISE EXCEPTION 'zona 500 SERVICE esperaba CHOFER, obtuvo %', r.ritmo_origen; END IF;
  IF r.ritmo_muestras IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'zona 500 SERVICE muestras: % (esperaba 10 = 5 CARLOS + 5 DIEGO)', r.ritmo_muestras; END IF;
  IF round(r.ritmo_media,2)   IS DISTINCT FROM 84.00 THEN RAISE EXCEPTION 'blend ponderado media: % (esperaba 84.00 = (1.00*100 + 0.25*20)/1.25)', r.ritmo_media; END IF;
  IF round(r.ritmo_mediana,2) IS DISTINCT FROM 84.00 THEN RAISE EXCEPTION 'blend ponderado mediana: % (esperaba 84.00)', r.ritmo_mediana; END IF;
  IF round(r.ritmo_p75,2)     IS DISTINCT FROM 84.00 THEN RAISE EXCEPTION 'blend ponderado p75: % (esperaba 84.00)', r.ritmo_p75; END IF;
  IF round(r.ritmo_p90,2)     IS DISTINCT FROM 84.00 THEN RAISE EXCEPTION 'blend ponderado p90: % (esperaba 84.00)', r.ritmo_p90; END IF;
  RAISE NOTICE 'ok blend ponderado CHOFER: valor numerico exacto verificado (84.00)';
END $$;

-- IMPORTANT 3 (fix round 1): un mismo chofer puede manejar mas de un
-- movil de la zona (metricas_cumplimiento.chofer es texto libre del
-- AS400, se repite entre camiones de la misma fletera tercerizada).
-- FEDERICO maneja el movil 70 (3 hechos) y el movil 71 (3 hechos) en la
-- zona 700, ambos SERVICE, ambos prioridad (peso_norm=1 cada uno). Sus
-- muestras deben contarse UNA sola vez (6), no una vez por movil (12).
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('70', 700, 1000, 'SERVICE', 1),
  ('71', 700, 1000, 'SERVICE', 1);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 70, DATE '2026-07-29', true),
  (1000, 71, DATE '2026-07-29', true);
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 8200+g, 1000, DATE '2026-07-28', 'SERVICE',
       CASE WHEN g<=3 THEN 70 ELSE 71 END, 700, 'FEDERICO',
       now(), 50.0, 50.0, 'CAMPO'
FROM generate_series(1,6) g;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=700 AND tipo_servicio='SERVICE';
  IF r.ritmo_origen <> 'CHOFER' THEN RAISE EXCEPTION 'zona 700 esperaba CHOFER, obtuvo %', r.ritmo_origen; END IF;
  IF r.ritmo_muestras IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'muestras del chofer compartido: % (esperaba 6; un chofer manejando 2 moviles no debe duplicar sus muestras)', r.ritmo_muestras; END IF;
  RAISE NOTICE 'ok chofer compartido entre 2 moviles: muestras no se duplican (6, no 12)';
END $$;

-- IMPORTANT 4 (fix round 1): con peso_transito_alpha=0 (soportado por el
-- CHECK y documentado), un movil de transito puro termina con
-- peso_norm=0. Zona 600 SERVICE, movil 60 TRANSITO en su unica zona:
-- con alpha=0, w=0 -> peso_norm=0. El chofer ELENA maneja el movil 60 y
-- tiene 5 hechos (tambien alimentan la zona, asi que ZONA si tiene
-- datos propios). Con el bug, CHOFER ganaria (n=5>=5) con las 4
-- estadisticas en NULL. Con el fix, CHOFER (y MOVIL) no cuentan esas
-- muestras (peso 0), caen a ZONA, que si tiene datos.
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('60', 600, 1000, 'SERVICE', 2);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 60, DATE '2026-07-29', true);
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 8300+g, 1000, DATE '2026-07-28', 'SERVICE', 60, 600, 'ELENA',
       now(), 77.0, 77.0, 'CAMPO'
FROM generate_series(1,5) g;

UPDATE escenario_settings SET peso_transito_alpha = 0 WHERE escenario_id = 1000;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=600 AND tipo_servicio='SERVICE';
  IF r.ritmo_origen <> 'ZONA' THEN RAISE EXCEPTION 'zona 600 con alpha=0 esperaba ZONA (CHOFER/MOVIL sin peso real no deben ganar), obtuvo %', r.ritmo_origen; END IF;
  IF round(r.ritmo_media,2) IS DISTINCT FROM 77.00 THEN RAISE EXCEPTION 'zona 600 media: % (esperaba 77.00 del nivel ZONA, no NULL de un CHOFER sin peso)', r.ritmo_media; END IF;
  RAISE NOTICE 'ok alpha=0 sobre transito puro no gana la cascada con estadisticas NULL (cae a ZONA)';
END $$;
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;

-- IMPORTANT 6 (fix round 1): la resolucion es POR TIPO. URGENTE (zona
-- 100) y SERVICE (zona 500) configurados con cascadas DISTINTAS tienen
-- que resolver distinto EN LA MISMA corrida (mismo momento, dos
-- llamados a la misma funcion). Si alguien sacara el filtro por tipo de
-- la lectura de demoras_config, las dos convergerian.
UPDATE demoras_config SET ritmo_cascada='ZONA'                    WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
UPDATE demoras_config SET ritmo_cascada='CHOFER,MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='SERVICE';
DO $$
DECLARE r_urg record; r_srv record;
BEGIN
  SELECT * INTO r_urg FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  SELECT * INTO r_srv FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=500 AND tipo_servicio='SERVICE';
  IF r_urg.ritmo_origen <> 'ZONA' THEN
    RAISE EXCEPTION 'URGENTE (cascada=ZONA) esperaba ZONA, obtuvo % -- hay CHOFER disponible con datos suficientes: si esto da CHOFER, la cascada de un tipo se esta filtrando con la de otro', r_urg.ritmo_origen;
  END IF;
  IF r_srv.ritmo_origen <> 'CHOFER' THEN
    RAISE EXCEPTION 'SERVICE (cascada=CHOFER,MOVIL,ZONA,GLOBAL) esperaba CHOFER, obtuvo %', r_srv.ritmo_origen;
  END IF;
  RAISE NOTICE 'ok cascada aislada por tipo: URGENTE y SERVICE resuelven distinto en la misma corrida';
END $$;
UPDATE demoras_config SET ritmo_cascada='CHOFER,MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';

-- ─── Los parametros salen de demoras_modelo, no de la firma ──────────

-- ritmo_min_muestras es parametro: con el minimo en 2, la zona 200 (que
-- tiene 2 hechos y hoy cae a GLOBAL) tiene que resolverse por ZONA.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET ritmo_min_muestras = 2 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'ZONA' THEN
    RAISE EXCEPTION 'con min_muestras=2 la zona 200 debio resolver por ZONA, dio %', r.ritmo_origen;
  END IF;
  UPDATE demoras_modelo SET ritmo_min_muestras = 5 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok ritmo_min_muestras es parametro';
END $$;

-- ritmo_dias_ventana es parametro. Se afirma sobre ritmo_MUESTRAS y NO sobre
-- ritmo_origen, a proposito: para cuando corren estos bloques el archivo ya
-- sembro moviles_dia (movil 10, chofer ANA, zona 100), asi que los niveles
-- CHOFER y MOVIL tienen aporte y ganan la cascada antes que ZONA. Que nivel
-- gane es asunto del bloque de cascada, no de este.
--
-- Y hay una razon mas fuerte: los 5 hechos de ANA caen todos en el 2026-07-28,
-- el unico dia que entra en una ventana de 1, asi que CHOFER gana igual con
-- la ventana recortada. Un assert sobre el origen daria el mismo resultado
-- aunque ritmo_dias_ventana no fuera parametrizable en absoluto -- seria un
-- test que no puede fallar. Lo que este bloque tiene que probar es que mover
-- la ventana cambia QUE HECHOS VE la funcion, y eso se ve en las muestras.
DO $$
DECLARE r_dentro record; r_fuera record;
BEGIN
  UPDATE demoras_modelo SET ritmo_dias_ventana = 1 WHERE escenario_id = 1000;

  -- Ventana de 1 dia sobre 2026-07-29 = [2026-07-28, 2026-07-28], que es
  -- justo donde estan los hechos: tiene que verlos.
  SELECT * INTO r_dentro FROM demoras_ritmo(1000, DATE '2026-07-29')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF coalesce(r_dentro.ritmo_muestras, 0) = 0 THEN
    RAISE EXCEPTION 'ventana 1 dia sobre 2026-07-29 debio ver los hechos del 28, dio % muestras',
                    r_dentro.ritmo_muestras;
  END IF;

  -- La MISMA ventana de 1 dia, corrida dos dias = [2026-07-30, 2026-07-30],
  -- donde no hay ningun hecho. Si la ventana no se estuviera aplicando, este
  -- chequeo veria los mismos hechos que el anterior.
  SELECT * INTO r_fuera FROM demoras_ritmo(1000, DATE '2026-07-31')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r_fuera.ritmo_muestras IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ventana 1 dia sobre 2026-07-31 no debio ver nada, dio % muestras',
                    r_fuera.ritmo_muestras;
  END IF;

  UPDATE demoras_modelo SET ritmo_dias_ventana = 7 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok ritmo_dias_ventana es parametro (% muestras dentro, % fuera)',
               r_dentro.ritmo_muestras, r_fuera.ritmo_muestras;
END $$;

-- ritmo_metrica es parametro: con ENTRE_ENTREGAS los hechos de este assert
-- (todos con la misma fch_hora_finalizacion) no producen ningun intervalo
-- valido, asi que no hay muestras y cae a DEFECTO. Es la prueba de que la
-- funcion realmente cambia de fuente y no ignora el parametro.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.ritmo_muestras <> 0 THEN
    RAISE EXCEPTION 'con ENTRE_ENTREGAS no debia haber muestras, dio %', r.ritmo_muestras;
  END IF;
  UPDATE demoras_modelo SET ritmo_metrica = 'ASIGNADO_A_ENTREGA' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok ritmo_metrica es parametro';
END $$;

-- Restaurar el default para no ensuciar asserts posteriores.
UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS' WHERE escenario_id = 1000;

-- =====================================================================
-- Fix round 1 (Task 2, piso del ritmo): probar que el piso llega de PUNTA A
-- PUNTA, no solo que demoras_ritmo_muestras lo respeta. No alcanza con que
-- la funcion de muestras filtre si demoras_ritmo_movil no lee
-- demoras_modelo.ritmo_hueco_min_minutos y lo pasa -- eso es justo lo que
-- rompio el fix round 1 de la Task 2 (demoras_ritmo y demoras_ritmo_movil
-- seguian llamando con 6 argumentos).
--
-- Movil 90, chofer GARCIA, zona 900 URGENTE (zona/movil/chofer nuevos, sin
-- pisar los fixtures de arriba): dos entregas separadas por 1 minuto -> un
-- unico intervalo de 1 minuto.
--
-- ritmo_min_muestras baja a 1 para que ESE unico intervalo alcance para
-- tener "ritmo propio" cuando el piso lo deja pasar -- lo que este bloque
-- prueba es el piso, no el minimo de muestras.
-- =====================================================================
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_asignado, fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
VALUES
  ('PEDIDO', 9000, 1000, DATE '2026-07-28', 'URGENTE', 90, 900, 'GARCIA',
   timestamptz '2026-07-28 10:00:00-03', timestamptz '2026-07-28 10:00:00-03', 0, 0, 'CAMPO'),
  ('PEDIDO', 9001, 1000, DATE '2026-07-28', 'URGENTE', 90, 900, 'GARCIA',
   timestamptz '2026-07-28 10:00:00-03', timestamptz '2026-07-28 10:01:00-03', 1, 1, 'CAMPO');

DO $$
DECLARE v_con_piso_0 integer; v_con_piso_5 integer;
BEGIN
  UPDATE demoras_modelo SET ritmo_min_muestras = 1 WHERE escenario_id = 1000;

  -- Piso 0: el intervalo de 1 minuto entra -> el movil 90 tiene ritmo propio.
  UPDATE demoras_modelo SET ritmo_hueco_min_minutos = 0 WHERE escenario_id = 1000;
  SELECT count(*) INTO v_con_piso_0
    FROM demoras_ritmo_movil(1000, DATE '2026-07-29')
   WHERE movil = 90 AND tipo_servicio = 'URGENTE';
  IF v_con_piso_0 <> 1 THEN
    RAISE EXCEPTION 'con ritmo_hueco_min_minutos=0 el movil 90 debio tener ritmo propio (1 fila), dio %', v_con_piso_0;
  END IF;

  -- Piso 5: el mismo intervalo de 1 minuto queda descartado -> el movil se
  -- queda sin muestras, deja de tener ritmo propio, y el llamador real
  -- (demoras_servidores) cae al ritmo de la zona.
  UPDATE demoras_modelo SET ritmo_hueco_min_minutos = 5 WHERE escenario_id = 1000;
  SELECT count(*) INTO v_con_piso_5
    FROM demoras_ritmo_movil(1000, DATE '2026-07-29')
   WHERE movil = 90 AND tipo_servicio = 'URGENTE';
  IF v_con_piso_5 <> 0 THEN
    RAISE EXCEPTION 'con ritmo_hueco_min_minutos=5 el movil 90 no debio tener ritmo propio (0 filas), dio %', v_con_piso_5;
  END IF;

  UPDATE demoras_modelo SET ritmo_min_muestras = 5, ritmo_hueco_min_minutos = 5 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok el piso viaja de punta a punta: demoras_modelo -> demoras_ritmo_movil -> demoras_ritmo_muestras (piso 0 = ritmo propio, piso 5 = cae a la zona)';
END $$;
