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
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT g, 1000, 'URGENTE', 10, 100, 1,
       to_char(date '2026-07-29', 'YYYYMMDD')
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
  IF r.demora_informada <> 120 THEN RAISE EXCEPTION 'informada: % (esperaba 120)', r.demora_informada; END IF;
  IF r.clampeado <> 'MAX' THEN RAISE EXCEPTION 'clampeado: % (esperaba MAX)', r.clampeado; END IF;
  IF r.demora_as400 <> 35 THEN RAISE EXCEPTION 'snapshot as400: % (esperaba 35)', r.demora_as400; END IF;
  IF r.pendientes_asignados <> 10 THEN RAISE EXCEPTION 'pendientes: %', r.pendientes_asignados; END IF;
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
          to_char(date '2026-07-29','YYYYMMDD'),
          timestamptz '2026-07-29 19:00:00-03'),
         (5002, 1000, 'URGENTE', 10, 100, 1,
          to_char(date '2026-07-29','YYYYMMDD'),
          timestamptz '2026-07-29 19:00:00-03');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:05:00-03');
  SELECT pendientes_sin_asignar, pendientes_asignados INTO r_desp
    FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:05:00-03';

  IF r_desp.pendientes_sin_asignar <> r_antes.pendientes_sin_asignar THEN
    RAISE EXCEPTION 'el SA fuera de ventana no debe contar: % -> %',
      r_antes.pendientes_sin_asignar, r_desp.pendientes_sin_asignar;
  END IF;
  IF r_desp.pendientes_asignados <> r_antes.pendientes_asignados + 1 THEN
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
  VALUES (5101, 1000, 'ESPECIAL SIN FLETE', 10, 100, 1,
          to_char(date '2026-07-29','YYYYMMDD')),
         (5102, 1000, 'LO QUE SEA', 10, 100, 1,
          to_char(date '2026-07-29','YYYYMMDD'));

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:10:00-03');
  SELECT pendientes_asignados INTO r_desp FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:10:00-03';

  IF r_desp <> r_antes THEN
    RAISE EXCEPTION 'ESPECIAL/OTROS no deben contar como demanda: % -> %', r_antes, r_desp;
  END IF;
  RAISE NOTICE 'ok ESPECIAL y OTROS excluidos';

  DELETE FROM pedidos WHERE id IN (5101,5102);
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:10:00-03';
END $$;

-- Idempotencia: la misma corrida_at dos veces no duplica ni cambia.
DO $$
DECLARE a bigint; b bigint;
BEGIN
  SELECT count(*) INTO a FROM demoras_calculadas;
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  SELECT count(*) INTO b FROM demoras_calculadas;
  IF a <> b THEN RAISE EXCEPTION 'no es idempotente: % -> %', a, b; END IF;
  RAISE NOTICE 'ok idempotente';
END $$;

-- Interruptor de emergencia.
UPDATE demoras_config SET motor_activo=false WHERE escenario_id=1000;
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 16:00:00-03') <> 0 THEN
    RAISE EXCEPTION 'el interruptor no apago el motor';
  END IF;
  RAISE NOTICE 'ok interruptor';
END $$;
UPDATE demoras_config SET motor_activo=true WHERE escenario_id=1000;

-- Fuera de ventana.
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='08:00' WHERE escenario_id=1000;
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03') <> 0 THEN
    RAISE EXCEPTION 'corrio fuera de ventana';
  END IF;
  RAISE NOTICE 'ok ventana horaria';
END $$;
