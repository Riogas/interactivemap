\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE escenario_settings SET peso_transito_alpha = 0.3, pedidos_sa_minutos_antes = NULL
 WHERE escenario_id = 1000;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', transito_modo = 'IGUAL',
       incluir_entrega_propia = true, atrapados_modo = 'EXCLUIR',
       estadistico = 'MEDIANA', max_minutos = 120
 WHERE escenario_id = 1000;

-- ─── El ejemplo del documento (DEMORA_MODELO.md 2.5) ─────────────────
-- Centro=100, Costa=200, Cerro=300.
-- M1 prioridad Centro. M2 prioridad Centro + transito Costa.
-- M3 prioridad Costa. M4 prioridad Cerro, NO salio.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'1',100,'URGENTE',1,true),
       (1000,'2',100,'URGENTE',1,true),
       (1000,'2',200,'URGENTE',2,true),
       (1000,'3',200,'URGENTE',1,true),
       (1000,'4',300,'URGENTE',1,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,1,DATE '2026-07-30',true),
       (1000,2,DATE '2026-07-30',true),
       (1000,3,DATE '2026-07-30',true),
       (1000,4,DATE '2026-07-30',false);   -- M4 no salio

-- Ritmos: M1=20, M2=15, M3=25 (5 hechos c/u para ganar el nivel MOVIL).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 5000 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, m.zona, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (1,100,20.0),(2,100,15.0),(3,200,25.0)) AS m(movil, zona, r),
     generate_series(1,5) g;

-- Estado a las 14:00: Centro 3 asignados a M1 + 2 sin asignar.
--                     Costa  1 a M2 + 2 a M3, nada sin asignar.
--                     Cerro  1 atrapado con M4 + 3 sin asignar.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (2,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (3,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (4,1000,'URGENTE',NULL,100,1,DATE '2026-07-30'),
       (5,1000,'URGENTE',NULL,100,1,DATE '2026-07-30'),
       (6,1000,'URGENTE',2,   200,1,DATE '2026-07-30'),
       (7,1000,'URGENTE',3,   200,1,DATE '2026-07-30'),
       (8,1000,'URGENTE',3,   200,1,DATE '2026-07-30'),
       (9,1000,'URGENTE',4,   300,1,DATE '2026-07-30'),
      (10,1000,'URGENTE',NULL,300,1,DATE '2026-07-30'),
      (11,1000,'URGENTE',NULL,300,1,DATE '2026-07-30'),
      (12,1000,'URGENTE',NULL,300,1,DATE '2026-07-30');

-- 1) CENTRO = 60. Es el numero que el documento le prometio al usuario.
--    M1 libre a los 60 (3x20), M2 a los 15 (1x15).
--    SA#1 -> M2 (15 < 60), M2 pasa a 30. SA#2 -> M2 (30 < 60), pasa a 45.
--    El nuevo -> M2 a los 45, mas 15 de su propia entrega = 60.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'CENTRO: % (esperaba 60 = 45 de espera + 15 de entrega)', r.demora_cruda;
  END IF;
  IF r.cola_por_delante IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'CENTRO cola: %', r.cola_por_delante; END IF;
  IF round(r.libre_primero) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'CENTRO libre_primero: % (esperaba 15, M2 antes de la cola)', r.libre_primero;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'CENTRO no puede estar sin capacidad'; END IF;
  RAISE NOTICE 'ok CENTRO = 60 (el ejemplo del documento)';
END $$;

-- 2) COSTA = 30. M3 libre a los 50 (2x25), M2 a los 15 (1x15). Sin cola.
--    El nuevo -> M2 a los 15, mas 15 = 30.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'COSTA: % (esperaba 30)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok COSTA = 30';
END $$;

