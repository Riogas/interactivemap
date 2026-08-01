\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', dedicacion_transito = 0.20,
       transito_dedicacion_max_total = 0.60, traslado_fuera_zona_minutos = 15,
       estadistico = 'MEDIANA'
 WHERE escenario_id = 1000;

-- M1: prioridad en 100. Nada mas -> p_j = 1,00
-- M2: prioridad en 100, transito en 200 -> 0,80 en 100 y 0,20 en 200
-- M3: prioridad en 100, transito en 200/300/400/500 -> los 4 transitos suman
--     0,80 > 0,60, se achican a 0,15 c/u; la prioridad queda con 0,40
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'1',100,'URGENTE',1,true),
       (1000,'2',100,'URGENTE',1,true), (1000,'2',200,'URGENTE',2,true),
       (1000,'3',100,'URGENTE',1,true), (1000,'3',200,'URGENTE',2,true),
       (1000,'3',300,'URGENTE',2,true), (1000,'3',400,'URGENTE',2,true),
       (1000,'3',500,'URGENTE',2,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,1,DATE '2026-08-01',true),(1000,2,DATE '2026-08-01',true),(1000,3,DATE '2026-08-01',true);

-- Ritmo propio: los tres a 20 min (5 hechos c/u para ganar el nivel MOVIL).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 100 + g*10 + m, 1000, DATE '2026-07-31', 'URGENTE', m, 100, NULL,
       now(), 20.0, 20.0, 'CAMPO'
FROM generate_series(1,3) m, generate_series(1,5) g;

-- Carga: M1 tiene 2 pedidos EN la zona 100 (no cuentan para r_j);
--        M2 tiene 3 pedidos en la zona 200 (fuera -> si cuentan).
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,100,1,DATE '2026-08-01'),
       (2,1000,'URGENTE',1,100,1,DATE '2026-08-01'),
       (3,1000,'URGENTE',2,200,1,DATE '2026-08-01'),
       (4,1000,'URGENTE',2,200,1,DATE '2026-08-01'),
       (5,1000,'URGENTE',2,200,1,DATE '2026-08-01');

-- 1) p_j del movil exclusivo.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r.p_j IS DISTINCT FROM 1.00 THEN
    RAISE EXCEPTION 'M1 p_j: % (esperaba 1,00, es exclusivo de la zona 100)', r.p_j;
  END IF;
  IF r.es_transito THEN RAISE EXCEPTION 'M1 no es transito en su propia zona'; END IF;
  RAISE NOTICE 'ok p_j del movil exclusivo (M1=%)', r.p_j;
END $$;

-- 2) p_j con un transito: M2 reparte 0,80 prioridad / 0,20 transito.
DO $$
DECLARE r_pri record; r_tra record;
BEGIN
  SELECT * INTO r_pri FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  SELECT * INTO r_tra FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r_pri.p_j IS DISTINCT FROM 0.80 THEN
    RAISE EXCEPTION 'M2 p_j en 100 (prioridad): % (esperaba 0,80)', r_pri.p_j;
  END IF;
  IF r_tra.p_j IS DISTINCT FROM 0.20 THEN
    RAISE EXCEPTION 'M2 p_j en 200 (transito): % (esperaba 0,20)', r_tra.p_j;
  END IF;
  IF r_pri.es_transito THEN RAISE EXCEPTION 'M2 en 100 es prioridad, no transito'; END IF;
  IF NOT r_tra.es_transito THEN RAISE EXCEPTION 'M2 en 200 es transito, no prioridad'; END IF;
  RAISE NOTICE 'ok p_j con un transito (M2: %/%)', r_pri.p_j, r_tra.p_j;
END $$;

