\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, demoras, demoras_calculadas, metricas_cumplimiento;

-- Zona 100 ACTIVA con 1 movil activo dedicado; zona 900 INACTIVA.
INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
VALUES (1000, 100, 'Distribucion', 'URGENTE', 35, true),
       (1000, 900, 'Distribucion', 'URGENTE', 60, false);

INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('10', 100, 1000, 'URGENTE', 1),
       ('11', 900, 1000, 'URGENTE', 1);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 10, date '2026-07-29', true),
       (1000, 11, date '2026-07-29', true);

-- 10 pedidos pendientes en zona 100 -> con ritmo global de 20 min y
-- capacidad 1.0, el crudo da 200 -> clampea a 120.
-- fch_para es DATE en produccion (no TEXT): literal directo, sin to_char.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT g, 1000, 'URGENTE', 10, 100, 1, date '2026-07-29'
FROM generate_series(1,10) g;

INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 1000+g, 1000, date '2026-07-29' - 1,
       'URGENTE', 10, 100, 'ANA', now(), 20, 20, 'CAMPO'
FROM generate_series(1,10) g;

-- Fuerza ventana abierta para que el assert no dependa de la hora real.
UPDATE demoras_config SET hora_inicio='00:00', hora_fin='23:59' WHERE escenario_id=1000;

DO $$
DECLARE n bigint; r record;
BEGIN
  n := demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  IF n < 1 THEN RAISE EXCEPTION 'no escribio filas'; END IF;

  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 15:00:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 100'; END IF;
  IF r.demora_informada IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'informada: % (esperaba 120)', r.demora_informada; END IF;
  IF r.clampeado IS DISTINCT FROM 'MAX' THEN RAISE EXCEPTION 'clampeado: % (esperaba MAX)', r.clampeado; END IF;
  IF r.demora_as400 IS DISTINCT FROM 35 THEN RAISE EXCEPTION 'snapshot as400: % (esperaba 35)', r.demora_as400; END IF;
  IF r.pendientes_asignados IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'pendientes: %', r.pendientes_asignados; END IF;
  RAISE NOTICE 'ok calculo y snapshot';

  -- La zona INACTIVA no debe emitir fila.
  PERFORM 1 FROM demoras_calculadas WHERE zona_id=900;
  IF FOUND THEN RAISE EXCEPTION 'la zona inactiva no debe emitir fila'; END IF;
  RAISE NOTICE 'ok ignora zonas inactivas';
END $$;

-- Ventana SA: un pedido SIN movil que arranca mas alla de la ventana no debe
-- contar como demanda; uno CON movil cuenta siempre aunque arranque tarde.
DO $$
DECLARE r_antes record; r_desp record;
BEGIN
  SELECT pendientes_sin_asignar, pendientes_asignados INTO r_antes
    FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:00:00-03';

  -- Uno SA que arranca en 4 horas (fuera de la ventana de 60 min) y uno CON
  -- movil que tambien arranca en 4 horas.
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
  VALUES (5001, 1000, 'URGENTE', NULL, 100, 1,
          date '2026-07-29',
          timestamptz '2026-07-29 19:00:00-03'),
         (5002, 1000, 'URGENTE', 10, 100, 1,
          date '2026-07-29',
          timestamptz '2026-07-29 19:00:00-03');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:05:00-03');
  SELECT pendientes_sin_asignar, pendientes_asignados INTO r_desp
    FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:05:00-03';

  IF r_desp.pendientes_sin_asignar IS DISTINCT FROM r_antes.pendientes_sin_asignar THEN
    RAISE EXCEPTION 'el SA fuera de ventana no debe contar: % -> %',
      r_antes.pendientes_sin_asignar, r_desp.pendientes_sin_asignar;
  END IF;
  IF r_desp.pendientes_asignados IS DISTINCT FROM r_antes.pendientes_asignados + 1 THEN
    RAISE EXCEPTION 'el asignado fuera de ventana SI debe contar: % -> %',
      r_antes.pendientes_asignados, r_desp.pendientes_asignados;
  END IF;
  RAISE NOTICE 'ok ventana SA (SA fuera de ventana excluido, asignado incluido)';

  DELETE FROM pedidos WHERE id IN (5001,5002);
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:05:00-03';
END $$;

-- ESPECIAL y OTROS no deben contar como demanda de ningun tipo.
DO $$
DECLARE r_antes int; r_desp int;
BEGIN
  SELECT pendientes_asignados INTO r_antes FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:00:00-03';

  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (5101, 1000, 'ESPECIAL SIN FLETE', 10, 100, 1, date '2026-07-29'),
         (5102, 1000, 'LO QUE SEA', 10, 100, 1, date '2026-07-29');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:10:00-03');
  SELECT pendientes_asignados INTO r_desp FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:10:00-03';

  IF r_desp IS DISTINCT FROM r_antes THEN
    RAISE EXCEPTION 'ESPECIAL/OTROS no deben contar como demanda: % -> %', r_antes, r_desp;
  END IF;
  RAISE NOTICE 'ok ESPECIAL y OTROS excluidos';

  DELETE FROM pedidos WHERE id IN (5101,5102);
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:10:00-03';
END $$;

