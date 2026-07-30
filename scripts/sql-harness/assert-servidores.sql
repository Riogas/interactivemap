\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
UPDATE demoras_modelo SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', transito_modo = 'IGUAL'
 WHERE escenario_id = 1000;

-- M1 prioridad en 100. M2 prioridad en 100 y TRANSITO en 200. M3 prioridad en 200.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000, '1', 100, 'URGENTE', 1, true),
       (1000, '2', 100, 'URGENTE', 1, true),
       (1000, '2', 200, 'URGENTE', 2, true),
       (1000, '3', 200, 'URGENTE', 1, true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 1, DATE '2026-07-30', true),
       (1000, 2, DATE '2026-07-30', true),
       (1000, 3, DATE '2026-07-30', true);

-- Carga: M1 lleva 3 pedidos (zona 100), M2 lleva 1 (zona 200), M3 lleva 2 (zona 200).
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,100,1,DATE '2026-07-30'),
       (2,1000,'URGENTE',1,100,1,DATE '2026-07-30'),
       (3,1000,'URGENTE',1,100,1,DATE '2026-07-30'),
       (4,1000,'URGENTE',2,200,1,DATE '2026-07-30'),
       (5,1000,'URGENTE',3,200,1,DATE '2026-07-30'),
       (6,1000,'URGENTE',3,200,1,DATE '2026-07-30');

-- Ritmo propio por movil: M1=20, M2=15, M3=25. Cinco hechos cada uno para
-- superar ritmo_min_muestras y ganar el nivel MOVIL de la cascada.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 1000 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, m.zona, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (1,100,20.0),(2,100,15.0),(3,200,25.0)) AS m(movil, zona, r),
     generate_series(1,5) g;

-- 0) El ritmo es PROPIO de cada movil, no el blend de la zona. Sin esto, M1
--    y M2 (que comparten la zona 100) tendrian el mismo numero y el modelo
--    perderia lo unico que distingue un movil rapido de uno lento.
DO $$
DECLARE r1 record; r2 record;
BEGIN
  SELECT * INTO r1 FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 1 AND tipo_servicio = 'URGENTE';
  SELECT * INTO r2 FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 2 AND tipo_servicio = 'URGENTE';
  IF round(r1.ritmo_mediana) IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'ritmo propio de M1: % (esperaba 20)', r1.ritmo_mediana;
  END IF;
  IF round(r2.ritmo_mediana) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'ritmo propio de M2: % (esperaba 15)', r2.ritmo_mediana;
  END IF;
  IF r1.ritmo_mediana = r2.ritmo_mediana THEN
    RAISE EXCEPTION 'M1 y M2 comparten ritmo (%): el ritmo no es por movil', r1.ritmo_mediana;
  END IF;
  RAISE NOTICE 'ok ritmo propio por movil (M1=%, M2=%)', r1.ritmo_mediana, r2.ritmo_mediana;
END $$;

-- 0b) Un movil SIN historial propio no devuelve fila, para que el llamador
--     pueda caer al ritmo de la zona en vez de recibir un NULL ambiguo.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 4;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un movil sin historial devolvio % filas', v_n; END IF;
  RAISE NOTICE 'ok movil sin historial no devuelve fila';
END $$;

-- 0c) ritmo_min_muestras se aplica de verdad, no solo cuando no hay
--     historial: M5 con 4 muestras (una menos que el minimo default de 5)
--     NO debe devolver fila; subiendolo a 5 SI debe aparecer. Zona 999 y
--     movil 5 son exclusivos de este bloque -- no tocan zona 100/200 ni
--     los moviles 1-4 que usan los demas bloques.
DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  SELECT 'PEDIDO', 7000 + g, 1000, DATE '2026-07-29', 'URGENTE',
         5, 999, NULL, now(), 22.0, 22.0, 'CAMPO'
  FROM generate_series(1,4) g;

  SELECT count(*) INTO v_n FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 5;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'M5 con 4 muestras (bajo el minimo) devolvio % filas', v_n;
  END IF;

  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  VALUES ('PEDIDO', 7005, 1000, DATE '2026-07-29', 'URGENTE', 5, 999, NULL,
          now(), 22.0, 22.0, 'CAMPO');

  SELECT count(*) INTO v_n FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 5;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M5 con 5 muestras (alcanza el minimo) devolvio % filas', v_n;
  END IF;
  RAISE NOTICE 'ok ritmo_min_muestras se aplica (4 no alcanza, 5 si)';
END $$;