-- 3) p_j con el tope activo: EL BLOQUE QUE PRUEBA EL TOPE. Los 4 transitos de
--    M3 darian 0,80 (4 x 0,20), pero el tope de 0,60 los achica a prorrata:
--    0,15 cada uno. La prioridad se queda con lo que sobra: 1 - 0,60 = 0,40.
DO $$
DECLARE r_pri record; r_200 record; r_300 record; r_400 record; r_500 record;
BEGIN
  SELECT * INTO r_pri FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 3;
  SELECT * INTO r_200 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 3;
  SELECT * INTO r_300 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 300 AND tipo_servicio = 'URGENTE' AND movil = 3;
  SELECT * INTO r_400 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 400 AND tipo_servicio = 'URGENTE' AND movil = 3;
  SELECT * INTO r_500 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 500 AND tipo_servicio = 'URGENTE' AND movil = 3;

  IF r_pri.p_j IS DISTINCT FROM 0.40 THEN
    RAISE EXCEPTION 'M3 p_j en 100 (prioridad, con tope activo): % (esperaba 0,40 = 1 - 0,60)', r_pri.p_j;
  END IF;
  IF r_200.p_j IS DISTINCT FROM 0.15 OR r_300.p_j IS DISTINCT FROM 0.15
     OR r_400.p_j IS DISTINCT FROM 0.15 OR r_500.p_j IS DISTINCT FROM 0.15 THEN
    RAISE EXCEPTION 'M3 p_j en transitos: %/%/%/% (esperaba 0,15 cada uno = 0,60 / 4, topeado)',
      r_200.p_j, r_300.p_j, r_400.p_j, r_500.p_j;
  END IF;
  IF (r_200.p_j + r_300.p_j + r_400.p_j + r_500.p_j) IS DISTINCT FROM 0.60 THEN
    RAISE EXCEPTION 'la suma de los transitos de M3 debio quedar en el tope 0,60, dio %',
      (r_200.p_j + r_300.p_j + r_400.p_j + r_500.p_j);
  END IF;
  RAISE NOTICE 'ok p_j con el tope activo (M3: prioridad=%, transitos=%/%/%/%)',
    r_pri.p_j, r_200.p_j, r_300.p_j, r_400.p_j, r_500.p_j;
END $$;

-- 4) r_j NO cuenta los pedidos de la propia zona. M1 tiene 2 pedidos en la
--    zona 100 (su propia zona): si se contaran, r_j daria 2 x 20 = 40. Tiene
--    que dar 0 -- es el cambio central respecto del modelo anterior.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r.carga_fuera IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'M1 carga_fuera: % (esperaba 0: sus 2 pedidos estan DENTRO de la zona 100)', r.carga_fuera;
  END IF;
  IF r.r_j IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'M1 r_j: % (esperaba 0, NO 40 -- los pedidos de la propia zona son demanda de la zona, no cuentan aca)', r.r_j;
  END IF;
  RAISE NOTICE 'ok r_j no cuenta los pedidos de la propia zona (M1 r_j=%)', r.r_j;
END $$;

-- 5) r_j cuenta los de AFUERA mas el traslado. M2 en la zona 100 tiene 3
--    pedidos en la 200 (afuera): 3 x 20 + 15 = 75.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.carga_fuera IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'M2 carga_fuera: % (esperaba 3, sus 3 pedidos de la zona 200)', r.carga_fuera;
  END IF;
  IF r.r_j IS DISTINCT FROM 75 THEN
    RAISE EXCEPTION 'M2 r_j: % (esperaba 75 = 3 x 20 + 15)', r.r_j;
  END IF;
  RAISE NOTICE 'ok r_j cuenta los de afuera mas el traslado (M2 r_j=%)', r.r_j;
END $$;

