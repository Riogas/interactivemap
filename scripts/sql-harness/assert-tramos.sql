\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', dedicacion_transito = 0.20,
       transito_dedicacion_max_total = 0.60, traslado_fuera_zona_minutos = 5,
       estadistico = 'MEDIANA', max_minutos = 120, factor_calibracion = 1.0
 WHERE escenario_id = 1000;

-- =======================================================================
-- BLOQUES 1-3: el ejemplo publicado (DEMORA_MODELO_TRAMOS.md seccion 4).
-- Zona A = 100. 20 pedidos pendientes + 1 nuevo = Q 21. Los cuatro moviles
-- entregan cada 10 minutos cuando trabajan en la zona.
--
--   M1 exclusivo de la zona 100                       -> p_j = 1,00
--   M2/M3/M4 comparten la 100 con OTRA zona de PRIORIDAD cada uno (200/300/
--   400) -- dos zonas de prioridad y NINGUN transito reparten 1,00 / 2 =
--   0,50 sin tocar dedicacion_transito (que vale 0,20, no 0,50). Es la
--   forma que exige la task: probar la aritmetica de los tramos, no el
--   reparto -- eso ya lo cubre la Task 4.
--
-- OJO CON LOS "LIBRE EN": el documento ilustra el algoritmo con M2/M3/M4
-- libres en 15/60/90 EXACTOS. Esos tres numeros son un ejemplo de PAPEL, no
-- estan atados a ninguna combinacion real de pedidos-pendientes-afuera x
-- ritmo + traslado. demoras_aportes (Task 4) SI esta atada: r_j = carga_fuera
-- (entero) x ritmo + traslado_fuera_zona_minutos (un solo valor, compartido
-- por TODO el escenario). Con ritmo = 10 fijo para los tres (lo exige
-- mu_j = p_j / ritmo = 0,05 exacto, que es lo que hace que capacidad_final
-- de EXACTO 0,25), la diferencia entre dos "libre en" cualesquiera tiene que
-- ser multiplo de 10. 60 - 15 = 45 NO es multiplo de 10: es matematicamente
-- imposible que demoras_aportes devuelva 15, 60 Y 90 a la vez para tres
-- moviles con mu_j = 0,05 cada uno y un traslado compartido -- verificado
-- primero con algebra (diferencias no congruentes modulo 10) y confirmado
-- con el harness antes de escribir este fixture.
--
-- La salida SI depende unicamente de la SUMA de los tres "libre en"
-- (demora = 84 + 0,2 x (r2+r3+r4), derivado a mano y verificado con el
-- harness para esta Q0=21 y esta progresion de capacidad 0,10->0,25): con
-- 15+60+90 = 165 la spec da 117; cualquier terna que sume 165 EN LA MISMA
-- PROGRESION (mu = 0,05 en cada evento) da el mismo 117. Se usa
-- 15 / 55 / 95 (suma 165 igual, primer evento identico al de la spec,
-- traslado_fuera_zona_minutos = 5, carga_fuera = 1/5/9): reproduce el 117
-- EXACTO a traves de la formula real de demoras_aportes, no por atajo.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'1',100,'URGENTE',1,true),
       (1000,'2',100,'URGENTE',1,true),(1000,'2',200,'URGENTE',1,true),
       (1000,'3',100,'URGENTE',1,true),(1000,'3',300,'URGENTE',1,true),
       (1000,'4',100,'URGENTE',1,true),(1000,'4',400,'URGENTE',1,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,1,DATE '2026-08-01',true),(1000,2,DATE '2026-08-01',true),
       (1000,3,DATE '2026-08-01',true),(1000,4,DATE '2026-08-01',true);

-- Ritmo propio de los 4 = 10 min (5 muestras c/u, ASIGNADO_A_ENTREGA).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 1000 + m*10 + g, 1000, DATE '2026-07-31', 'URGENTE', m, 100, NULL,
       now(), 10.0, 10.0, 'CAMPO'
FROM generate_series(1,4) m, generate_series(1,5) g;

-- 20 pendientes SIN ASIGNAR en la zona 100 (fch_hora_para NULL: cuenta
-- siempre, la ventana SA no lo filtra). Q = 20 + 1 (el nuevo) = 21.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
SELECT g, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-08-01', NULL
FROM generate_series(1,20) g;

