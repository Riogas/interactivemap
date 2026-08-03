-- Asserts de 2026-08-03-desfasaje-demoras.sql (run + RPC + espejo).
-- Requiere aplicar antes: 2026-07-29-demoras-calculadas-tabla.sql y la
-- migración de desfasaje. Valores del fixture TODOS distintos entre sí:
-- un mapeo cruzado de columnas no puede pasar.

-- ─── Fixture ───────────────────────────────────────────────────────────
-- Corridas del motor. La de 09:30 es más vieja que la de 09:55 (gana la
-- más nueva <= toma); la de 10:05 es POSTERIOR a la toma de P1 (10:00) y
-- no puede usarse; la de 09:35 para zona 20 queda a 25 min de una toma
-- 10:00 (pasa el tope de 20') y tampoco.
INSERT INTO demoras_calculadas
  (corrida_at, escenario, zona_id, tipo_servicio, demora_informada, demora_suavizada, demora_cruda)
VALUES
  ('2026-08-03 09:30-03', 1000, 10, 'URGENTE',  30, 30, 30.0),
  ('2026-08-03 09:55-03', 1000, 10, 'URGENTE',  45, 45, 45.0),
  ('2026-08-03 10:05-03', 1000, 10, 'URGENTE',  77, 77, 77.0),
  ('2026-08-03 19:50-03', 1000, 11, 'NOCTURNO', 15, 15, 15.0),
  ('2026-08-03 09:35-03', 1000, 20, 'URGENTE',  99, 99, 99.0),
  -- Exactamente 20:00 antes de la toma de P9 (12:00): el borde INCLUIDO.
  ('2026-08-03 11:40-03', 1000, 22, 'URGENTE',  33, 33, 33.0);

INSERT INTO pedidos
  (id, escenario, servicio_nombre, zona_nro, empresa_fletera_id, movil, fletero,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   estado_nro, sub_estado_nro, orden_cancelacion, demora_informada)
VALUES
  -- P1: URGENTE limpio. desf_inf = 50-40 = +10; proy 45 (corrida 09:55) -> desf_calc = 50-45 = +5.
  (1, 1000, 'URGENTE', 10, 7, 101, 'CHOFER A',
   '2026-08-03 10:05-03', '2026-08-03 10:50-03', '2026-08-03 10:00-03', '2026-08-03 10:40-03',
   2, 3, 'N', 40),
  -- P2: NOCTURNO que llegó ANTES de lo proyectado. desf_inf = 40-75 = -35; proy 15 -> desf_calc = +25.
  (2, 1000, 'NOCTURNO', 11, 8, 102, 'CHOFER B',
   '2026-08-03 20:03-03', '2026-08-03 20:40-03', '2026-08-03 20:00-03', '2026-08-03 21:15-03',
   2, 3, 'N', 75),
  -- P4: AGENDADO (asignado 09:00 + 60' < para 13:00) -> desfasajes NULL, reloj PARA.
  (4, 1000, 'URGENTE', 10, 7, 103, 'CHOFER C',
   '2026-08-03 09:00-03', '2026-08-03 13:30-03', '2026-08-03 13:00-03', '2026-08-03 13:40-03',
   2, 3, 'N', 40),
  -- P5: desfasaje CERO (no NULL). Corrida de zona 20 a 25 min de la toma -> calc NULL (tope 20').
  (5, 1000, 'URGENTE', 20, 7, 104, 'CHOFER D',
   '2026-08-03 10:02-03', '2026-08-03 10:30-03', '2026-08-03 10:00-03', '2026-08-03 10:30-03',
   2, 3, 'N', 30),
  -- P6: demora_informada = 0 = sin dato -> desf_inf NULL. Para su toma
  --     (10:10) hay DOS corridas frescas (09:55 y 10:05): gana la más
  --     nueva -> proy 77 -> desf_calc = 60-77 = -17.
  (6, 1000, 'URGENTE', 10, 7, 105, 'CHOFER E',
   '2026-08-03 10:12-03', '2026-08-03 11:10-03', '2026-08-03 10:10-03', NULL,
   2, 3, 'N', 0),
  -- P7: desfasaje 120 -> franja "90+". Sin corrida para zona 21 -> calc NULL.
  (7, 1000, 'URGENTE', 21, 9, 106, 'CHOFER F',
   '2026-08-03 08:05-03', '2026-08-03 10:30-03', '2026-08-03 08:00-03', '2026-08-03 08:30-03',
   2, 3, 'N', 30),
  -- P8: cancelado -> no entra al run.
  (8, 1000, 'URGENTE', 10, 7, 107, 'CHOFER G',
   '2026-08-03 10:05-03', '2026-08-03 10:50-03', '2026-08-03 10:00-03', '2026-08-03 10:40-03',
   2, 3, 'S', 40),
  -- P9: corrida EXACTAMENTE 20:00 antes de la toma -> el borde cuenta.
  --     desf_inf = 40-20 = +20; proy 33 -> desf_calc = 40-33 = +7.
  (9, 1000, 'URGENTE', 22, 9, 109, 'CHOFER I',
   '2026-08-03 12:02-03', '2026-08-03 12:40-03', '2026-08-03 12:00-03', '2026-08-03 12:20-03',
   2, 3, 'N', 20);

INSERT INTO services
  (id, escenario, servicio_nombre, zona_nro, empresa_fletera_id, movil, fletero,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   estado_nro, sub_estado_nro, orden_cancelacion, demora_informada)
VALUES
  -- S1: SERVICE fuera del universo: snapshot 240 persiste, desfasajes NULL.
  (100, 1000, NULL, 10, 7, 108, 'CHOFER H',
   '2026-08-03 10:05-03', '2026-08-03 11:00-03', '2026-08-03 10:00-03', '2026-08-03 14:00-03',
   2, 3, 'N', 240);

-- ─── Run ───────────────────────────────────────────────────────────────
DO $$
DECLARE v bigint;
BEGIN
  v := metricas_cumplimiento_run('2026-08-03', '2026-08-03');
  IF v <> 8 THEN RAISE EXCEPTION 'run devolvio % hechos, esperaba 8 (P1,P2,P4,P5,P6,P7,P9,S1)', v; END IF;
END $$;
SELECT 'ok run escribio 8 hechos (el cancelado quedo afuera)' AS r;

-- 1. P1: desfasaje informado +10, proy 45 de la corrida 09:55 (ni la de
--    09:30 mas vieja ni la de 10:05 posterior a la toma), desf_calc +5.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=1;
  IF m.demora_informada_mins       IS DISTINCT FROM 40    THEN RAISE EXCEPTION 'P1 demora_informada_mins=%', m.demora_informada_mins; END IF;
  IF m.desfasaje_informado_mins    IS DISTINCT FROM 10.00 THEN RAISE EXCEPTION 'P1 desf_inf=%', m.desfasaje_informado_mins; END IF;
  IF m.demora_proyectada_calc_mins IS DISTINCT FROM 45    THEN RAISE EXCEPTION 'P1 proy=% (debia ganar la corrida 09:55)', m.demora_proyectada_calc_mins; END IF;
  IF m.corrida_calc_at             IS DISTINCT FROM timestamptz '2026-08-03 09:55-03' THEN RAISE EXCEPTION 'P1 corrida=%', m.corrida_calc_at; END IF;
  IF m.desfasaje_calc_mins         IS DISTINCT FROM 5.00  THEN RAISE EXCEPTION 'P1 desf_calc=%', m.desfasaje_calc_mins; END IF;
END $$;
SELECT 'ok P1: informado +10 / motor +5 con la corrida correcta (09:55)' AS r;

-- 2. P2: NOCTURNO con signo negativo (llego antes) y motor propio.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=2;
  IF m.desfasaje_informado_mins    IS DISTINCT FROM -35.00 THEN RAISE EXCEPTION 'P2 desf_inf=%', m.desfasaje_informado_mins; END IF;
  IF m.demora_proyectada_calc_mins IS DISTINCT FROM 15     THEN RAISE EXCEPTION 'P2 proy=%', m.demora_proyectada_calc_mins; END IF;
  IF m.desfasaje_calc_mins         IS DISTINCT FROM 25.00  THEN RAISE EXCEPTION 'P2 desf_calc=%', m.desfasaje_calc_mins; END IF;
END $$;
SELECT 'ok P2: nocturno -35 informado / +25 motor (el signo se conserva)' AS r;

-- 3. P4 agendado: NULL en los tres, aunque tiene demora informada y corrida fresca.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=4;
  IF m.reloj_inicio <> 'PARA' THEN RAISE EXCEPTION 'P4 reloj=%', m.reloj_inicio; END IF;
  IF m.desfasaje_informado_mins IS NOT NULL OR m.desfasaje_calc_mins IS NOT NULL
     OR m.demora_proyectada_calc_mins IS NOT NULL THEN
    RAISE EXCEPTION 'P4 agendado con desfasaje: inf=% calc=%', m.desfasaje_informado_mins, m.desfasaje_calc_mins;
  END IF;
END $$;
SELECT 'ok P4: agendado excluido (desfasajes NULL)' AS r;

-- 4. P5: desfasaje CERO no es NULL; corrida a 25 min -> motor NULL (tope 20').
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=5;
  IF m.desfasaje_informado_mins IS DISTINCT FROM 0.00 THEN RAISE EXCEPTION 'P5 desf_inf=% (0 es un valor, no un NULL)', m.desfasaje_informado_mins; END IF;
  IF m.desfasaje_calc_mins IS NOT NULL OR m.demora_proyectada_calc_mins IS NOT NULL THEN
    RAISE EXCEPTION 'P5 uso una corrida a 25 min de la toma (tope 20): proy=%', m.demora_proyectada_calc_mins;
  END IF;
END $$;
SELECT 'ok P5: desfasaje 0 valido / corrida vieja descartada por el tope de 20 min' AS r;

-- 5. P6: demora informada 0 = sin dato -> inf NULL; motor si, y con la
--    corrida MAS NUEVA <= toma (10:05 le gana a 09:55).
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=6;
  IF m.demora_informada_mins IS NOT NULL OR m.desfasaje_informado_mins IS NOT NULL THEN
    RAISE EXCEPTION 'P6 demora 0 tratada como dato: dem=% desf=%', m.demora_informada_mins, m.desfasaje_informado_mins;
  END IF;
  IF m.demora_proyectada_calc_mins IS DISTINCT FROM 77 THEN RAISE EXCEPTION 'P6 proy=% (debia ganar la 10:05)', m.demora_proyectada_calc_mins; END IF;
  IF m.corrida_calc_at IS DISTINCT FROM timestamptz '2026-08-03 10:05-03' THEN RAISE EXCEPTION 'P6 corrida=%', m.corrida_calc_at; END IF;
  IF m.desfasaje_calc_mins IS DISTINCT FROM -17.00 THEN RAISE EXCEPTION 'P6 desf_calc=%', m.desfasaje_calc_mins; END IF;
END $$;
SELECT 'ok P6: demora_informada=0 es sin dato; motor -17 con la corrida mas nueva (10:05)' AS r;

-- 5b. P9: la corrida a EXACTAMENTE 20:00 de la toma cuenta (borde
--     incluido — el COMMENT promete "a lo sumo 20 min más vieja").
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=9;
  IF m.desfasaje_informado_mins    IS DISTINCT FROM 20.00 THEN RAISE EXCEPTION 'P9 desf_inf=%', m.desfasaje_informado_mins; END IF;
  IF m.demora_proyectada_calc_mins IS DISTINCT FROM 33    THEN RAISE EXCEPTION 'P9 proy=% (el borde 20:00 debia contar)', m.demora_proyectada_calc_mins; END IF;
  IF m.corrida_calc_at             IS DISTINCT FROM timestamptz '2026-08-03 11:40-03' THEN RAISE EXCEPTION 'P9 corrida=%', m.corrida_calc_at; END IF;
  IF m.desfasaje_calc_mins         IS DISTINCT FROM 7.00  THEN RAISE EXCEPTION 'P9 desf_calc=%', m.desfasaje_calc_mins; END IF;
END $$;
SELECT 'ok P9: corrida a 20:00 exactos incluida (borde >=), +20 informado / +7 motor' AS r;

-- 6. S1 SERVICE: snapshot persiste, desfasajes NULL (universo).
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM metricas_cumplimiento WHERE origen='SERVICE' AND pedido_id=100;
  IF m.demora_informada_mins IS DISTINCT FROM 240 THEN RAISE EXCEPTION 'S1 snapshot=%', m.demora_informada_mins; END IF;
  IF m.desfasaje_informado_mins IS NOT NULL OR m.desfasaje_calc_mins IS NOT NULL THEN
    RAISE EXCEPTION 'S1 SERVICE con desfasaje: inf=% calc=%', m.desfasaje_informado_mins, m.desfasaje_calc_mins;
  END IF;
END $$;
SELECT 'ok S1: SERVICE fuera del universo (snapshot 240 persistido, sin desfasajes)' AS r;

-- 7. Espejo en pedidos: P1 completo, P5 solo informado, P6 solo motor.
--    services NO tiene columnas espejo.
DO $$
DECLARE p record; n int;
BEGIN
  SELECT * INTO p FROM pedidos WHERE id=1 AND escenario=1000;
  IF p.desfasaje_informado_mins    IS DISTINCT FROM 10.00 THEN RAISE EXCEPTION 'espejo P1 inf=%', p.desfasaje_informado_mins; END IF;
  IF p.demora_proyectada_calc_mins IS DISTINCT FROM 45    THEN RAISE EXCEPTION 'espejo P1 proy=%', p.demora_proyectada_calc_mins; END IF;
  IF p.corrida_calc_at             IS DISTINCT FROM timestamptz '2026-08-03 09:55-03' THEN RAISE EXCEPTION 'espejo P1 corrida=%', p.corrida_calc_at; END IF;
  IF p.desfasaje_calc_mins         IS DISTINCT FROM 5.00  THEN RAISE EXCEPTION 'espejo P1 calc=%', p.desfasaje_calc_mins; END IF;

  SELECT * INTO p FROM pedidos WHERE id=5 AND escenario=1000;
  IF p.desfasaje_informado_mins IS DISTINCT FROM 0.00 OR p.desfasaje_calc_mins IS NOT NULL THEN
    RAISE EXCEPTION 'espejo P5 inf=% calc=%', p.desfasaje_informado_mins, p.desfasaje_calc_mins;
  END IF;

  SELECT * INTO p FROM pedidos WHERE id=6 AND escenario=1000;
  IF p.desfasaje_informado_mins IS NOT NULL OR p.desfasaje_calc_mins IS DISTINCT FROM -17.00 THEN
    RAISE EXCEPTION 'espejo P6 inf=% calc=%', p.desfasaje_informado_mins, p.desfasaje_calc_mins;
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'services' AND column_name = 'desfasaje_informado_mins';
  IF n <> 0 THEN RAISE EXCEPTION 'services no debia tener columnas espejo'; END IF;
END $$;
SELECT 'ok espejo en pedidos (P1/P5/P6) y services sin espejo' AS r;

-- 8. Idempotencia: segunda corrida, mismos valores.
DO $$
DECLARE v bigint; d numeric;
BEGIN
  v := metricas_cumplimiento_run('2026-08-03', '2026-08-03');
  IF v <> 8 THEN RAISE EXCEPTION 'segunda corrida devolvio %', v; END IF;
  SELECT desfasaje_informado_mins INTO d FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=1;
  IF d IS DISTINCT FROM 10.00 THEN RAISE EXCEPTION 'P1 cambio tras recorrer: %', d; END IF;
END $$;
SELECT 'ok idempotencia: recorrer el dia no cambia nada' AS r;

-- ─── RPC metricas_desfasaje ───────────────────────────────────────────
-- Poblacion informada: {+10, -35, 0, +120, +20} n=5. Calculada:
-- {+5, +25, -17, +7} n=4. Comun (ambos): P1, P2 y P9, n=3.
DO $$
DECLARE j jsonb;
BEGIN
  j := metricas_desfasaje('{"escenario":1000,"desde":"2026-08-03","hasta":"2026-08-03"}'::jsonb);

  IF (j->'kpis'->'informada'->>'n')::int <> 5 THEN RAISE EXCEPTION 'n_inf=%', j->'kpis'->'informada'->>'n'; END IF;
  IF (j->'kpis'->'calculada'->>'n')::int <> 4 THEN RAISE EXCEPTION 'n_cal=%', j->'kpis'->'calculada'->>'n'; END IF;
  IF (j->'kpis'->'comun'->>'n')::int     <> 3 THEN RAISE EXCEPTION 'n_comun=%', j->'kpis'->'comun'->>'n'; END IF;

  -- informada abs {10,35,0,120,20}: <=25 -> 3/5; <=90 -> 4/5; p80 = 35+0.2*85 = 52.0
  IF (j->'kpis'->'informada'->>'pct_le_25')::numeric <> 0.6    THEN RAISE EXCEPTION 'inf le25=%', j->'kpis'->'informada'->>'pct_le_25'; END IF;
  IF (j->'kpis'->'informada'->>'pct_le_90')::numeric <> 0.8    THEN RAISE EXCEPTION 'inf le90=%', j->'kpis'->'informada'->>'pct_le_90'; END IF;
  IF (j->'kpis'->'informada'->>'p80')::numeric       <> 52.0   THEN RAISE EXCEPTION 'inf p80=%', j->'kpis'->'informada'->>'p80'; END IF;

  -- calculada abs {5,25,17,7}: <=25 -> 1.0; p80 = 17+0.4*8 = 20.2
  IF (j->'kpis'->'calculada'->>'pct_le_25')::numeric <> 1.0    THEN RAISE EXCEPTION 'cal le25=%', j->'kpis'->'calculada'->>'pct_le_25'; END IF;
  IF (j->'kpis'->'calculada'->>'p80')::numeric       <> 20.2   THEN RAISE EXCEPTION 'cal p80=%', j->'kpis'->'calculada'->>'p80'; END IF;

  -- comun: informada {10,35,20} le25 = 2/3, p80 = 20+0.6*15 = 29.0;
  --        calculada {5,25,7}  le25 = 1.0, p80 = 7+0.6*18 = 17.8
  IF (j->'kpis'->'comun'->'informada'->>'pct_le_25')::numeric <> 0.6667 THEN RAISE EXCEPTION 'comun inf le25=%', j->'kpis'->'comun'->'informada'->>'pct_le_25'; END IF;
  IF (j->'kpis'->'comun'->'informada'->>'p80')::numeric       <> 29.0   THEN RAISE EXCEPTION 'comun inf p80=%', j->'kpis'->'comun'->'informada'->>'p80'; END IF;
  IF (j->'kpis'->'comun'->'calculada'->>'pct_le_25')::numeric <> 1.0    THEN RAISE EXCEPTION 'comun cal le25=%', j->'kpis'->'comun'->'calculada'->>'pct_le_25'; END IF;
  IF (j->'kpis'->'comun'->'calculada'->>'p80')::numeric       <> 17.8   THEN RAISE EXCEPTION 'comun cal p80=%', j->'kpis'->'comun'->'calculada'->>'p80'; END IF;
END $$;
SELECT 'ok RPC kpis: n 5/4/3, le25 0.6/1.0, p80 52/20.2 y comun 29/17.8' AS r;

DO $$
DECLARE j jsonb; f jsonb;
BEGIN
  j := metricas_desfasaje('{"escenario":1000,"desde":"2026-08-03","hasta":"2026-08-03"}'::jsonb);

  IF jsonb_array_length(j->'franjas') <> 19 THEN RAISE EXCEPTION 'franjas=%', jsonb_array_length(j->'franjas'); END IF;

  -- franja 5: P5 (abs 0) informada, P1 (5) calculada; comun_calculada 1 (P1 tiene ambos), comun_informada 0.
  SELECT x INTO f FROM jsonb_array_elements(j->'franjas') x WHERE (x->>'tope')::int = 5;
  IF (f->>'informada_n')::int <> 1 OR (f->>'calculada_n')::int <> 1
     OR (f->>'comun_informada_n')::int <> 0 OR (f->>'comun_calculada_n')::int <> 1 THEN
    RAISE EXCEPTION 'franja 5: %', f;
  END IF;

  -- franja 10: P1 informada (tambien en la comun) + P9 calculada (7).
  SELECT x INTO f FROM jsonb_array_elements(j->'franjas') x WHERE (x->>'tope')::int = 10;
  IF (f->>'informada_n')::int <> 1 OR (f->>'comun_informada_n')::int <> 1
     OR (f->>'calculada_n')::int <> 1 OR (f->>'comun_calculada_n')::int <> 1 THEN
    RAISE EXCEPTION 'franja 10: %', f;
  END IF;

  -- franja 20: P9 informada (20, en la comun) + P6 calculada (abs de -17,
  -- sin lado informado -> fuera de la comun).
  SELECT x INTO f FROM jsonb_array_elements(j->'franjas') x WHERE (x->>'tope')::int = 20;
  IF (f->>'informada_n')::int <> 1 OR (f->>'comun_informada_n')::int <> 1
     OR (f->>'calculada_n')::int <> 1 OR (f->>'comun_calculada_n')::int <> 0 THEN
    RAISE EXCEPTION 'franja 20: %', f;
  END IF;

  -- franja 35: P2 informada (abs de -35). El signo no cambia la franja.
  SELECT x INTO f FROM jsonb_array_elements(j->'franjas') x WHERE (x->>'tope')::int = 35;
  IF (f->>'informada_n')::int <> 1 OR (f->>'comun_informada_n')::int <> 1 THEN RAISE EXCEPTION 'franja 35: %', f; END IF;

  -- franja 95 = "90+": P7 (120).
  SELECT x INTO f FROM jsonb_array_elements(j->'franjas') x WHERE (x->>'tope')::int = 95;
  IF f->>'label' <> '90+' OR (f->>'informada_n')::int <> 1 THEN RAISE EXCEPTION 'franja 90+: %', f; END IF;

  -- pct de franja sobre SU poblacion: franja 10 informada = 1/5.
  SELECT x INTO f FROM jsonb_array_elements(j->'franjas') x WHERE (x->>'tope')::int = 10;
  IF (f->>'informada_pct')::numeric <> 0.2 THEN RAISE EXCEPTION 'franja 10 pct=%', f->>'informada_pct'; END IF;
END $$;
SELECT 'ok RPC franjas: 19 topes, buckets correctos (0->5, -35->35, 120->90+), pct sobre su poblacion' AS r;

-- Filtros: tipo y empresas (fail-closed con []).
DO $$
DECLARE j jsonb;
BEGIN
  j := metricas_desfasaje('{"escenario":1000,"desde":"2026-08-03","hasta":"2026-08-03","tipo":"URGENTE"}'::jsonb);
  IF (j->'kpis'->'informada'->>'n')::int <> 4 THEN RAISE EXCEPTION 'tipo URGENTE n_inf=%', j->'kpis'->'informada'->>'n'; END IF;
  IF (j->'kpis'->'calculada'->>'n')::int <> 3 THEN RAISE EXCEPTION 'tipo URGENTE n_cal=%', j->'kpis'->'calculada'->>'n'; END IF;
  IF (j->'kpis'->'comun'->>'n')::int     <> 2 THEN RAISE EXCEPTION 'tipo URGENTE n_comun=%', j->'kpis'->'comun'->>'n'; END IF;

  j := metricas_desfasaje('{"escenario":1000,"desde":"2026-08-03","hasta":"2026-08-03","empresas":[7]}'::jsonb);
  IF (j->'kpis'->'informada'->>'n')::int <> 2 THEN RAISE EXCEPTION 'empresa 7 n_inf=%', j->'kpis'->'informada'->>'n'; END IF;
  IF (j->'kpis'->'calculada'->>'n')::int <> 2 THEN RAISE EXCEPTION 'empresa 7 n_cal=%', j->'kpis'->'calculada'->>'n'; END IF;

  j := metricas_desfasaje('{"escenario":1000,"empresas":[]}'::jsonb);
  IF j->'kpis' <> 'null'::jsonb OR jsonb_array_length(j->'franjas') <> 0 THEN
    RAISE EXCEPTION 'empresas=[] no fail-closed: %', j;
  END IF;
END $$;
SELECT 'ok RPC filtros: tipo URGENTE (4/3/2), empresa 7 (2/2) y [] fail-closed' AS r;

-- Grants: la RPC nueva es solo service_role (la anon key viaja al browser).
DO $$
BEGIN
  IF has_function_privilege('anon', 'metricas_desfasaje(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede ejecutar metricas_desfasaje';
  END IF;
  IF has_function_privilege('authenticated', 'metricas_desfasaje(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated puede ejecutar metricas_desfasaje';
  END IF;
  IF NOT has_function_privilege('service_role', 'metricas_desfasaje(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role NO puede ejecutar metricas_desfasaje';
  END IF;
END $$;
SELECT 'ok grants: metricas_desfasaje solo service_role' AS r;

-- ─── Espejo huérfano (VA ÚLTIMO: muta el fixture) ─────────────────────
-- El AS400 manda la cancelación DESPUÉS de la entrega: el reproceso purga
-- el hecho y el espejo del pedido tiene que limpiarse — un desfasaje que
-- las métricas ya no cuentan no puede quedar vivo en pedidos.
DO $$
DECLARE v bigint; p record; n int;
BEGIN
  UPDATE pedidos SET orden_cancelacion = 'S' WHERE id = 1 AND escenario = 1000;
  v := metricas_cumplimiento_run('2026-08-03', '2026-08-03');
  IF v <> 7 THEN RAISE EXCEPTION 'tras cancelar P1 el run devolvio % (esperaba 7)', v; END IF;

  SELECT count(*) INTO n FROM metricas_cumplimiento WHERE origen='PEDIDO' AND pedido_id=1;
  IF n <> 0 THEN RAISE EXCEPTION 'el hecho de P1 no se purgo'; END IF;

  SELECT * INTO p FROM pedidos WHERE id=1 AND escenario=1000;
  IF p.desfasaje_informado_mins IS NOT NULL OR p.desfasaje_calc_mins IS NOT NULL
     OR p.demora_proyectada_calc_mins IS NOT NULL OR p.corrida_calc_at IS NOT NULL THEN
    RAISE EXCEPTION 'espejo huerfano vivo en P1: inf=% calc=%', p.desfasaje_informado_mins, p.desfasaje_calc_mins;
  END IF;

  -- Y un pedido NO cancelado del mismo rango conserva su espejo intacto.
  SELECT * INTO p FROM pedidos WHERE id=9 AND escenario=1000;
  IF p.desfasaje_informado_mins IS DISTINCT FROM 20.00 THEN
    RAISE EXCEPTION 'la limpieza se llevo el espejo de P9: %', p.desfasaje_informado_mins;
  END IF;
END $$;
SELECT 'ok espejo huerfano: cancelacion post-entrega purga hecho Y espejo (sin tocar a los demas)' AS r;