-- 6) El traslado se suma UNA sola vez, no por pedido. Con traslado=0, M2 baja
--    de 75 a 60 (solo 3 x 20). Con traslado=30, tiene que dar 90 (3 x 20 + 30),
--    no 3 x 20 + 3 x 30 = 150 (que seria cobrarlo por cada pedido).
DO $$
DECLARE r2 record;
BEGIN
  UPDATE demoras_modelo SET traslado_fuera_zona_minutos = 0 WHERE escenario_id = 1000;
  SELECT * INTO r2 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r2.r_j IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'traslado=0: M2 r_j % (esperaba 60 = 3 x 20 + 0)', r2.r_j;
  END IF;

  UPDATE demoras_modelo SET traslado_fuera_zona_minutos = 30 WHERE escenario_id = 1000;
  SELECT * INTO r2 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r2.r_j IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'traslado=30: M2 r_j % (esperaba 90 = 3 x 20 + 30, NO 3 x 20 + 3 x 30 = 150)', r2.r_j;
  END IF;

  RAISE NOTICE 'ok el traslado se suma una sola vez (M2: 75 -> 60 con traslado=0, 90 con traslado=30)';
END $$;

-- 7) Un movil sin nada afuera (M1) no paga traslado, con NINGUN valor de
--    traslado configurado -- se prueba en los mismos tres valores que el
--    bloque 6 (0, 30, y de vuelta a 15).
DO $$
DECLARE r1 record;
BEGIN
  UPDATE demoras_modelo SET traslado_fuera_zona_minutos = 0 WHERE escenario_id = 1000;
  SELECT * INTO r1 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r1.r_j IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'traslado=0: M1 (sin nada afuera) r_j % (esperaba 0)', r1.r_j;
  END IF;

  UPDATE demoras_modelo SET traslado_fuera_zona_minutos = 30 WHERE escenario_id = 1000;
  SELECT * INTO r1 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r1.r_j IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'traslado=30: M1 (sin nada afuera) r_j % (esperaba 0, ningun traslado se le cobra)', r1.r_j;
  END IF;

  UPDATE demoras_modelo SET traslado_fuera_zona_minutos = 15 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok un movil sin nada afuera no paga traslado (M1 r_j=0 con cualquier traslado)';
END $$;

-- 8) mu_j = p_j / ritmo. M2 en la zona 100: 0,80 / 20 = 0,04.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF round(r.ritmo) IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'M2 ritmo: % (esperaba 20, su ritmo propio)', r.ritmo;
  END IF;
  IF r.ritmo_origen IS DISTINCT FROM 'MOVIL' THEN
    RAISE EXCEPTION 'M2 ritmo_origen: % (esperaba MOVIL, tiene historial propio)', r.ritmo_origen;
  END IF;
  IF r.mu_j IS DISTINCT FROM 0.04 THEN
    RAISE EXCEPTION 'M2 mu_j: % (esperaba 0,04 = 0,80 / 20)', r.mu_j;
  END IF;
  RAISE NOTICE 'ok mu_j = p_j / ritmo (M2 mu_j=%)', r.mu_j;
END $$;

-- 9) Un movil inactivo no aparece. M4, prioridad en la zona 100, pero
--    moviles_dia.activo = false.
DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
  VALUES (1000,'4',100,'URGENTE',1,true);
  INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
  VALUES (1000,4,DATE '2026-08-01',false);

  SELECT count(*) INTO v_n FROM demoras_aportes(1000, DATE '2026-08-01') WHERE movil = 4;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'un movil inactivo aparecio como aportante: % filas', v_n;
  END IF;
  RAISE NOTICE 'ok un movil inactivo no aparece';
END $$;

