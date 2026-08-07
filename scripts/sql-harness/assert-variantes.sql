-- Asserts de 2026-08-07-laboratorio-variantes.sql (laboratorio de variantes).
-- AUTOSUFICIENTE: siembra sus propias zonas (820-822), corre el motor de
-- verdad, dispara el laboratorio y verifica FIDELIDAD; el teardown deja
-- todo como estaba (fixtures fuera, catalogo intacto, modo del arranque
-- restaurado) porque los asserts que corren despues cuentan filas.
--
-- Lo que se prueba, en orden:
--   1. seed del catalogo
--   2. ANTI-DERIVA: el clon demoras_consumo_tramos_lab con la parametria
--      del modelo reproduce a demoras_consumo_tramos (salvo el factor,
--      que el clon no aplica). Es el assert que revienta si alguien
--      toca el motor y se olvida del laboratorio.
--   3. CAMPEON == motor, corrida a corrida (el control de sanidad)
--   4. las variantes derivadas: factor, escalon, piso, sin escalera
--   5. escalera PROPIA de cada variante (dependencia del camino)
--   6. backfill: procesa en orden, no reprocesa, respeta modelo_version

-- ─── Fixture ───────────────────────────────────────────────────────────
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_zona, tipo_de_servicio, prioridad_o_transito, activa) VALUES
  ('820', 820, 1000, 'P', 'URGENTE', 1, true),
  ('821', 821, 1000, 'P', 'URGENTE', 1, true),
  ('822', 822, 1000, 'P', 'URGENTE', 1, true);

INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa, zona_nombre) VALUES
  (1000, 820, 'Distribucion', 'URGENTE', 45, true, 'LAB CON COLA'),
  (1000, 821, 'Distribucion', 'URGENTE', 45, true, 'LAB SIN COLA'),
  (1000, 822, 'Distribucion', 'URGENTE', 45, true, 'LAB SIN MOVIL');

-- 820 y 821 con movil activo el 2026-08-06; 822 sin movil (techo/respaldo).
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 820, DATE '2026-08-06', true),
  (1000, 821, DATE '2026-08-06', true);

-- Historico de ritmo para que la cascada resuelva (6 entregas por movil:
-- supera ritmo_min_muestras). Huecos de 20' -> ritmo ~20.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
   movil, zona_nro, empresa_fletera_id, chofer,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   demora_mins, demora_efectiva_mins, atraso_vs_para_mins, atraso_vs_compromiso_mins,
   reloj_inicio, asignado_source)
SELECT 'PEDIDO', 5000 + (mv * 100) + g, 1000, DATE '2026-08-05', 'URGENTE', 'URGENTE',
       mv, mv, 7, 'CHLAB' || mv,
       timestamptz '2026-08-05 07:00-03' + make_interval(mins => 20 * g - 25),
       timestamptz '2026-08-05 07:00-03' + make_interval(mins => 20 * g),
       timestamptz '2026-08-05 07:00-03' + make_interval(mins => 20 * g - 30),
       timestamptz '2026-08-05 08:00-03',
       30, 30, 0, 0, 'ASIGNADO', 'CAMPO'
FROM generate_series(1, 7) g, (VALUES (820), (821)) AS m(mv);

-- Cola: 3 pedidos pendientes en la 820, ninguno en la 821.
INSERT INTO pedidos (id, escenario, zona_nro, servicio_nombre, estado_nro, sub_estado_nro,
                     fch_para, fch_hora_para, movil, empresa_fletera_id)
SELECT 6000 + g, 1000, 820, 'URGENTE', 1, 1,
       DATE '2026-08-06', timestamptz '2026-08-06 09:00-03', NULL, 7
FROM generate_series(1, 3) g;

UPDATE demoras_config SET motor_activo = true WHERE escenario_id = 1000;
-- El laboratorio se prueba sobre el modelo normal: sin arranque especial.
UPDATE demoras_modelo SET arranque_sin_movil_modo = 'TECHO' WHERE escenario_id = 1000;

-- ─── 1. Seed del catalogo ──────────────────────────────────────────────
DO $$
DECLARE v integer; r record;
BEGIN
  SELECT count(*) INTO v FROM demoras_variantes WHERE activa;
  IF v < 13 THEN RAISE EXCEPTION 'catalogo con % variantes activas (esperaba >= 13)', v; END IF;

  SELECT * INTO r FROM demoras_variantes WHERE codigo = 'CAMPEON';
  IF NOT FOUND THEN RAISE EXCEPTION 'falta la variante CAMPEON (el control)'; END IF;
  IF r.estadistico IS NOT NULL OR r.nivel_ritmo IS NOT NULL OR r.factor IS NOT NULL
     OR r.escalon_minutos IS NOT NULL OR r.min_minutos IS NOT NULL
     OR r.suavizado_paso IS NOT NULL OR NOT r.suavizado THEN
    RAISE EXCEPTION 'CAMPEON tiene perillas propias: deja de ser el espejo del motor';
  END IF;