-- carga_fuera: con ritmo=10 y traslado=5, r_j = carga_fuera x 10 + 5.
--   M2: 1 pedido en la zona 200 -> r_j = 1x10+5  = 15
--   M3: 5 pedidos en la zona 300 -> r_j = 5x10+5 = 55
--   M4: 9 pedidos en la zona 400 -> r_j = 9x10+5 = 95
-- (15+55+95 = 165, misma suma que el 15+60+90 de la spec: mismo 117.)
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (21,1000,'URGENTE',2,200,1,DATE '2026-08-01');
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT 29+g,1000,'URGENTE',3,300,1,DATE '2026-08-01' FROM generate_series(1,5) g;
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT 39+g,1000,'URGENTE',4,400,1,DATE '2026-08-01' FROM generate_series(1,9) g;

-- 1) El ejemplo publicado -> 117. tramos = 4 (los tres saltos de capacidad
--    mas el tramo final, donde la cola termina de vaciarse). capacidad_final
--    = 0,25 = 0,10 (M1) + 0,05 x 3 (M2/M3/M4, cada uno con p_j=0,50 y
--    ritmo=10).
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.demora_cruda IS DISTINCT FROM 117.00 THEN
    RAISE EXCEPTION 'el ejemplo publicado: demora_cruda % (esperaba 117,00 exacto)', r.demora_cruda;
  END IF;
  IF r.tramos IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'el ejemplo publicado: tramos % (esperaba 4: los tres saltos de capacidad + el tramo final)', r.tramos;
  END IF;
  IF r.capacidad_final IS DISTINCT FROM 0.25 THEN
    RAISE EXCEPTION 'el ejemplo publicado: capacidad_final % (esperaba 0,25 = 0,10 + 0,05x3)', r.capacidad_final;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'el ejemplo publicado no puede quedar sin_capacidad'; END IF;
  IF r.cola_por_delante IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'el ejemplo publicado: cola_por_delante % (esperaba 20)', r.cola_por_delante;
  END IF;
  RAISE NOTICE 'ok el ejemplo publicado = 117 (tramos=%, capacidad_final=%)', r.tramos, r.capacidad_final;
END $$;

-- 2) La progresion de los tramos: capacidad_inicial = 0,10 (solo M1, el
--    unico con r_j <= 0 al arranque).
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.capacidad_inicial IS DISTINCT FROM 0.10 THEN
    RAISE EXCEPTION 'progresion de los tramos: capacidad_inicial % (esperaba 0,10, solo M1 arranca libre)', r.capacidad_inicial;
  END IF;
  IF r.moviles_considerados IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'progresion de los tramos: moviles_considerados % (esperaba 4)', r.moviles_considerados;
  END IF;
  RAISE NOTICE 'ok la progresion de los tramos: capacidad_inicial = 0,10';
END $$;

-- 3) No esperar al ultimo: con el MISMO fixture pero forzando que los tres
--    compartidos se liberen todos juntos en el ultimo momento (95, el mayor
--    de los tres "libre en" de este fixture), la capacidad final es la
--    MISMA (0,25) pero la progresion es distinta -- y el resultado tiene
--    que ser MAYOR que 117. Es la comparacion 117 contra 138 de la spec,
--    con los numeros de este fixture (117 contra 141: verificado a mano y
--    con el harness, ver el header de este archivo).
DO $$
DECLARE r_antes record; r_despues record;
BEGIN
  SELECT * INTO r_antes FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';

  -- Se llevan los tres carga_fuera al mismo r_j = 95: M2 y M3 pasan a tener
  -- 9 pedidos afuera (9x10+5=95, igual que M4).
  DELETE FROM pedidos WHERE id = 21;                                  -- M2 tenia 1 pedido en la 200; se saca para reemplazarlo por 9
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  SELECT 500+g,1000,'URGENTE',2,200,1,DATE '2026-08-01' FROM generate_series(1,9) g;   -- M2: ahora 9 afuera -> r_j=95
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  SELECT 520+g,1000,'URGENTE',3,300,1,DATE '2026-08-01' FROM generate_series(1,4) g;   -- M3 tenia 5, suma 4 mas -> 9 afuera -> r_j=95

  SELECT * INTO r_despues FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';

  IF r_despues.capacidad_final IS DISTINCT FROM r_antes.capacidad_final THEN
    RAISE EXCEPTION 'no esperar al ultimo: la capacidad_final tendria que ser IGUAL (% vs %), solo cambia la progresion',
      r_despues.capacidad_final, r_antes.capacidad_final;
  END IF;
  IF r_despues.demora_cruda <= r_antes.demora_cruda THEN
    RAISE EXCEPTION 'no esperar al ultimo: esperando a todos dio % , tiene que ser MAYOR que el escalonado (%)',
      r_despues.demora_cruda, r_antes.demora_cruda;
  END IF;
  RAISE NOTICE 'ok no esperar al ultimo: escalonado=% < esperar-a-todos=% (misma capacidad_final=%)',
    r_antes.demora_cruda, r_despues.demora_cruda, r_despues.capacidad_final;