-- 0d) El primer nivel de la cascada, CHOFER, tiene que poder ganar. La
--     chofer ANA maneja el movil 6 (5 muestras a 20) y tambien el movil 8
--     (5 muestras a 40): su ritmo propio (blend de ambos, mediana 30) tiene
--     que ganarle al ritmo propio de M6 solo (20) y distinguirse de el --
--     si dieran lo mismo, el assert no podria saber que nivel gano.
--     Movil 6/8 y zona 999 son exclusivos de este bloque.
DO $$
DECLARE r record;
BEGIN
  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  SELECT 'PEDIDO', 7100 + g, 1000, DATE '2026-07-29', 'URGENTE',
         6, 999, 'ANA', now(), 20.0, 20.0, 'CAMPO'
  FROM generate_series(1,5) g;

  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  SELECT 'PEDIDO', 7200 + g, 1000, DATE '2026-07-29', 'URGENTE',
         8, 999, 'ANA', now(), 40.0, 40.0, 'CAMPO'
  FROM generate_series(1,5) g;

  SELECT * INTO r FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 6 AND tipo_servicio = 'URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'CHOFER' THEN
    RAISE EXCEPTION 'M6 ritmo_origen: % (esperaba CHOFER, ANA tiene historial propio suficiente)', r.ritmo_origen;
  END IF;
  IF round(r.ritmo_mediana) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'M6 ritmo via CHOFER: % (esperaba 30, el blend de ANA en M6+M8)', r.ritmo_mediana;
  END IF;
  RAISE NOTICE 'ok nivel CHOFER gana con historial propio (M6 via ANA = %)', r.ritmo_mediana;
END $$;

-- 1) libre_en = carga x ritmo, con la carga contada en TODAS las zonas.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r.carga IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'M1 carga: % (esperaba 3)', r.carga; END IF;
  IF round(r.ritmo) IS DISTINCT FROM 20 THEN RAISE EXCEPTION 'M1 ritmo: % (esperaba 20)', r.ritmo; END IF;
  IF r.ritmo_origen IS DISTINCT FROM 'MOVIL' THEN
    RAISE EXCEPTION 'M1 ritmo_origen: % (esperaba MOVIL, tiene historial propio)', r.ritmo_origen;
  END IF;
  IF round(r.libre_en) IS DISTINCT FROM 60 THEN RAISE EXCEPTION 'M1 libre_en: % (esperaba 60)', r.libre_en; END IF;

  -- M2 tiene su unico pedido en la zona 200, pero en la zona 100 su
  -- libre_en tiene que reflejar ese trabajo igual: es el mismo camion.
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.carga IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M2 en zona 100 carga: % (esperaba 1: su pedido de la zona 200 tambien lo ocupa)', r.carga;
  END IF;
  IF round(r.libre_en) IS DISTINCT FROM 15 THEN RAISE EXCEPTION 'M2 libre_en: % (esperaba 15)', r.libre_en; END IF;
  RAISE NOTICE 'ok libre_en con carga de todas las zonas';
END $$;

-- 2) Un movil INACTIVO no es servidor.
DO $$
DECLARE v_n integer;
BEGIN
  UPDATE moviles_dia SET activo = false WHERE movil_id = 1 AND fecha = DATE '2026-07-30';
  SELECT count(*) INTO v_n FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND movil = 1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un movil inactivo aparecio como servidor'; END IF;
  UPDATE moviles_dia SET activo = true WHERE movil_id = 1 AND fecha = DATE '2026-07-30';
  RAISE NOTICE 'ok inactivo no es servidor';
END $$;

-- 3) es_transito se marca bien.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF NOT r.es_transito THEN RAISE EXCEPTION 'M2 en zona 200 debio marcarse como transito'; END IF;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.es_transito THEN RAISE EXCEPTION 'M2 en zona 100 es prioridad, no transito'; END IF;
  RAISE NOTICE 'ok rol prioridad/transito';
END $$;

-- 4) transito_modo = CASTIGO: al transito se le suman los minutos de desvio.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET transito_modo = 'CASTIGO', transito_castigo_minutos = 20
   WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF round(r.libre_en) IS DISTINCT FROM 35 THEN
    RAISE EXCEPTION 'CASTIGO: libre_en % (esperaba 15 + 20 = 35)', r.libre_en;
  END IF;
  RAISE NOTICE 'ok transito CASTIGO';
END $$;

-- 5) transito_modo = ALPHA: el libre_en se estira dividiendo por alpha.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET transito_modo = 'ALPHA' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF round(r.libre_en) IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'ALPHA: libre_en % (esperaba 15 / 0.3 = 50)', r.libre_en;
  END IF;
  RAISE NOTICE 'ok transito ALPHA';
END $$;

-- 6) transito_modo = SOLO_SI_NO_HAY: M3 (prioridad) se libera a los 50 y M2
--    (transito) a los 15. Con margen 15, la prioridad NO llega dentro del
--    margen del transito (15 + 15 = 30 < 50), asi que el transito entra.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET transito_modo = 'SOLO_SI_NO_HAY', transito_margen_minutos = 15
   WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.descartado THEN RAISE EXCEPTION 'con la prioridad a 50 y margen 15, el transito debio entrar'; END IF;

  -- Ahora M3 queda libre ya (le sacamos sus pedidos): 0 <= 15 + 15, entra la
  -- prioridad y el transito sobra.
  DELETE FROM pedidos WHERE movil = 3;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF NOT r.descartado THEN
    RAISE EXCEPTION 'con una prioridad libre ya, el transito debio quedar descartado';
  END IF;
  RAISE NOTICE 'ok transito SOLO_SI_NO_HAY';
END $$;

UPDATE demoras_modelo SET transito_modo = 'SOLO_SI_NO_HAY', ritmo_metrica = 'ENTRE_ENTREGAS'
 WHERE escenario_id = 1000;
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
