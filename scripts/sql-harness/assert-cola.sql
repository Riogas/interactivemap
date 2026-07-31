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

-- 2) cola_efectiva AHORA incluye los asignados en zona. Con 3 asignados
--    (2 al movil activo + 1 atrapado, que se excluye) y 4 sin asignar:
--    2 + 4 = 6.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'cola_efectiva %: esperaba 6 = 4 sin asignar + 2 asignados al movil activo (el atrapado se excluye)', r.cola_efectiva;
  END IF;
  RAISE NOTICE 'ok la cola incluye los asignados en zona';
END $$;

-- 3) atrapados_modo = COMO_SIN_ASIGNAR: el atrapado tambien entra -> 7.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET atrapados_modo = 'COMO_SIN_ASIGNAR' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'COMO_SIN_ASIGNAR: cola_efectiva % (esperaba 7)', r.cola_efectiva;
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

-- 5) Un escenario SIN fila en escenario_settings no puede hacer desaparecer
--    la demanda. Es el peor modo de falla posible: la funcion devolveria
--    cero filas, el motor informaria el piso, y una zona con cola real
--    saldria como si estuviera vacia. Los ASIGNADOS cuentan siempre, y sin
--    configuracion de ventana los SIN ASIGNAR tambien (NULL = sin filtro).
DO $$
DECLARE r record; v_mins integer;
BEGIN
  SELECT pedidos_sa_minutos_antes INTO v_mins FROM escenario_settings WHERE escenario_id = 1000;
  DELETE FROM escenario_settings WHERE escenario_id = 1000;

  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin fila en escenario_settings la funcion devolvio CERO filas: la demanda desaparecio';
  END IF;
  IF r.asignados = 0 THEN
    RAISE EXCEPTION 'sin fila en escenario_settings se perdieron los asignados, que cuentan siempre';
  END IF;

  INSERT INTO escenario_settings (escenario_id, peso_transito_alpha, nombre, pedidos_sa_minutos_antes)
  VALUES (1000, 0.3, 'Escenario 1000', v_mins);
  RAISE NOTICE 'ok sin escenario_settings degrada a "sin filtro", no a cero filas';
END $$;

-- 6) URGENTE y NOCTURNO unen la demanda: un nocturno de la zona tiene que
--    aparecer en la cola de URGENTE y viceversa. Un SERVICE no.
DO $$
DECLARE r_urg record; r_noc record; r_srv record;
BEGIN
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (30, 1000, 'NOCTURNO', NULL, 100, 1, DATE '2026-07-30'),
         (31, 1000, 'NOCTURNO', NULL, 100, 1, DATE '2026-07-30');
  INSERT INTO services (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (32, 1000, 'SERVICE', NULL, 100, 1, DATE '2026-07-30');

  SELECT * INTO r_urg FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  SELECT * INTO r_noc FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'NOCTURNO';
  SELECT * INTO r_srv FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'SERVICE';

  -- Los 2 nocturnos se suman a los 7 que ya habia en este punto del archivo:
  -- 4 sin_asignar + 3 asignados_activos. NO son los 6 del bloque 2 -- el
  -- bloque 4 (sin tocar por esta task) agrego el pedido 21 (URGENTE, movil
  -- 10 activo, fch_hora_para lejana): un asignado cuenta SIEMPRE aunque
  -- arranque tarde (regla canonica), asi que subio asignados_activos de 2 a
  -- 3 antes de que este bloque corriera. 7 + 2 nocturnos = 9.
  IF r_urg.cola_efectiva IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'URGENTE debio sumar los 2 nocturnos: cola % (esperaba 9 = 4 sin_asignar + 3 asignados_activos + 2 nocturnos sin asignar)', r_urg.cola_efectiva;
  END IF;
  IF r_noc.cola_efectiva IS DISTINCT FROM r_urg.cola_efectiva THEN
    RAISE EXCEPTION 'NOCTURNO y URGENTE deben ver la MISMA demanda: % vs %', r_noc.cola_efectiva, r_urg.cola_efectiva;
  END IF;
  -- SERVICE no se mezcla: solo su propio pedido.
  IF r_srv.cola_efectiva IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SERVICE no debe mezclarse: cola % (esperaba 1)', r_srv.cola_efectiva;
  END IF;
  RAISE NOTICE 'ok urgente+nocturno unen demanda, service no';
END $$;

TRUNCATE pedidos, services, moviles_dia;