END $$;

-- Restaura el fixture original de la zona 100 para los bloques 4-8 (que son
-- fixtures propios, en zonas distintas, y no dependen de esto -- pero se
-- limpia para no dejar basura de m500/520 dando vueltas).
DELETE FROM pedidos WHERE id BETWEEN 500 AND 530;
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (21,1000,'URGENTE',2,200,1,DATE '2026-08-01');

-- =======================================================================
-- 4) Zona sin ningun movil activo -> sin_capacidad = true y el techo.
--    Zona 500: el unico movil asignado (40) esta en moviles_zonas pero
--    NUNCA salio (moviles_dia.activo = false) -- demoras_aportes lo excluye
--    por completo, pero la zona sigue en el universo (sale de
--    moviles_zonas, no de los aportes) y tiene que devolver fila.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'40',500,'URGENTE',1,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,40,DATE '2026-08-01',false);

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 500 AND tipo_servicio = 'URGENTE';
  IF NOT r.sin_capacidad THEN RAISE EXCEPTION 'zona sin movil activo: tenia que quedar sin_capacidad'; END IF;
  IF r.demora_cruda IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'zona sin movil activo: demora_cruda % (esperaba el techo, 120)', r.demora_cruda;
  END IF;
  IF r.moviles_considerados IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'zona sin movil activo: moviles_considerados % (esperaba 0)', r.moviles_considerados;
  END IF;
  RAISE NOTICE 'ok zona sin ningun movil activo -> techo y sin_capacidad';
END $$;

-- =======================================================================
-- 5) Todos ocupados afuera -> avanza al primer evento SIN dividir por cero,
--    y sin marcar sin_capacidad: hay quien va a venir. Zona 600: movil 50,
--    exclusivo de la 600 (p_j=1,00), pero con 2 pedidos pendientes en OTRA
--    zona (650) -> r_j = 2x10+5 = 25, capacidad_inicial = 0 (nadie libre
--    todavia). Un pendiente en la 600 (Q=2).
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'50',600,'URGENTE',1,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,50,DATE '2026-08-01',true);
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 5000+g, 1000, DATE '2026-07-31', 'URGENTE', 50, 600, NULL, now(), 10.0, 10.0, 'CAMPO'
FROM generate_series(1,5) g;
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
VALUES (600,1000,'URGENTE',NULL,600,1,DATE '2026-08-01',NULL);
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT 610+g,1000,'URGENTE',50,650,1,DATE '2026-08-01' FROM generate_series(1,2) g;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 600 AND tipo_servicio = 'URGENTE';
  IF r.capacidad_inicial IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'todos ocupados afuera: capacidad_inicial % (esperaba 0, nadie libre al arranque)', r.capacidad_inicial;
  END IF;
  IF r.sin_capacidad THEN
    RAISE EXCEPTION 'todos ocupados afuera: no puede quedar sin_capacidad, hay quien va a venir (r_j=25)';
  END IF;
  IF r.demora_cruda IS DISTINCT FROM 45.00 THEN
    RAISE EXCEPTION 'todos ocupados afuera: demora_cruda % (esperaba 45,00 = 25 + 2/0,10)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok todos ocupados afuera: avanza sin dividir por cero (demora_cruda=%)', r.demora_cruda;
END $$;