-- 10) BONUS (obligatorio por los Global Constraints de la task, no uno de los
--     9 del brief): la funcion tiene que sobrevivir a que falte la fila de
--     demoras_modelo para este escenario. El patron defensivo de la CTE cfg
--     (subconsulta escalar, nunca FROM demoras_modelo WHERE ... en un CTE
--     que despues se cruza) existe exactamente para esto: con un FROM/JOIN
--     plano, un escenario sin fila de configuracion deja el CTE vacio y el
--     CROSS JOIN de mas abajo colapsa la funcion entera a CERO filas -- la
--     demanda de un escenario entero desaparece sin ningun error.
DO $$
DECLARE r record; v_n integer;
BEGIN
  DELETE FROM demoras_modelo WHERE escenario_id = 1000;

  SELECT count(*) INTO v_n FROM demoras_aportes(1000, DATE '2026-08-01');
  IF v_n = 0 THEN
    RAISE EXCEPTION 'sin fila en demoras_modelo la funcion devolvio CERO filas: la demanda del escenario entero desaparecio';
  END IF;

  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r.p_j IS DISTINCT FROM 1.00 THEN
    RAISE EXCEPTION 'sin demoras_modelo, M1 p_j: % (esperaba 1,00: no tiene transitos, no depende de dedicacion_transito)', r.p_j;
  END IF;
  IF r.ritmo IS NULL THEN
    RAISE EXCEPTION 'sin demoras_modelo, ritmo quedo NULL: el movil desapareceria del calculo de mu_j sin dejar rastro';
  END IF;
  IF r.mu_j IS NULL THEN RAISE EXCEPTION 'sin demoras_modelo, mu_j quedo NULL'; END IF;
  IF r.r_j IS NULL THEN RAISE EXCEPTION 'sin demoras_modelo, r_j quedo NULL'; END IF;

  -- Restaurar: la fila 1000 vuelve a existir con los valores de la fixture,
  -- para no dejar rota la config de los bloques/archivos que corran despues
  -- en la misma cadena del harness.
  INSERT INTO demoras_modelo (escenario_id) VALUES (1000);
  UPDATE demoras_modelo
     SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', dedicacion_transito = 0.20,
         transito_dedicacion_max_total = 0.60, traslado_fuera_zona_minutos = 15,
         estadistico = 'MEDIANA'
   WHERE escenario_id = 1000;

  RAISE NOTICE 'ok sin fila en demoras_modelo la funcion degrada a los defaults, no a cero filas (p_j=%, ritmo=%, mu_j=%)', r.p_j, r.ritmo, r.mu_j;
END $$;

-- 11) BONUS (no es uno de los 9 del brief, pero cubre una de las tres reglas
--     explicitas): la carga de afuera cuenta CUALQUIER tipo de servicio, no
--     solo el que se esta calculando. M1 (r_j=0 en los bloques 4-7 porque no
--     tenia nada afuera) recibe un SERVICE pendiente en una zona ajena (150):
--     su r_j en la zona 100, calculado para URGENTE, tiene que subir a
--     1 x 20 + 15 = 35 -- el movil es un solo camion, un SERVICE lo ocupa
--     igual que un URGENTE. Se agrega al final para no alterar los r_j=0 de
--     M1 que ya verificaron los bloques anteriores.
DO $$
DECLARE r record;
BEGIN
  INSERT INTO services (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (200,1000,'SERVICE',1,150,1,DATE '2026-08-01');

  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r.carga_fuera IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M1 carga_fuera con un SERVICE afuera: % (esperaba 1)', r.carga_fuera;
  END IF;
  IF r.r_j IS DISTINCT FROM 35 THEN
    RAISE EXCEPTION 'M1 r_j con un SERVICE afuera: % (esperaba 35 = 1 x 20 + 15, un SERVICE cuenta igual que un URGENTE)', r.r_j;
  END IF;
  RAISE NOTICE 'ok la carga de afuera cuenta cualquier tipo de servicio (M1 r_j con 1 SERVICE afuera=%)', r.r_j;
END $$;

-- 12) FIX ROUND 1 -- el reparto de prioridad tiene que dividir por la
--     cantidad de zonas de prioridad, no solo restar el tope. Ningun movil
--     del fixture original tiene 2+ zonas de prioridad (M1/M2/M3 tienen
--     n_pri=1 cada uno), asi que sacar el "/ r.n_pri" del CASE de p_j no
--     movia ningun valor ya verificado -- (1 - suma_tra) / 1 = (1 - suma_tra).
--     Movil 5, zona propia, exclusivo de este bloque: 2 zonas de prioridad
--     (600, 700) + 1 transito (800). suma_tra = least(1 x 0,20, 0,60) = 0,20.
--     Cada prioridad = (1 - 0,20) / 2 = 0,40 (spec DEMORA_MODELO_TRAMOS.md
--     seccion 2, fila "2 prioridad + 1 transito"). Sin la division darian
--     0,80 cada una -- 1,80 en total para un solo movil.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'5',600,'URGENTE',1,true),
       (1000,'5',700,'URGENTE',1,true),
       (1000,'5',800,'URGENTE',2,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,5,DATE '2026-08-01',true);

