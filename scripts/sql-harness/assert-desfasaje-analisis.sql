-- Asserts de 2026-08-05-desfasaje-analisis.sql (RPC del analisis).
-- AUTOSUFICIENTE: siembra hechos propios (ids 400+, zonas 601/602, fechas
-- 2026-06-20/21 — lejos de los otros asserts) y los borra al final.
--
-- Universo del fixture (escenario 1000, URGENTE, empresa 7):
--   2026-06-20 zona 601: d_inf +40 / d_cal −5   (tarde para el Despacho)
--   2026-06-20 zona 601: d_inf −10 / d_cal −20  (a tiempo)
--   2026-06-20 zona 602: d_inf +10 / d_cal NULL (fuera de la comun)
--   2026-06-21 zona 601: d_inf −5  / d_cal −30  (a tiempo)
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
   movil, zona_nro, empresa_fletera_id, chofer,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   demora_mins, demora_efectiva_mins, atraso_vs_para_mins, atraso_vs_compromiso_mins,
   reloj_inicio, asignado_source, desfasaje_informado_mins, desfasaje_calc_mins)
VALUES
  ('PEDIDO', 401, 1000, DATE '2026-06-20', 'URGENTE', 'URGENTE',
   77, 601, 7, 'CH1',
   '2026-06-20 08:05-03', '2026-06-20 09:25-03', '2026-06-20 08:00-03', '2026-06-20 08:45-03',
   80, 80, 85, 40, 'ASIGNADO', 'CAMPO', 40, -5),
  ('PEDIDO', 402, 1000, DATE '2026-06-20', 'URGENTE', 'URGENTE',
   77, 601, 7, 'CH1',
   '2026-06-20 08:20-03', '2026-06-20 08:50-03', '2026-06-20 08:15-03', '2026-06-20 09:00-03',
   30, 30, 35, -10, 'ASIGNADO', 'CAMPO', -10, -20),
  ('PEDIDO', 403, 1000, DATE '2026-06-20', 'URGENTE', 'URGENTE',
   78, 602, 7, 'CH2',
   '2026-06-20 10:05-03', '2026-06-20 10:55-03', '2026-06-20 10:00-03', '2026-06-20 10:45-03',
   50, 50, 55, 10, 'ASIGNADO', 'CAMPO', 10, NULL),
  ('PEDIDO', 404, 1000, DATE '2026-06-21', 'URGENTE', 'URGENTE',
   77, 601, 7, 'CH1',
   '2026-06-21 09:05-03', '2026-06-21 09:45-03', '2026-06-21 09:00-03', '2026-06-21 09:50-03',
   40, 40, 45, -5, 'ASIGNADO', 'CAMPO', -5, -30);

-- ─── por_dia: la comun por fecha, Despacho vs motor ────────────────────
DO $$
DECLARE r jsonb; d jsonb;
BEGIN
  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'min_zona', 1));

  IF jsonb_array_length(r->'por_dia') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'por_dia trajo % dias (esperaba 2)', jsonb_array_length(r->'por_dia');
  END IF;

  d := r->'por_dia'->0;
  -- 20/6 comun: pedidos 401 y 402 (403 no tiene d_cal). Despacho <=25:
  -- |40|>25, |-10|<=25 -> 0.5 ; motor: |-5| y |-20| <=25 -> 1.0
  IF (d->>'fecha')         IS DISTINCT FROM '2026-06-20' THEN RAISE EXCEPTION 'dia 0 = %', d->>'fecha'; END IF;
  IF (d->>'n')::int        IS DISTINCT FROM 2    THEN RAISE EXCEPTION 'n comun 20/6 = %', d->>'n'; END IF;
  IF (d->>'despacho_le25')::numeric IS DISTINCT FROM 0.5 THEN RAISE EXCEPTION 'despacho_le25 = %', d->>'despacho_le25'; END IF;
  IF (d->>'motor_le25')::numeric    IS DISTINCT FROM 1.0 THEN RAISE EXCEPTION 'motor_le25 = %', d->>'motor_le25'; END IF;

  -- Resumen ejecutivo: la comun completa del rango (3 pedidos):
  -- Despacho |40|,|-10|,|-5| -> 2/3 ; motor |-5|,|-20|,|-30| -> 2/3
  -- (el -30 queda fuera del <=25 aunque haya llegado ANTES: el desfasaje
  -- se mide en valor absoluto, sobreprometer tambien es errar).
  IF (r->'resumen'->>'n')::int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'resumen n = %', r->'resumen'->>'n'; END IF;
  IF (r->'resumen'->>'despacho_le25')::numeric IS DISTINCT FROM 0.6667 THEN RAISE EXCEPTION 'resumen despacho = %', r->'resumen'->>'despacho_le25'; END IF;
  IF (r->'resumen'->>'motor_le25')::numeric    IS DISTINCT FROM 0.6667 THEN RAISE EXCEPTION 'resumen motor = %', r->'resumen'->>'motor_le25'; END IF;
END $$;
SELECT 'ok por_dia + resumen: poblacion comun con <=25 de las DOS proyecciones' AS r;