-- fch_para llega NULL desde la ingesta en ~4% de los pedidos pendientes
-- reales (medido contra produccion), aunque fch_hora_para si trae el valor
-- correcto. Mismo gap que 2026-06-01-fix-pedidos-fch-para-null.sql: un
-- pendiente con fch_para NULL debe contar via COALESCE con fch_hora_para,
-- no desaparecer de la demanda.
DO $$
DECLARE r_antes int; r_desp int;
BEGIN
  SELECT pendientes_asignados INTO r_antes FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:00:00-03';

  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
  VALUES (5201, 1000, 'URGENTE', 10, 100, 1, NULL, timestamptz '2026-07-29 10:00:00-03');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:20:00-03');
  SELECT pendientes_asignados INTO r_desp FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:20:00-03';

  IF r_desp IS DISTINCT FROM r_antes + 1 THEN
    RAISE EXCEPTION 'pedido con fch_para NULL no conto via fch_hora_para: % -> %', r_antes, r_desp;
  END IF;
  RAISE NOTICE 'ok fch_para NULL cuenta via COALESCE con fch_hora_para';

  DELETE FROM pedidos WHERE id = 5201;
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:20:00-03';
END $$;

-- Idempotencia: la misma corrida_at dos veces no duplica ni cambia.
DO $$
DECLARE a bigint; b bigint;
BEGIN
  SELECT count(*) INTO a FROM demoras_calculadas;
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  SELECT count(*) INTO b FROM demoras_calculadas;
  IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'no es idempotente: % -> %', a, b; END IF;
  RAISE NOTICE 'ok idempotente';
END $$;

-- Interruptor de emergencia (global: apaga los 3 tipos a la vez).
UPDATE demoras_config SET motor_activo=false WHERE escenario_id=1000;
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 16:00:00-03') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'el interruptor no apago el motor';
  END IF;
  RAISE NOTICE 'ok interruptor';
END $$;
UPDATE demoras_config SET motor_activo=true WHERE escenario_id=1000;

-- Fuera de ventana (global: cierra los 3 tipos a la vez).
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='08:00' WHERE escenario_id=1000;
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'corrio fuera de ventana';
  END IF;
  RAISE NOTICE 'ok ventana horaria';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Aislamiento POR TIPO: la restriccion central de esta task es que el
-- interruptor y la ventana horaria se evaluan por (escenario, tipo), no
-- globalmente (NOCTURNO tiene su propia ventana 18:00-23:30). Los bloques
-- de arriba solo pisan las 3 filas de demoras_config a la vez y prueban
-- comportamiento GLOBAL; nunca demuestran el aislamiento. Hace falta
-- sembrar NOCTURNO y SERVICE (hasta aca no habia ni una fila) y probar
-- que apagar/cerrar UN tipo no afecta a los otros.
-- ═══════════════════════════════════════════════════════════════════════
UPDATE demoras_config SET motor_activo=true, hora_inicio='00:00', hora_fin='23:59' WHERE escenario_id=1000;

INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('10', 100, 1000, 'NOCTURNO', 1),
       ('10', 100, 1000, 'SERVICE', 1);

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (6001, 1000, 'NOCTURNO', 10, 100, 1, date '2026-07-29');
INSERT INTO services (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (7001, 1000, 'SERVICE', 10, 100, 1, date '2026-07-29');

-- Control positivo: con el motor prendido y la ventana abierta para los 3
-- tipos, NOCTURNO y SERVICE tienen que calcular igual que URGENTE. Esto
-- prueba que el seed nuevo es valido ANTES de usarlo para probar
-- aislamiento (si esto fallara, las ausencias de abajo serian falsos
-- positivos por falta de datos, no por el interruptor/ventana).
--
-- De paso, NOCTURNO y SERVICE en zona 100 no tienen NI UNA fila en
-- metricas_cumplimiento (todo el seed de mas arriba es tipo_servicio=
-- URGENTE), asi que demoras_ritmo no tiene estadistica ni de zona ni
-- global para esos dos tipos -> caen en DEFECTO. Es el escenario exacto
-- que violaba el CHECK viejo de ritmo_origen (fix round 3): si el INSERT
-- de mas arriba no hubiera hecho el swap del constraint, esta corrida
-- fallaria con "violates check constraint
-- demoras_calculadas_ritmo_origen_check" en vez de escribir la fila.
DO $$
DECLARE r_noc record;
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:00:00-03');

  SELECT * INTO r_noc FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 20:00:00-03';
  IF r_noc IS NULL THEN RAISE EXCEPTION 'NOCTURNO debio calcular (control positivo)'; END IF;
  IF r_noc.ritmo_origen IS DISTINCT FROM 'DEFECTO' THEN
    RAISE EXCEPTION 'NOCTURNO sin metricas: ritmo_origen=% (esperaba DEFECTO)', r_noc.ritmo_origen;
  END IF;
  IF r_noc.ritmo_muestras IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'NOCTURNO sin metricas: ritmo_muestras=% (esperaba 0)', r_noc.ritmo_muestras;
  END IF;

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='SERVICE' AND corrida_at = timestamptz '2026-07-29 20:00:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE debio calcular (control positivo)'; END IF;

  RAISE NOTICE 'ok NOCTURNO y SERVICE calculan con datos propios (control positivo), ritmo_origen=DEFECTO sin violar el CHECK';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 20:00:00-03';
END $$;

-- Interruptor POR TIPO: apagar solo NOCTURNO no debe afectar a URGENTE.
UPDATE demoras_config SET motor_activo=false WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:05:00-03');

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 20:05:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'URGENTE debio seguir calculando con NOCTURNO apagado'; END IF;

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 20:05:00-03';
  IF FOUND THEN RAISE EXCEPTION 'NOCTURNO no debio calcular: el interruptor es por tipo, no global'; END IF;

  RAISE NOTICE 'ok interruptor por tipo (apagar NOCTURNO no apaga URGENTE)';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 20:05:00-03';
END $$;
UPDATE demoras_config SET motor_activo=true WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';

-- Ventana POR TIPO: URGENTE 07:00-23:30, NOCTURNO 18:00-23:30 (ventanas
-- reales del seed). A las 15:30 -dentro de la de URGENTE, fuera de la de
-- NOCTURNO- debe emitir URGENTE y NO NOCTURNO.
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
UPDATE demoras_config SET hora_inicio='18:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:30:00-03');

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 15:30:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'URGENTE debio calcular a las 15:30 (dentro de su ventana)'; END IF;

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 15:30:00-03';
  IF FOUND THEN RAISE EXCEPTION 'NOCTURNO no debio calcular a las 15:30 (fuera de su ventana 18:00-23:30)'; END IF;

  RAISE NOTICE 'ok ventana horaria por tipo (15:30: URGENTE calcula, NOCTURNO no)';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:30:00-03';
END $$;

-- Y a las 19:00, ya dentro de la ventana de NOCTURNO, NOCTURNO SI calcula:
-- prueba que la ausencia de arriba es por la ventana y no por falta de
-- datos o algun otro bloqueo silencioso.
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 19:00:00-03');
  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 19:00:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOCTURNO debio calcular a las 19:00 (dentro de su ventana)'; END IF;
  RAISE NOTICE 'ok NOCTURNO calcula dentro de su propia ventana';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 19:00:00-03';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Precedencia capacidad > demanda: la falta de capacidad manda sobre la
-- falta de demanda. Zona 200 nueva, dedicada, con movil ASIGNADO (para
-- entrar al universo) pero sin pedidos ni services (demanda cero en las
-- dos pruebas). Primero SIN activar el movil hoy (sin capacidad): la
-- respuesta honesta no es el piso, nadie atiende. Despues, mismo movil ya
-- activado (con capacidad) y demanda sigue en cero: ahi si es el caso
-- bueno. Sin el segundo control, el primero podria pasar por el motivo
-- equivocado (p.ej. si el CASE quedara mal armado de otra forma).
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
VALUES (1000, 200, 'Distribucion', 'URGENTE', 45, true);
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('20', 200, 1000, 'URGENTE', 1);
-- Sin fila en moviles_dia para el movil 20 todavia: no cuenta como activo.

DO $$
DECLARE r record;
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:10:00-03');
  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=200 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 20:10:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 200 (sin capacidad, sin demanda)'; END IF;
  IF r.demora_informada IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'sin capacidad y sin demanda: informada % (esperaba 120 = max_minutos)', r.demora_informada;
  END IF;
  IF r.sin_capacidad IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'sin capacidad y sin demanda: sin_capacidad=% (esperaba true)', r.sin_capacidad;
  END IF;
  RAISE NOTICE 'ok sin capacidad y sin demanda -> informa el techo, sin_capacidad=true';
END $$;

-- Limpio la corrida anterior para que la proxima sea "primera corrida del
-- dia" para la zona 200 y el suavizado no arrastre el 120 de recien.
DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 20:10:00-03';

-- Ahora activo el movil 20 (capacidad>0); la demanda sigue en cero.
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 20, date '2026-07-29', true);

DO $$
DECLARE r record;
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:15:00-03');
  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=200 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 20:15:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 200 (con capacidad, sin demanda)'; END IF;
  IF r.demora_informada IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'con capacidad y sin demanda: informada % (esperaba 30 = min_minutos)', r.demora_informada;
  END IF;
  IF r.sin_capacidad IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'con capacidad y sin demanda: sin_capacidad=% (esperaba false)', r.sin_capacidad;
  END IF;
  RAISE NOTICE 'ok con capacidad y sin demanda -> informa el piso, sin_capacidad=false';
END $$;