DO $$
DECLARE r600 record; r700 record; r800 record;
BEGIN
  SELECT * INTO r600 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 600 AND tipo_servicio = 'URGENTE' AND movil = 5;
  SELECT * INTO r700 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE' AND movil = 5;
  SELECT * INTO r800 FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 800 AND tipo_servicio = 'URGENTE' AND movil = 5;

  IF r600.p_j IS DISTINCT FROM 0.40 OR r700.p_j IS DISTINCT FROM 0.40 THEN
    RAISE EXCEPTION 'M5 p_j en las 2 prioridades: %/% (esperaba 0,40 cada una = (1 - 0,20) / 2)', r600.p_j, r700.p_j;
  END IF;
  IF r800.p_j IS DISTINCT FROM 0.20 THEN
    RAISE EXCEPTION 'M5 p_j en el transito: % (esperaba 0,20)', r800.p_j;
  END IF;
  IF (r600.p_j + r700.p_j + r800.p_j) IS DISTINCT FROM 1.00 THEN
    RAISE EXCEPTION 'la suma de p_j de M5 (2 prioridad + 1 transito) debio dar 1,00, dio %',
      (r600.p_j + r700.p_j + r800.p_j);
  END IF;
  RAISE NOTICE 'ok el reparto de prioridad divide por la cantidad de zonas (M5: 600=%, 700=%, transito 800=%)',
    r600.p_j, r700.p_j, r800.p_j;
END $$;

-- 13) FIX ROUND 1 -- la carga de "afuera" tiene que filtrar por la fecha que
--     se consulta. Ningun pedido del fixture original tiene una fecha
--     distinta de la consultada (todos DATE '2026-08-01'), asi que sacar el
--     filtro de fecha de carga_total no movia ningun valor ya verificado.
--     Movil 6, zona propia (950), exclusivo de este bloque: un pedido de HOY
--     en la zona 960 (afuera) SI cuenta; uno de OTRO DIA en la misma zona 960
--     NO tiene que sumar -- inflar el tiempo de liberacion de un movil que
--     hoy esta libre con pedidos de otro dia es el bug que este filtro evita.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'6',950,'URGENTE',1,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,6,DATE '2026-08-01',true);

-- Ritmo propio de M6: 10 min (5 hechos para ganar el nivel MOVIL).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 900 + g, 1000, DATE '2026-07-31', 'URGENTE', 6, 950, NULL,
       now(), 10.0, 10.0, 'CAMPO'
FROM generate_series(1,5) g;

DO $$
DECLARE r record;
BEGIN
  -- Pedido de HOY (2026-08-01, la fecha consultada) en la zona 960, afuera.
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (300,1000,'URGENTE',6,960,1,DATE '2026-08-01');

  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 950 AND tipo_servicio = 'URGENTE' AND movil = 6;
  IF r.carga_fuera IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M6 carga_fuera con 1 pedido de HOY afuera: % (esperaba 1)', r.carga_fuera;
  END IF;
  IF r.r_j IS DISTINCT FROM 25 THEN
    RAISE EXCEPTION 'M6 r_j con 1 pedido de HOY afuera: % (esperaba 25 = 1 x 10 + 15)', r.r_j;
  END IF;

  -- Pedido de OTRO DIA (2026-08-02, otra fecha) en la misma zona 960: NO debe
  -- sumar a la carga de HOY.
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (301,1000,'URGENTE',6,960,1,DATE '2026-08-02');

  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 950 AND tipo_servicio = 'URGENTE' AND movil = 6;
  IF r.carga_fuera IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M6 carga_fuera despues de agregar un pedido de OTRO DIA: % (esperaba que siguiera en 1, el de manana no cuenta)', r.carga_fuera;
  END IF;
  IF r.r_j IS DISTINCT FROM 25 THEN
    RAISE EXCEPTION 'M6 r_j despues de agregar un pedido de OTRO DIA: % (esperaba que siguiera en 25, no 35)', r.r_j;
  END IF;

  RAISE NOTICE 'ok la carga de afuera filtra por fecha (M6: carga_fuera=% y r_j=% igual antes y despues de agregar un pedido de otro dia)', r.carga_fuera, r.r_j;