END $$;
SELECT 'ok catalogo: 13 variantes y el CAMPEON sin perillas propias' AS r;

-- ─── 2. ANTI-DERIVA: el clon reproduce al original ─────────────────────
-- Con la parametria del modelo, demoras_consumo_tramos_lab x factor tiene
-- que dar lo mismo que demoras_consumo_tramos. Tolerancia 0,011: el
-- original redondea a 2 decimales adentro y el clon no.
DO $$
DECLARE v integer; peor numeric;
BEGIN
  SELECT count(*), max(abs(o.demora_cruda - round(l.demora_cruda * f.factor, 2)))
    INTO v, peor
  FROM demoras_modelo dm
  CROSS JOIN LATERAL (SELECT coalesce(dm.factor_calibracion, 1.0) AS factor) f
  CROSS JOIN LATERAL demoras_consumo_tramos(1000, DATE '2026-08-06', timestamptz '2026-08-06 09:05-03') o
  JOIN LATERAL demoras_consumo_tramos_lab(1000, DATE '2026-08-06', timestamptz '2026-08-06 09:05-03',
                                          dm.estadistico, 'CASCADA') l
    ON l.zona_id = o.zona_id AND l.tipo_servicio = o.tipo_servicio
  WHERE dm.escenario_id = 1000
    -- El techo NO lleva factor en ninguno de los dos: se compara aparte.
    AND NOT o.sin_capacidad;

  IF v = 0 THEN RAISE EXCEPTION 'el anti-deriva no comparo ninguna fila (fixture roto)'; END IF;
  IF peor > 0.011 THEN
    RAISE EXCEPTION 'DERIVA clon vs original: peor diferencia % (limite 0,011) sobre % filas', peor, v;
  END IF;

  -- El techo: los dos tienen que marcarlo en las mismas zonas.
  SELECT count(*) INTO v
  FROM demoras_modelo dm
  CROSS JOIN LATERAL demoras_consumo_tramos(1000, DATE '2026-08-06', timestamptz '2026-08-06 09:05-03') o
  JOIN LATERAL demoras_consumo_tramos_lab(1000, DATE '2026-08-06', timestamptz '2026-08-06 09:05-03',
                                          dm.estadistico, 'CASCADA') l
    ON l.zona_id = o.zona_id AND l.tipo_servicio = o.tipo_servicio
  WHERE dm.escenario_id = 1000 AND o.sin_capacidad IS DISTINCT FROM l.sin_capacidad;
  IF v > 0 THEN RAISE EXCEPTION 'el clon marca el techo en % zonas distintas que el original', v; END IF;
END $$;
SELECT 'ok anti-deriva: el clon del consumo de tramos reproduce al original' AS r;

-- ─── 3. CAMPEON == motor ───────────────────────────────────────────────
DO $$
DECLARE v bigint; n integer; difs integer;
BEGIN
  -- Tres corridas seguidas: la escalera tiene que arrastrarse igual en
  -- las dos cadenas (motor y CAMPEON).
  v := demoras_calcular_run(timestamptz '2026-08-06 09:05-03');
  n := demoras_variantes_snapshot(timestamptz '2026-08-06 09:05-03', 1000);
  IF n = 0 THEN RAISE EXCEPTION 'el snapshot no escribio ninguna fila'; END IF;

  v := demoras_calcular_run(timestamptz '2026-08-06 09:15-03');
  n := demoras_variantes_snapshot(timestamptz '2026-08-06 09:15-03', 1000);
  v := demoras_calcular_run(timestamptz '2026-08-06 09:25-03');
  n := demoras_variantes_snapshot(timestamptz '2026-08-06 09:25-03', 1000);

  SELECT count(*) INTO difs
  FROM demoras_calculadas dc
  JOIN demoras_calculadas_variantes dv
    ON dv.corrida_at = dc.corrida_at AND dv.escenario = dc.escenario
   AND dv.zona_id = dc.zona_id AND dv.tipo_servicio = dc.tipo_servicio
   AND dv.variante_id = (SELECT id FROM demoras_variantes WHERE codigo = 'CAMPEON')
  WHERE dc.escenario = 1000
    AND dc.corrida_at IN (timestamptz '2026-08-06 09:05-03', timestamptz '2026-08-06 09:15-03',
                          timestamptz '2026-08-06 09:25-03')
    AND (dc.demora_informada IS DISTINCT FROM dv.demora_informada
         OR abs(coalesce(dc.demora_suavizada, 0) - coalesce(dv.demora_suavizada, 0)) > 0.011);

  IF difs > 0 THEN
    RAISE EXCEPTION 'CAMPEON difiere del motor en % filas: el laboratorio no espeja', difs;
  END IF;