-- ─── fuente + por_hora + peores ────────────────────────────────────────
DO $$
DECLARE r jsonb; h jsonb; pe jsonb;
BEGIN
  -- Fuente informada (default): la hora 08:00 tiene los pedidos 401 y 402
  -- (tomas 08:00 y 08:15) -> n=2, tarde30 = 0.5 (el +40), sesgo mediana
  -- de (+40, -10) = 15, p80 de |40|,|10|.
  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'min_zona', 1));

  -- por_hora exige n>=5 por fila: con este fixture chico no hay filas — y
  -- ESO es el assert del umbral (no inventar estadistica con 2 pedidos).
  IF jsonb_array_length(r->'por_hora') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'por_hora con n<5 debia venir vacio, trajo %', r->'por_hora';
  END IF;

  -- peores (fuente informada): solo los positivos, ordenados: +40 y +10.
  IF jsonb_array_length(r->'peores') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'peores trajo % (esperaba 2: +40 y +10)', jsonb_array_length(r->'peores');
  END IF;
  pe := r->'peores'->0;
  IF (pe->>'desfasaje')::int IS DISTINCT FROM 40  THEN RAISE EXCEPTION 'peor desfasaje = %', pe->>'desfasaje'; END IF;
  IF (pe->>'zona_id')::int   IS DISTINCT FROM 601 THEN RAISE EXCEPTION 'peor zona = %', pe->>'zona_id'; END IF;
  IF (pe->>'toma')           IS DISTINCT FROM '08:00' THEN RAISE EXCEPTION 'peor toma = %', pe->>'toma'; END IF;
  -- tardo = 09:25-08:00 = 85; prometido = 85 - 40 = 45.
  IF (pe->>'tardo')::int     IS DISTINCT FROM 85  THEN RAISE EXCEPTION 'peor tardo = %', pe->>'tardo'; END IF;
  IF (pe->>'prometido')::int IS DISTINCT FROM 45  THEN RAISE EXCEPTION 'peor prometido = %', pe->>'prometido'; END IF;

  -- Fuente calculada: ningun desfasaje positivo -> peores vacio.
  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'fuente', 'calculada', 'min_zona', 1));
  IF jsonb_array_length(r->'peores') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'peores con fuente calculada debia venir vacio (todos negativos)';
  END IF;
END $$;
SELECT 'ok fuente + peores: positivos ordenados con prometido/tardo, y el umbral n>=5 de por_hora' AS r;

-- ─── por_zona + filtro por fecha ───────────────────────────────────────
DO $$
DECLARE r jsonb; z jsonb;
BEGIN
  -- Sin fecha, min_zona 1: zona 601 n=3 (401, 402, 404), 602 n=1.
  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'min_zona', 2));
  IF jsonb_array_length(r->'por_zona') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'por_zona con min 2 trajo % zonas (esperaba solo la 601)', jsonb_array_length(r->'por_zona');
  END IF;
  z := r->'por_zona'->0;
  IF (z->>'zona_id')::int IS DISTINCT FROM 601 THEN RAISE EXCEPTION 'zona = %', z->>'zona_id'; END IF;
  IF (z->>'n')::int       IS DISTINCT FROM 3   THEN RAISE EXCEPTION 'zona n = %', z->>'n'; END IF;
  -- a_tiempo (d<=0): -10 y -5 de 3 -> 0.6667 ; tarde30: el +40 -> 0.3333
  IF (z->>'a_tiempo_pct')::numeric IS DISTINCT FROM 0.6667 THEN RAISE EXCEPTION 'a_tiempo = %', z->>'a_tiempo_pct'; END IF;
  IF (z->>'tarde30_pct')::numeric  IS DISTINCT FROM 0.3333 THEN RAISE EXCEPTION 'tarde30 = %', z->>'tarde30_pct'; END IF;
  -- Head-to-head de la zona sobre su comun (los 3 tienen ambas):
  -- Despacho |40|,|-10|,|-5| -> 2/3 ; motor |-5|,|-20|,|-30| -> 2/3.
  IF (z->>'n_comun')::int          IS DISTINCT FROM 3      THEN RAISE EXCEPTION 'zona n_comun = %', z->>'n_comun'; END IF;
  IF (z->>'despacho_le25')::numeric IS DISTINCT FROM 0.6667 THEN RAISE EXCEPTION 'zona despacho_le25 = %', z->>'despacho_le25'; END IF;
  IF (z->>'motor_le25')::numeric    IS DISTINCT FROM 0.6667 THEN RAISE EXCEPTION 'zona motor_le25 = %', z->>'motor_le25'; END IF;

  -- Filtro por fecha: el 21/6 la zona 601 tiene UN pedido (-5).
  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'fecha', '2026-06-21', 'min_zona', 1));
  IF jsonb_array_length(r->'por_zona') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'por_zona filtrado al 21/6 trajo %', jsonb_array_length(r->'por_zona');
  END IF;
  IF (r->'por_zona'->0->>'n')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'zona 601 el 21/6 n = %', r->'por_zona'->0->>'n';
  END IF;
  -- por_dia NO se filtra (es el indice de dias del selector).
  IF jsonb_array_length(r->'por_dia') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'por_dia debia seguir con 2 dias con el filtro puesto';
  END IF;
END $$;
SELECT 'ok por_zona (umbral + metricas) y filtro por fecha (por_dia no se filtra)' AS r;

-- ─── fail-closed y payload vacio ───────────────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'empresas', '[]'::jsonb));
  IF r->'rango' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'empresas [] debia dar payload vacio (fail-closed)';
  END IF;

  r := metricas_desfasaje_analisis(jsonb_build_object(
    'escenario', 1000, 'desde', '2026-06-20', 'hasta', '2026-06-21',
    'empresas', jsonb_build_array(999)));
  IF jsonb_array_length(r->'por_dia') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'empresa fuera de scope debia dar por_dia vacio';
  END IF;
END $$;
SELECT 'ok fail-closed: empresas [] = vacio; empresa ajena no ve nada' AS r;

-- ─── Teardown ──────────────────────────────────────────────────────────
DELETE FROM metricas_cumplimiento WHERE pedido_id IN (401, 402, 403, 404) AND escenario = 1000;
SELECT 'ok teardown desfasaje-analisis' AS r;