-- =======================================================================
-- 6) Zona vacia -> Q = 1 (solo el pedido nuevo). Zona 700: movil 60,
--    exclusivo, libre YA (sin carga afuera, r_j=0), ritmo 10 -> mu=0,10.
--    Sin ningun pendiente en la zona 700.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'60',700,'URGENTE',1,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,60,DATE '2026-08-01',true);
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 7000+g, 1000, DATE '2026-07-31', 'URGENTE', 60, 700, NULL, now(), 10.0, 10.0, 'CAMPO'
FROM generate_series(1,5) g;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE';
  IF r.cola_por_delante IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'zona vacia: cola_por_delante % (esperaba 0)', r.cola_por_delante;
  END IF;
  IF r.demora_cruda IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION 'zona vacia: demora_cruda % (esperaba 10,00 = 1 / 0,10, lo que tarda la capacidad en hacer el unico pedido)', r.demora_cruda;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'zona vacia con movil activo no puede quedar sin_capacidad'; END IF;
  RAISE NOTICE 'ok zona vacia: Q=1, demora_cruda=%', r.demora_cruda;
END $$;

-- =======================================================================
-- 7) factor_calibracion multiplica el crudo. Reusa la zona 700 (demora
--    cruda 10,00 con factor 1,0): con factor 2,0 tiene que dar 20,00.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET factor_calibracion = 2.0 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE';
  IF r.demora_cruda IS DISTINCT FROM 20.00 THEN
    RAISE EXCEPTION 'factor_calibracion: demora_cruda % (esperaba 20,00 = 10,00 x 2,0)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET factor_calibracion = 1.0 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok factor_calibracion multiplica el crudo (%)', r.demora_cruda;
END $$;

-- =======================================================================
-- 8) Empate en la liberacion: dos moviles que se liberan en el mismo
--    minuto entran los dos en el MISMO tramo -- tramos cuenta uno solo, no
--    dos. Zona 800: movil 80 exclusivo (r_j=0, mu=0,10). Movil 81 y movil
--    82, cada uno con OTRA zona de prioridad (810/820 respectivamente) para
--    p_j=0,50, y cada uno con 1 pedido pendiente afuera -> LOS DOS con
--    r_j = 1x10+5 = 15, EMPATADOS. 5 pendientes en la zona 800 (Q=6).
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'80',800,'URGENTE',1,true),
       (1000,'81',800,'URGENTE',1,true),(1000,'81',810,'URGENTE',1,true),
       (1000,'82',800,'URGENTE',1,true),(1000,'82',820,'URGENTE',1,true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,80,DATE '2026-08-01',true),(1000,81,DATE '2026-08-01',true),(1000,82,DATE '2026-08-01',true);
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 8000+m*10+g, 1000, DATE '2026-07-31', 'URGENTE', m, 800, NULL, now(), 10.0, 10.0, 'CAMPO'
FROM (VALUES (80),(81),(82)) AS mm(m), generate_series(1,5) g;

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
SELECT 800+g,1000,'URGENTE',NULL,800,1,DATE '2026-08-01',NULL FROM generate_series(1,5) g;
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (900,1000,'URGENTE',81,810,1,DATE '2026-08-01'),
       (901,1000,'URGENTE',82,820,1,DATE '2026-08-01');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_consumo_tramos(1000, DATE '2026-08-01', timestamptz '2026-08-01 14:00:00-03')
   WHERE zona_id = 800 AND tipo_servicio = 'URGENTE';
  IF r.moviles_considerados IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'empate en la liberacion: moviles_considerados % (esperaba 3)', r.moviles_considerados;
  END IF;
  IF r.tramos IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'empate en la liberacion: tramos % (esperaba 2: UN tramo por el empate + el tramo final, NO 3)', r.tramos;
  END IF;
  IF r.capacidad_final IS DISTINCT FROM 0.20 THEN
    RAISE EXCEPTION 'empate en la liberacion: capacidad_final % (esperaba 0,20 = 0,10 + 0,05 + 0,05)', r.capacidad_final;
  END IF;
  IF r.demora_cruda IS DISTINCT FROM 37.50 THEN
    RAISE EXCEPTION 'empate en la liberacion: demora_cruda % (esperaba 37,50)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok empate en la liberacion: tramos=% (uno solo por el empate), demora_cruda=%', r.tramos, r.demora_cruda;
END $$;

TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ENTRE_ENTREGAS', traslado_fuera_zona_minutos = 15, factor_calibracion = 1.0
 WHERE escenario_id = 1000;