-- 3) CERRO: ningun movil activo -> sin_capacidad y se informa el techo.
--    El atrapado de M4 no rescata nada.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 300 AND tipo_servicio = 'URGENTE';
  IF NOT r.sin_capacidad THEN RAISE EXCEPTION 'CERRO debio quedar sin capacidad'; END IF;
  IF round(r.demora_cruda) IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'CERRO: % (esperaba el techo, 120)', r.demora_cruda;
  END IF;
  IF r.moviles_considerados <> 0 THEN RAISE EXCEPTION 'CERRO moviles: %', r.moviles_considerados; END IF;
  RAISE NOTICE 'ok CERRO = techo por falta de moviles';
END $$;

-- 4) incluir_entrega_propia = false: la demora llega hasta que SALE el movil.
--    Centro pasa de 60 a 45.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET incluir_entrega_propia = false WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION 'sin entrega propia: % (esperaba 45)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET incluir_entrega_propia = true WHERE escenario_id = 1000;
  RAISE NOTICE 'ok incluir_entrega_propia';
END $$;

-- 5) El pedido nuevo va al PRIMERO que se libera, no al promedio. Le
--    sacamos la cola a Centro: M1 a 60, M2 a 15 -> 15 + 15 = 30, no el
--    promedio de 37,5 + entrega.
DO $$
DECLARE r record;
BEGIN
  DELETE FROM pedidos WHERE id IN (4,5);
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'el minimo sobre servidores: % (esperaba 30, no un promedio)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok el primero que se libera, no el promedio';
END $$;

-- 6) factor_calibracion multiplica el crudo.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET factor_calibracion = 2.0 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'factor 2.0 sobre 30: % (esperaba 60)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET factor_calibracion = 1.0 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok factor_calibracion';
END $$;

-- 7) Una zona con capacidad y cola vacia da el minimo posible, no cero.
--    (El piso duro lo aplica demoras_acabado; aca solo verificamos que el
--    crudo sea el tiempo real y no un 0 enmascarado.)
--    Vaciamos la carga de M2 -el mas rapido, ritmo 15- que vive en la
--    zona 200 (pedido 6), no la de M1: M2 queda libre YA (0) mientras M1
--    sigue ocupado (60, sus 3 pedidos de zona 100 siguen en pie), asi que
--    el minimo no es ambiguo. Vaciar en cambio zona_nro=100 deja a M1 -el
--    mas LENTO, ritmo 20- en 0 y a M2 en 15 (su pedido de zona 200 sigue
--    contando: la carga es global, no por zona): el minimo pasa a ser M1
--    y el resultado da 20, no 15 -- ese fue justamente el bug que este
--    bloque encontro contra la version original del assert.
DO $$
DECLARE r record;
BEGIN
  DELETE FROM pedidos WHERE movil = 2;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'zona vacia: % (esperaba 15 = el ritmo de M2, libre ya)', r.demora_cruda;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'con moviles activos no puede decir sin_capacidad'; END IF;
  RAISE NOTICE 'ok zona con capacidad y cola vacia';
END $$;

-- 8) Empate de libre_en: al arranque del dia TODOS los moviles activos
--    estan en libre_en = 0, asi que el empate es la situacion NORMAL, no
--    una rareza. A igual momento de liberacion tiene que ganar el que
--    entrega antes (menor ritmo), no el primero del array. Movil 10
--    (rapido, ritmo 15) tiene el movil_id MAS ALTO que movil 9 (lento,
--    ritmo 30) a proposito: el array_agg de demoras_proximo_hueco ordena
--    por movil ascendente, asi que si el desempate volviera a ser "el
--    primero del array" (el bug que este bloque encontro), ganaria el 9 y
--    la demora saldria 30 en vez de 15 -- justo el mutante que hace pasar
--    "<=" en vez de "<" con el segundo criterio.
--    Zona 400 y moviles 9/10 son exclusivos de este bloque, sin carga
--    (cero pedidos asignados: libre_en = 0 x ritmo = 0 para los dos).
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'9', 400,'URGENTE',1,true),
       (1000,'10',400,'URGENTE',1,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,9, DATE '2026-07-30',true),
       (1000,10,DATE '2026-07-30',true);

INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 6000 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, 400, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (9,30.0),(10,15.0)) AS m(movil, r),
     generate_series(1,5) g;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 400 AND tipo_servicio = 'URGENTE';
  IF r.moviles_considerados <> 2 THEN
    RAISE EXCEPTION 'empate: se esperaban 2 moviles, hubo %', r.moviles_considerados;
  END IF;
  IF round(r.libre_primero) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'empate: libre_primero % (esperaba 0, los dos arrancan libres)', r.libre_primero;
  END IF;
  IF round(r.demora_cruda) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'empate en libre_en: % (esperaba 15 = ritmo del movil 10, el mas rapido, no 30 del movil 9 que ganaria solo por tener movil_id mas bajo)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok empate en libre_en: gana el de menor ritmo, no el id mas bajo';
END $$;

-- 9) El MISMO empate, pero con cola por delante: el bloque 8 tiene
--    cola_por_delante = 0, asi que el FOR v_k IN 1 .. z.cola no itera ni
--    una vez y el barrido del REPARTO nunca corre con ese fixture -- solo
--    se prueba la ubicacion del pedido nuevo (el segundo barrido). Este
--    bloque agrega UN pedido sin asignar para que el primer barrido
--    (el reparto) corra de verdad.
--
--    Zona 500, moviles 13 (lento, ritmo 30) y 14 (rapido, ritmo 15, id MAS
--    ALTO a proposito), los dos en libre_en = 0 (empatados) y un pedido
--    sin asignar en la cola:
--
--    Reparto (correcto, empate -> gana el de menor ritmo): el pedido de la
--    cola va al movil 14 (rapido). Movil14 = 0+15 = 15. Movil13 queda
--    intacto en 0.
--    Pedido nuevo: el minimo ahora es movil13 (0 < 15, sin empate). Le
--    toca a movil13 -- el LENTO -- y su propia entrega es 30.
--    demora = 0 (ya esta libre) + 30 (su propio ritmo) = 30.
--
--    Si el reparto NO respetara el desempate (empate resuelto por orden
--    de array, o sea gana movil13 por tener el id mas bajo): el pedido de
--    la cola va a movil13. Movil13 = 0+30 = 30, movil14 queda en 0. El
--    pedido nuevo le toca entonces a movil14 (el rapido), con demora
--    0+15 = 15. O sea: romper el desempate DEL REPARTO cambia el numero
--    final (30 vs 15), aunque el desempate de la ubicacion final este
--    perfecto -- es un fixture que solo el primer barrido puede aprobar.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'13',500,'URGENTE',1,true),
       (1000,'14',500,'URGENTE',1,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,13,DATE '2026-07-30',true),
       (1000,14,DATE '2026-07-30',true);

INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 6100 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, 500, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (13,30.0),(14,15.0)) AS m(movil, r),
     generate_series(1,5) g;

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (500,1000,'URGENTE',NULL,500,1,DATE '2026-07-30');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 500 AND tipo_servicio = 'URGENTE';
  IF r.moviles_considerados <> 2 THEN
    RAISE EXCEPTION 'empate en reparto: se esperaban 2 moviles, hubo %', r.moviles_considerados;
  END IF;
  IF r.cola_por_delante <> 1 THEN
    RAISE EXCEPTION 'empate en reparto: cola_por_delante % (esperaba 1)', r.cola_por_delante;
  END IF;
  IF round(r.ritmo_aplicado) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'empate en reparto: ritmo_aplicado % (esperaba 30, el LENTO -- el rapido tuvo que haberse llevado la cola)', r.ritmo_aplicado;
  END IF;
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'empate en reparto: % (esperaba 30: el rapido -movil 14- absorbe la cola por el desempate, y el lento -movil 13- queda libre para el pedido nuevo)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok empate en el reparto de la cola: tambien respeta el desempate por ritmo';
END $$;

TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS', transito_modo = 'SOLO_SI_NO_HAY'
 WHERE escenario_id = 1000;
