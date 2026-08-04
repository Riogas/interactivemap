-- Asserts de 2026-08-03-desfasaje-backfill-nocturno.sql (el job one-shot).
-- AUTOSUFICIENTE respecto del orden de asserts (el glob corre
-- "-backfill" ANTES que assert-desfasaje: '-' < '.'): siembra su PROPIO
-- hecho ancla para que el cursor de 5e tenga desde dónde arrancar.
-- Ids nuevos (300+) para no chocar.

-- Hecho ancla (estilo pre-migración, columnas nuevas NULL): fija
-- min(fecha) = 2026-06-10 -> el cursor baja desde ahí hasta 2026-03-23.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
   movil, zona_nro, empresa_fletera_id, chofer,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   demora_mins, demora_efectiva_mins, atraso_vs_para_mins, atraso_vs_compromiso_mins,
   reloj_inicio, asignado_source)
VALUES
  ('PEDIDO', 301, 1000, DATE '2026-06-10', 'URGENTE', 'URGENTE',
   77, 10, 7, 'CHOFER ANCLA',
   '2026-06-10 10:05-03', '2026-06-10 10:40-03', '2026-06-10 10:00-03', '2026-06-10 10:45-03',
   35, 35, 40, -5,
   'ASIGNADO', 'CAMPO');

-- Fixture: un pedido entregado en ABRIL (pre-historia, sin hecho) que 5e
-- tiene que descubrir, calcular y espejar vía el run.
INSERT INTO pedidos
  (id, escenario, servicio_nombre, zona_nro, empresa_fletera_id, movil, fletero,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   estado_nro, sub_estado_nro, orden_cancelacion, demora_informada)
VALUES
  -- desf_inf = (fin-para) - 25 = 30 - 25 = +5.00
  (300, 1000, 'URGENTE', 10, 7, 300, 'CHOFER ABRIL',
   '2026-04-02 10:05-03', '2026-04-02 10:30-03', '2026-04-02 10:00-03', '2026-04-02 10:25-03',
   2, 3, 'N', 25);

-- Manejar el job a mano (el harness no tiene pg_cron): loop hasta COMPLETO.
DO $$
DECLARE v_r text; v_i int := 0;
BEGIN
  LOOP
    v_i := v_i + 1;
    IF v_i > 60 THEN RAISE EXCEPTION 'el step no llego a COMPLETO en 60 vueltas (loop infinito?)'; END IF;
    v_r := metricas_desfasaje_backfill_step();
    EXIT WHEN v_r = 'COMPLETO';
  END LOOP;
  RAISE NOTICE 'backfill completo en % vueltas', v_i;
END $$;
SELECT 'ok el job llega a COMPLETO y no loopea (cursor avanza aun en semanas vacias)' AS r;

-- 1. El hecho de abril existe con su desfasaje, creado por 5e.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=300;
  IF NOT FOUND THEN RAISE EXCEPTION 'el hecho de abril no se creo'; END IF;
  IF m.fecha <> DATE '2026-04-02' THEN RAISE EXCEPTION 'fecha=%', m.fecha; END IF;
  IF m.demora_informada_mins    IS DISTINCT FROM 25   THEN RAISE EXCEPTION 'dem_inf=%', m.demora_informada_mins; END IF;
  IF m.desfasaje_informado_mins IS DISTINCT FROM 5.00 THEN RAISE EXCEPTION 'desf=%', m.desfasaje_informado_mins; END IF;
END $$;
SELECT 'ok 5e creo el hecho de abril con desfasaje +5' AS r;

-- 2. Y su espejo en pedidos (lo hizo el run de la semana, no 5f).
DO $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM pedidos WHERE id=300 AND escenario=1000;
  IF p.desfasaje_informado_mins IS DISTINCT FROM 5.00 THEN
    RAISE EXCEPTION 'espejo de abril=%', p.desfasaje_informado_mins;
  END IF;
END $$;
SELECT 'ok espejo del pedido de abril poblado por el run interno de 5e' AS r;

-- 3. Estado consistente: cursor en el piso, meses de 5f marcados, completo.
DO $$
DECLARE v text; n int;
BEGIN
  SELECT e.detalle INTO v FROM metricas_desfasaje_backfill_estado e WHERE e.paso='5e-cursor';
  IF v::date <> DATE '2026-03-23' THEN RAISE EXCEPTION 'cursor=% (debia llegar al piso)', v; END IF;
  SELECT count(*) INTO n FROM metricas_desfasaje_backfill_estado WHERE paso LIKE '5f-%';
  IF n <> 3 THEN RAISE EXCEPTION 'meses 5f marcados=%', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM metricas_desfasaje_backfill_estado WHERE paso='completo') THEN
    RAISE EXCEPTION 'falta la marca completo';
  END IF;
END $$;
SELECT 'ok estado: cursor en 2026-03-23, 3 meses de 5f, marca completo' AS r;

-- 4. Idempotencia: una invocacion extra devuelve COMPLETO sin rehacer nada.
DO $$
DECLARE v_r text; v_antes timestamptz; v_despues timestamptz;
BEGIN
  SELECT done_at INTO v_antes FROM metricas_desfasaje_backfill_estado WHERE paso='5f-2026-06';
  v_r := metricas_desfasaje_backfill_step();
  IF v_r <> 'COMPLETO' THEN RAISE EXCEPTION 'invocacion extra devolvio %', v_r; END IF;
  SELECT done_at INTO v_despues FROM metricas_desfasaje_backfill_estado WHERE paso='5f-2026-06';
  IF v_antes IS DISTINCT FROM v_despues THEN RAISE EXCEPTION '5f se rehizo tras COMPLETO'; END IF;
END $$;
SELECT 'ok idempotencia: tras COMPLETO no se rehace ningun chunk' AS r;

-- 5. Grants: la funcion y el estado no son de anon.
DO $$
BEGIN
  IF has_function_privilege('anon', 'metricas_desfasaje_backfill_step()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede ejecutar el step';
  END IF;
  IF has_table_privilege('anon', 'metricas_desfasaje_backfill_estado', 'SELECT') THEN
    RAISE EXCEPTION 'anon puede leer el estado';
  END IF;
END $$;
SELECT 'ok grants del job' AS r;