END $$;

-- 14) C1 (review final de rama, b7fff6e..64045c2) -- el trabajo IN-ZONE de
--     OTRO pool tiene que ocupar al movil (contar en r_j); el de MISMO pool
--     sigue sin contar (ya es demanda de la zona via demoras_cola). Antes
--     de este fix, carga_total no distinguia tipo y excluia TODO lo in-zone
--     sin mirar el pool: un movil con trabajo in-zone de otro tipo parecia
--     libre. Movil 7, zona propia (970), exclusivo de este bloque: un
--     URGENTE y un NOCTURNO en la MISMA zona (mismo pool que URGENTE -> NO
--     cuentan) y 2 SERVICES en la MISMA zona (otro pool -> SI cuentan).
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'7',970,'URGENTE',1,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,7,DATE '2026-08-01',true);

-- Ritmo propio de M7: 20 min (5 hechos para ganar el nivel MOVIL), igual
-- patron que M1-M3.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 700 + g, 1000, DATE '2026-07-31', 'URGENTE', 7, 970, NULL,
       now(), 20.0, 20.0, 'CAMPO'
FROM generate_series(1,5) g;

DO $$
DECLARE r record;
BEGIN
  -- URGENTE y NOCTURNO en la MISMA zona: mismo pool que se esta calculando
  -- (URGENTE) -- demoras_cola ya los cuenta como demanda de la zona, no
  -- tienen que sumar en r_j.
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (400,1000,'URGENTE',7,970,1,DATE '2026-08-01'),
         (401,1000,'NOCTURNO',7,970,1,DATE '2026-08-01');

  -- 2 SERVICES en la MISMA zona: pool DISTINTO al que se esta calculando
  -- (SERVICE no se mezcla con URGENTE/NOCTURNO en demoras_cola) -- nadie los
  -- cuenta como demanda de la zona, asi que TIENEN que ocupar al movil.
  INSERT INTO services (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (210,1000,'SERVICE',7,970,1,DATE '2026-08-01'),
         (211,1000,'SERVICE',7,970,1,DATE '2026-08-01');

  SELECT * INTO r FROM demoras_aportes(1000, DATE '2026-08-01')
   WHERE zona_id = 970 AND tipo_servicio = 'URGENTE' AND movil = 7;
  IF r.carga_fuera IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'M7 carga_fuera: % (esperaba 2: los 2 SERVICES in-zone, NO el URGENTE ni el NOCTURNO in-zone -- mismo pool, ya son demanda de demoras_cola)', r.carga_fuera;
  END IF;
  IF r.r_j IS DISTINCT FROM 55 THEN
    RAISE EXCEPTION 'M7 r_j: % (esperaba 55 = 2 x 20 + 15: el trabajo in-zone de OTRO pool tiene que ocupar al movil -- C1 del review final: antes de este fix daba 0, el movil parecia libre con 4 pedidos encima)', r.r_j;
  END IF;
  RAISE NOTICE 'ok C1: el trabajo in-zone de OTRO pool cuenta en r_j, el del MISMO pool no (M7 carga_fuera=%, r_j=%)', r.carga_fuera, r.r_j;
END $$;

UPDATE demoras_modelo
   SET ritmo_metrica = 'ENTRE_ENTREGAS', dedicacion_transito = 0.20,
       transito_dedicacion_max_total = 0.60, traslado_fuera_zona_minutos = 15,
       estadistico = 'MEDIANA'
 WHERE escenario_id = 1000;
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