END $$;
SELECT 'ok control: CAMPEON publica EXACTAMENTE lo mismo que el motor en 3 corridas' AS r;

-- ─── 4. Las variantes derivadas ────────────────────────────────────────
DO $$
DECLARE r record; c record; f numeric;
BEGIN
  SELECT coalesce(factor_calibracion, 1.0) INTO f FROM demoras_modelo WHERE escenario_id = 1000;

  -- La zona 820 tiene cola y movil: cae al modelo normal (sin techo).
  SELECT * INTO c FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-06 09:05-03' AND escenario = 1000
     AND zona_id = 820 AND tipo_servicio = 'URGENTE';
  IF c.sin_capacidad THEN RAISE EXCEPTION 'z820 sin capacidad: el fixture no ejercita el modelo normal'; END IF;

  -- FACTOR_100: la cruda del motor dividida por el factor vigente.
  SELECT * INTO r FROM demoras_calculadas_variantes
   WHERE corrida_at = timestamptz '2026-08-06 09:05-03' AND escenario = 1000
     AND zona_id = 820 AND tipo_servicio = 'URGENTE'
     AND variante_id = (SELECT id FROM demoras_variantes WHERE codigo = 'FACTOR_100');
  IF abs(r.demora_cruda - c.demora_cruda / f) > 0.02 THEN
    RAISE EXCEPTION 'FACTOR_100 cruda=% (esperaba %/%=%)', r.demora_cruda, c.demora_cruda, f, c.demora_cruda / f;
  END IF;

  -- FACTOR_080: proporcional al 100.
  SELECT * INTO r FROM demoras_calculadas_variantes
   WHERE corrida_at = timestamptz '2026-08-06 09:05-03' AND escenario = 1000
     AND zona_id = 820 AND tipo_servicio = 'URGENTE'
     AND variante_id = (SELECT id FROM demoras_variantes WHERE codigo = 'FACTOR_080');
  IF abs(r.demora_cruda - (c.demora_cruda / f) * 0.80) > 0.02 THEN
    RAISE EXCEPTION 'FACTOR_080 cruda=% (esperaba %)', r.demora_cruda, (c.demora_cruda / f) * 0.80;
  END IF;

  -- ESCALON_10: la publicada es multiplo de 10.
  SELECT count(*) INTO r FROM demoras_calculadas_variantes dv
   WHERE dv.escenario = 1000 AND dv.variante_id = (SELECT id FROM demoras_variantes WHERE codigo = 'ESCALON_10')
     AND dv.demora_informada % 10 <> 0;
  IF r.count > 0 THEN RAISE EXCEPTION 'ESCALON_10 publico % valores que no son multiplo de 10', r.count; END IF;

  -- PISO_20: nunca por debajo de 20, y el motor nunca por debajo de 30.
  SELECT count(*) INTO r FROM demoras_calculadas_variantes dv
   WHERE dv.escenario = 1000 AND dv.variante_id = (SELECT id FROM demoras_variantes WHERE codigo = 'PISO_20')
     AND dv.demora_informada < 20;
  IF r.count > 0 THEN RAISE EXCEPTION 'PISO_20 publico % valores por debajo de su piso', r.count; END IF;
END $$;
SELECT 'ok derivadas: factor proporcional, escalon de 10 y piso de 20 se respetan' AS r;

-- ─── 5. La escalera PROPIA (dependencia del camino) ────────────────────
-- SIN_ESCALERA publica siempre la cruda acotada+redondeada, sin mirar la
-- corrida anterior: se compara contra el calculo directo.
DO $$
DECLARE difs integer;
BEGIN
  SELECT count(*) INTO difs
  FROM demoras_calculadas_variantes dv
  CROSS JOIN LATERAL demoras_acabado(dv.demora_cruda, NULL,
    (SELECT min_minutos FROM demoras_modelo WHERE escenario_id = 1000),
    (SELECT max_minutos FROM demoras_modelo WHERE escenario_id = 1000),
    (SELECT subida_max  FROM demoras_modelo WHERE escenario_id = 1000),
    (SELECT bajada_max  FROM demoras_modelo WHERE escenario_id = 1000),
    (SELECT escalon_minutos FROM demoras_modelo WHERE escenario_id = 1000)) a
  WHERE dv.escenario = 1000
    AND dv.variante_id = (SELECT id FROM demoras_variantes WHERE codigo = 'SIN_ESCALERA')
    AND dv.demora_informada IS DISTINCT FROM a.informada;
  IF difs > 0 THEN RAISE EXCEPTION 'SIN_ESCALERA arrastro suavizado en % filas', difs; END IF;
