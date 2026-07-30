\set ON_ERROR_STOP on
TRUNCATE metricas_cumplimiento;

-- Movil 10, zona 100, URGENTE, un solo dia: entrega a las 09:00, 09:20,
-- 09:40 y 12:00. Los intervalos son 20, 20 y 140 minutos.
-- El de 140 es el hueco del almuerzo y tiene que caer por el corte.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_asignado, fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
VALUES
  ('PEDIDO', 1, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 08:40:00-03', timestamptz '2026-07-28 09:00:00-03', 20, 20, 'CAMPO'),
  -- asignado 08:50 < fin del anterior (09:00) -> el movil YA tenia cola
  ('PEDIDO', 2, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 08:50:00-03', timestamptz '2026-07-28 09:20:00-03', 30, 30, 'CAMPO'),
  -- asignado 09:30 > fin del anterior (09:20) -> el movil estuvo ocioso
  ('PEDIDO', 3, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 09:30:00-03', timestamptz '2026-07-28 09:40:00-03', 10, 10, 'CAMPO'),
  ('PEDIDO', 4, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 11:00:00-03', timestamptz '2026-07-28 12:00:00-03', 60, 60, 'CAMPO');

-- 1) ENTRE_ENTREGAS: 3 intervalos crudos (20, 20, 140), el de 140 se corta.
DO $$
DECLARE v_n integer; v_max numeric;
BEGIN
  SELECT count(*), max(v) INTO v_n, v_max
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, false);
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'muestras: % (esperaba 2: los de 20 y 20)', v_n; END IF;
  IF v_max IS DISTINCT FROM 20 THEN RAISE EXCEPTION 'max: % (esperaba 20; el hueco de 140 debio caer)', v_max; END IF;
  RAISE NOTICE 'ok entre_entregas con corte de huecos';
END $$;

-- 2) El corte es parametro: con 200 entra el hueco de 140.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 200, false);
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'con corte 200 esperaba 3 muestras, dio %', v_n; END IF;
  RAISE NOTICE 'ok el corte es parametro';
END $$;

-- 3) solo_con_cola descarta el intervalo en que el movil estuvo ocioso.
--    Queda solo el 2do (asignado 08:50 <= fin anterior 09:00).
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, true);
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'solo_con_cola: % (esperaba 1)', v_n; END IF;
  RAISE NOTICE 'ok solo_con_cola';
END $$;

-- 4) La metrica vieja devuelve demora_efectiva_mins tal cual: las 4 filas.
DO $$
DECLARE v_n integer; v_sum numeric;
BEGIN
  SELECT count(*), sum(v) INTO v_n, v_sum
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ASIGNADO_A_ENTREGA', 90, false);
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'asignado_a_entrega: % filas (esperaba 4)', v_n; END IF;
  IF v_sum IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'suma: % (esperaba 20+30+10+60=120)', v_sum; END IF;
  RAISE NOTICE 'ok asignado_a_entrega';
END $$;

-- 5) El intervalo NO cruza de un dia al otro: la ultima entrega del lunes y
--    la primera del martes no son un intervalo de trabajo.
DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_asignado, fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  VALUES
    ('PEDIDO', 5, 1000, DATE '2026-07-27', 'URGENTE', 10, 100, 'ANA',
     timestamptz '2026-07-27 22:30:00-03', timestamptz '2026-07-27 23:00:00-03', 30, 30, 'CAMPO');

  SELECT count(*) INTO v_n
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, false);
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'muestras: % (esperaba 2; el salto 27-jul 23:00 -> 28-jul 09:00 no es un intervalo)', v_n;
  END IF;
  RAISE NOTICE 'ok no cruza dias';
END $$;

TRUNCATE metricas_cumplimiento;
