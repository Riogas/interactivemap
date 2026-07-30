\set ON_ERROR_STOP on
TRUNCATE pedidos, services, moviles_dia;

-- Zona 100 URGENTE: 2 asignados a un movil ACTIVO, 1 asignado a un movil
-- INACTIVO (atrapado), 3 sin asignar.
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 10, DATE '2026-07-30', true),
       (1000, 99, DATE '2026-07-30', false);

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
VALUES
  (1, 1000, 'URGENTE', 10,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (2, 1000, 'URGENTE', 10,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (3, 1000, 'URGENTE', 99,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (4, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (5, 1000, 'URGENTE', 0,    100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (6, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  -- Cumplido: no es cola.
  (7, 1000, 'URGENTE', 10,   100, 2, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  -- ESPECIAL: fuera del motor.
  (8, 1000, 'ESPECIAL', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  -- fch_para NULL pero fch_hora_para del dia: tiene que contar igual (el 4%).
  (9, 1000, 'URGENTE', NULL, 100, 1, NULL, timestamptz '2026-07-30 15:00:00-03');

-- 1) Los conteos crudos.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.asignados   IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'asignados: % (esperaba 3: 2 del activo + 1 atrapado)', r.asignados; END IF;
  IF r.atrapados   IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'atrapados: % (esperaba 1)', r.atrapados; END IF;
  IF r.sin_asignar IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'sin_asignar: % (esperaba 4: movil NULL, movil 0, y el de fch_para NULL)', r.sin_asignar; END IF;
  RAISE NOTICE 'ok conteos crudos';
END $$;

-- 2) atrapados_modo = EXCLUIR (default): el atrapado no entra en la cola.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'EXCLUIR: cola_efectiva % (esperaba 4 = los sin asignar; los asignados a moviles activos los lleva el simulador via libre_en)', r.cola_efectiva;
  END IF;
  RAISE NOTICE 'ok atrapados EXCLUIR';
END $$;

-- 3) atrapados_modo = COMO_SIN_ASIGNAR: el atrapado se suma a la cola,
--    porque lo va a agarrar otro movil.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET atrapados_modo = 'COMO_SIN_ASIGNAR' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'COMO_SIN_ASIGNAR: cola_efectiva % (esperaba 5)', r.cola_efectiva;
  END IF;
  UPDATE demoras_modelo SET atrapados_modo = 'EXCLUIR' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok atrapados COMO_SIN_ASIGNAR';
END $$;

-- 4) La ventana SA: un sin asignar que arranca mucho mas tarde todavia no
--    existe para el sistema y no debe empujar la demora. Un ASIGNADO cuenta
--    siempre, aunque arranque tarde (regla canonica, lib/sa-window-filter.ts).
DO $$
DECLARE r record;
BEGIN
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
  VALUES (20, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 23:00:00-03'),
         (21, 1000, 'URGENTE', 10,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 23:00:00-03');

  -- escenario_settings.pedidos_sa_minutos_antes = 60 en los stubs.
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.sin_asignar IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'el SA de las 23:00 no debio contar a las 14:00: sin_asignar %', r.sin_asignar;
  END IF;
  IF r.asignados IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'el ASIGNADO de las 23:00 debio contar igual: asignados %', r.asignados;
  END IF;
  RAISE NOTICE 'ok ventana SA';
END $$;

TRUNCATE pedidos, services, moviles_dia;