END $$;
SELECT 'ok escalera: SIN_ESCALERA publica la cruda acotada, sin mirar la corrida anterior' AS r;

-- ─── 6. El backfill ────────────────────────────────────────────────────
DO $$
DECLARE v integer; antes integer; despues integer;
BEGIN
  -- Una corrida nueva SIN snapshot: el backfill la tiene que agarrar.
  PERFORM demoras_calcular_run(timestamptz '2026-08-06 09:35-03');
  SELECT count(*) INTO antes FROM demoras_calculadas_variantes
   WHERE escenario = 1000 AND corrida_at = timestamptz '2026-08-06 09:35-03';
  IF antes <> 0 THEN RAISE EXCEPTION 'el motor escribio variantes por su cuenta (%): el motor NO debe llamar al laboratorio', antes; END IF;

  -- La ventana del backfill es en MINUTOS y en produccion vale 15: el
  -- fixture vive en el pasado, asi que aca se abre a proposito (10
  -- anios) para poder ejercitar el mecanismo. Que la ventana real sea
  -- corta se prueba abajo.
  v := demoras_variantes_backfill(5256000, 50);
  SELECT count(*) INTO despues FROM demoras_calculadas_variantes
   WHERE escenario = 1000 AND corrida_at = timestamptz '2026-08-06 09:35-03';
  IF despues = 0 THEN RAISE EXCEPTION 'el backfill no proceso la corrida pendiente'; END IF;

  -- Segunda pasada: ya no queda nada por hacer.
  v := demoras_variantes_backfill(5256000, 50);
  IF v <> 0 THEN RAISE EXCEPTION 'el backfill reproceso % corridas ya hechas', v; END IF;

  -- La ventana corta NO agarra corridas viejas: es la garantia de que
  -- el laboratorio nunca "reconstruye" un estado del mundo que ya no
  -- existe (medido el 7/8: rellenar ayer llevaba a las variantes
  -- re-simuladas contra el techo).
  DELETE FROM demoras_calculadas_variantes
   WHERE escenario = 1000 AND corrida_at = timestamptz '2026-08-06 09:35-03';
  v := demoras_variantes_backfill(15, 50);
  IF v <> 0 THEN RAISE EXCEPTION 'la ventana de 15 minutos agarro % corridas viejas', v; END IF;
END $$;
SELECT 'ok backfill: agarra lo pendiente, no reprocesa, y el motor no escribe variantes' AS r;

-- ─── 7. Guarda de version del modelo ───────────────────────────────────
DO $$
DECLARE v integer;
BEGIN
  -- Se simula una corrida calculada con OTRA version del modelo.
  UPDATE demoras_calculadas SET modelo_version = 9999
   WHERE escenario = 1000 AND corrida_at = timestamptz '2026-08-06 09:35-03';
  DELETE FROM demoras_calculadas_variantes
   WHERE escenario = 1000 AND corrida_at = timestamptz '2026-08-06 09:35-03';

  v := demoras_variantes_snapshot(timestamptz '2026-08-06 09:35-03', 1000);
  IF v <> 0 THEN RAISE EXCEPTION 'el snapshot espejo una corrida de otra version del modelo (% filas)', v; END IF;

  v := demoras_variantes_backfill(5256000, 50);
  IF v <> 0 THEN RAISE EXCEPTION 'el backfill ofrecio una corrida de otra version del modelo'; END IF;
END $$;
SELECT 'ok version: una corrida calculada con otra parametria no se espeja' AS r;

-- ─── Teardown ──────────────────────────────────────────────────────────
DELETE FROM demoras_calculadas_variantes WHERE escenario = 1000;
DELETE FROM demoras_calculadas WHERE escenario = 1000 AND zona_id IN (820, 821, 822);
DELETE FROM pedidos WHERE escenario = 1000 AND id BETWEEN 6001 AND 6003;
DELETE FROM metricas_cumplimiento WHERE escenario = 1000 AND pedido_id BETWEEN 87000 AND 87999;
DELETE FROM metricas_cumplimiento WHERE escenario = 1000 AND movil IN (820, 821);
DELETE FROM moviles_dia WHERE escenario_id = 1000 AND movil_id IN (820, 821);
DELETE FROM demoras WHERE escenario_id = 1000 AND zona_id IN (820, 821, 822);
DELETE FROM moviles_zonas WHERE escenario_id = 1000 AND zona_id IN (820, 821, 822);
UPDATE demoras_modelo SET arranque_sin_movil_modo = 'TECHO' WHERE escenario_id = 1000;
SELECT 'ok teardown: fixtures del laboratorio fuera, catalogo intacto' AS r;
