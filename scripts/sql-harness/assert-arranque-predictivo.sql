-- Asserts de 2026-08-05-arranque-predictivo.sql (arranque PREDICTIVO).
-- AUTOSUFICIENTE: setea el modo y sus fixtures aca, y el teardown deja
-- TODO como estaba (modo TECHO, bypass false, margen 0, fixtures fuera)
-- porque los asserts que corren despues cuentan filas y esperan techos.
--
-- Universo de prueba (escenario 1000, URGENTE, corridas del mie 2026-08-05
-- y el sab 2026-08-08; ventana sembrada 07:00-23:30, espera max default
-- sembrada 09:00 = apertura + 2h):
--   810: 5 dias habiles de historico (mediana 08:40), espera max
--        override 10:00, sin moviles -> fase PREDICTIVO y su timeline.
--   811: historico 11:00 (mas alla del max 10:00) -> el capeo.
--   812: SIN historico (origen HORARIO) y DOS moviles de TRANSITO
--        activos -> transito invisible hasta el max, y fase TRANSITO
--        despues (con bypass de la escalera al entrar).
--   813: 3 habiles + 2 sabados de historico (tipo insuficiente ->
--        origen GENERAL), sin espera max propia (default 09:00).

-- ─── Fixture ───────────────────────────────────────────────────────────
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_zona, tipo_de_servicio, prioridad_o_transito, activa) VALUES
  ('810', 810, 1000, 'P', 'URGENTE', 1, true),
  ('811', 811, 1000, 'P', 'URGENTE', 1, true),
  ('901', 812, 1000, 'T', 'URGENTE', 2, true),
  ('902', 812, 1000, 'T', 'URGENTE', 2, true),
  ('813', 813, 1000, 'P', 'URGENTE', 1, true);

INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa, zona_nombre) VALUES
  (1000, 810, 'Distribucion', 'URGENTE', 45, true, 'ZONA PREDICTIVA'),
  (1000, 811, 'Distribucion', 'URGENTE', 45, true, 'ZONA HIST TARDE'),
  (1000, 812, 'Distribucion', 'URGENTE', 45, true, 'ZONA TRANSITO'),
  (1000, 813, 'Distribucion', 'URGENTE', 45, true, 'ZONA GENERAL');

-- Los dos transitos de la 812, activos el miercoles.
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 901, DATE '2026-08-05', true),
  (1000, 902, DATE '2026-08-05', true);

-- Historico de activacion. 2026-07-28..31 y 08-03 son habiles;
-- 07-25 y 08-01 son sabados.
INSERT INTO demoras_activacion_hist (escenario_id, tipo_servicio, zona_id, fecha, dia_tipo, primer_prioridad_at) VALUES
  (1000, 'URGENTE', 810, DATE '2026-07-28', 'HABIL', timestamptz '2026-07-28 08:20-03'),
  (1000, 'URGENTE', 810, DATE '2026-07-29', 'HABIL', timestamptz '2026-07-29 08:30-03'),
  (1000, 'URGENTE', 810, DATE '2026-07-30', 'HABIL', timestamptz '2026-07-30 08:40-03'),
  (1000, 'URGENTE', 810, DATE '2026-07-31', 'HABIL', timestamptz '2026-07-31 08:50-03'),
  (1000, 'URGENTE', 810, DATE '2026-08-03', 'HABIL', timestamptz '2026-08-03 09:00-03'),
  (1000, 'URGENTE', 811, DATE '2026-07-28', 'HABIL', timestamptz '2026-07-28 11:00-03'),
  (1000, 'URGENTE', 811, DATE '2026-07-29', 'HABIL', timestamptz '2026-07-29 11:00-03'),
  (1000, 'URGENTE', 811, DATE '2026-07-30', 'HABIL', timestamptz '2026-07-30 11:00-03'),
  (1000, 'URGENTE', 811, DATE '2026-07-31', 'HABIL', timestamptz '2026-07-31 11:00-03'),
  (1000, 'URGENTE', 811, DATE '2026-08-03', 'HABIL', timestamptz '2026-08-03 11:00-03'),
  (1000, 'URGENTE', 813, DATE '2026-07-29', 'HABIL', timestamptz '2026-07-29 08:00-03'),
  (1000, 'URGENTE', 813, DATE '2026-07-30', 'HABIL', timestamptz '2026-07-30 08:00-03'),
  (1000, 'URGENTE', 813, DATE '2026-07-31', 'HABIL', timestamptz '2026-07-31 08:00-03'),
  (1000, 'URGENTE', 813, DATE '2026-07-25', 'SABADO', timestamptz '2026-07-25 09:00-03'),
  (1000, 'URGENTE', 813, DATE '2026-08-01', 'SABADO', timestamptz '2026-08-01 09:00-03');

-- Overrides de espera maxima (dia habil): 810 y 811 esperan hasta las 10.
INSERT INTO demoras_espera_max (escenario_id, tipo_servicio, dia_tipo, zona_id, hora_max) VALUES
  (1000, 'URGENTE', 'HABIL', 810, '10:00'),
  (1000, 'URGENTE', 'HABIL', 811, '10:00');

UPDATE demoras_config SET motor_activo = true WHERE escenario_id = 1000;
UPDATE demoras_modelo
   SET arranque_sin_movil_modo = 'PREDICTIVO',
       suavizado_bypass_cambio_capacidad = true
 WHERE escenario_id = 1000;

-- ─── Seeds de la migracion ──────────────────────────────────────────────
DO $$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM demoras_ventanas
   WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE';
  IF v IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'ventanas URGENTE sembradas=% (esperaba 3: HABIL/SABADO/DOMINGO)', v; END IF;

  SELECT count(*) INTO v FROM demoras_ventanas
   WHERE escenario_id = 1000 AND tipo_servicio IN ('NOCTURNO','SERVICE');
  IF v IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'ventanas NOCTURNO/SERVICE=% (v1 es solo URGENTE; los otros gatean por demoras_config)', v; END IF;

  SELECT count(*) INTO v FROM demoras_espera_max
   WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE'
     AND zona_id IS NULL AND hora_max = time '09:00';
  IF v IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'defaults de espera max=% con 09:00 (esperaba 3 = apertura 07:00 + 2h)', v; END IF;
END $$;
SELECT 'ok seeds: 3 ventanas URGENTE espejo de config, 3 defaults de espera max = apertura+2h' AS r;

-- demoras_dia_tipo.
DO $$
BEGIN
  IF demoras_dia_tipo(DATE '2026-08-05') IS DISTINCT FROM 'HABIL'   THEN RAISE EXCEPTION 'mie 5/8 no dio HABIL';   END IF;
  IF demoras_dia_tipo(DATE '2026-08-08') IS DISTINCT FROM 'SABADO'  THEN RAISE EXCEPTION 'sab 8/8 no dio SABADO';  END IF;
  IF demoras_dia_tipo(DATE '2026-08-09') IS DISTINCT FROM 'DOMINGO' THEN RAISE EXCEPTION 'dom 9/8 no dio DOMINGO'; END IF;
END $$;
SELECT 'ok demoras_dia_tipo: HABIL / SABADO / DOMINGO' AS r;

-- ─── Timeline del miercoles 2026-08-05 ─────────────────────────────────
-- 07:10 -- la zona sin historico promete desde la apertura, con los DOS
-- transitos activos INVISIBLES (la fase manda sobre el modelo).
DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 07:10-03');

  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 07:10-03' AND escenario = 1000
     AND zona_id = 812 AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'zona 812 sin fila a las 07:10'; END IF;
  IF r.arranque_fase     IS DISTINCT FROM 'PREDICTIVO' THEN RAISE EXCEPTION 'z812 fase=% (transito activo pero SIN prioridad: fase PREDICTIVO)', r.arranque_fase; END IF;
  IF r.activacion_origen IS DISTINCT FROM 'HORARIO'    THEN RAISE EXCEPTION 'z812 origen=% (sin historico -> apertura de la ventana)', r.activacion_origen; END IF;
  IF r.moviles_transito  IS DISTINCT FROM 2            THEN RAISE EXCEPTION 'z812 transitos=% (fixture roto)', r.moviles_transito; END IF;
  IF r.demora_cruda      IS DISTINCT FROM 30           THEN RAISE EXCEPTION 'z812 cruda=% (espera 0 desde apertura + 1x30; el transito NO se cuenta)', r.demora_cruda; END IF;
  IF r.demora_informada  IS DISTINCT FROM 30           THEN RAISE EXCEPTION 'z812 informada=%', r.demora_informada; END IF;
END $$;
SELECT 'ok 07:10: sin historico arranca de la apertura (30) y el transito es invisible' AS r;

-- 08:00 -- la foto grande: espera del historico, capeo a la espera
-- maxima, y cadena de respaldo GENERAL.
DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 08:00-03');

  -- Zona 810: mediana habil 08:40 -> espera 40 + 1x30 = 70. La publicada
  -- baja de a 15 desde el 120 de las 07:10 (bajada_max).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 08:00-03' AND escenario = 1000
     AND zona_id = 810 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase          IS DISTINCT FROM 'PREDICTIVO' THEN RAISE EXCEPTION 'z810 fase=%', r.arranque_fase; END IF;
  IF r.activacion_origen      IS DISTINCT FROM 'DIA_TIPO'   THEN RAISE EXCEPTION 'z810 origen=% (5 habiles >= min_muestras)', r.activacion_origen; END IF;
  IF r.activacion_estimada_at IS DISTINCT FROM timestamptz '2026-08-05 08:40-03' THEN RAISE EXCEPTION 'z810 estimada=% (mediana de 08:20..09:00)', r.activacion_estimada_at; END IF;
  IF r.espera_max_at          IS DISTINCT FROM timestamptz '2026-08-05 10:00-03' THEN RAISE EXCEPTION 'z810 espera_max=% (override de zona)', r.espera_max_at; END IF;
  IF r.espera_minutos         IS DISTINCT FROM 40.0         THEN RAISE EXCEPTION 'z810 espera=%', r.espera_minutos; END IF;
  IF r.demora_cruda           IS DISTINCT FROM 70           THEN RAISE EXCEPTION 'z810 cruda=% (40 espera + 1x30)', r.demora_cruda; END IF;
  IF r.demora_informada       IS DISTINCT FROM 105          THEN RAISE EXCEPTION 'z810 informada=% (escalera: 120 de las 07:10 - bajada 15)', r.demora_informada; END IF;

  -- Zona 811: el historico dice 11:00 pero el max es 10:00 -> se espera
  -- HASTA el max (espera 120 -> techo), nunca "hasta las 11". La
  -- estimada se guarda SIN capear (auditoria).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 08:00-03' AND escenario = 1000
     AND zona_id = 811 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase          IS DISTINCT FROM 'PREDICTIVO' THEN RAISE EXCEPTION 'z811 fase=%', r.arranque_fase; END IF;
  IF r.activacion_estimada_at IS DISTINCT FROM timestamptz '2026-08-05 11:00-03' THEN RAISE EXCEPTION 'z811 estimada=% (sin capear)', r.activacion_estimada_at; END IF;
  IF r.espera_minutos         IS DISTINCT FROM 120.0        THEN RAISE EXCEPTION 'z811 espera=% (capeada al max 10:00)', r.espera_minutos; END IF;
  IF r.demora_informada       IS DISTINCT FROM 120          THEN RAISE EXCEPTION 'z811 informada=% (espera 120 + 30 -> clamp 120)', r.demora_informada; END IF;

  -- Zona 813: 3 habiles no alcanzan (min 4) pero 5 dias en general si ->
  -- origen GENERAL, mediana 08:00 -> espera 0 -> 30.
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 08:00-03' AND escenario = 1000
     AND zona_id = 813 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase     IS DISTINCT FROM 'PREDICTIVO' THEN RAISE EXCEPTION 'z813 fase=%', r.arranque_fase; END IF;
  IF r.activacion_origen IS DISTINCT FROM 'GENERAL'    THEN RAISE EXCEPTION 'z813 origen=% (tipo insuficiente -> general)', r.activacion_origen; END IF;
  IF r.demora_cruda      IS DISTINCT FROM 30           THEN RAISE EXCEPTION 'z813 cruda=% (mediana general 08:00 ya paso -> espera 0)', r.demora_cruda; END IF;
END $$;
SELECT 'ok 08:00: espera del historico (DIA_TIPO), capeo al max (nunca "hasta las 11") y respaldo GENERAL' AS r;

-- 08:10 -- entra un pedido a la 810: la cola suma por delante.
INSERT INTO pedidos
  (id, escenario, servicio_nombre, zona_nro, empresa_fletera_id, movil, fletero,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   estado_nro, sub_estado_nro, orden_cancelacion, demora_informada, fch_para)
VALUES
  (910, 1000, 'URGENTE', 810, 7, NULL, NULL,
   NULL, NULL, '2026-08-05 08:05-03', '2026-08-05 08:50-03',
   1, 0, 'N', 45, DATE '2026-08-05');

DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 08:10-03');

  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 08:10-03' AND escenario = 1000
     AND zona_id = 810 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase    IS DISTINCT FROM 'PREDICTIVO' THEN RAISE EXCEPTION 'z810 fase=%', r.arranque_fase; END IF;
  IF r.espera_minutos   IS DISTINCT FROM 30.0         THEN RAISE EXCEPTION 'z810 espera=%', r.espera_minutos; END IF;
  IF r.cola_por_delante IS DISTINCT FROM 1            THEN RAISE EXCEPTION 'z810 cola=%', r.cola_por_delante; END IF;
  IF r.demora_cruda     IS DISTINCT FROM 90           THEN RAISE EXCEPTION 'z810 cruda=% (30 espera + (1 cola + 1) x 30)', r.demora_cruda; END IF;
  IF r.demora_informada IS DISTINCT FROM 90           THEN RAISE EXCEPTION 'z810 informada=%', r.demora_informada; END IF;
END $$;
SELECT 'ok 08:10: con un pedido esperando, espera 30 + 2x30 = 90' AS r;

-- 08:50 -- corrida intermedia (sin asserts propios: alimenta las
-- escaleras para las corridas siguientes; la 812 llega a 120 aca).
DO $$
DECLARE v bigint;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 08:50-03');
END $$;

-- 09:10 -- gracia vencida en la 810 (est 08:40 + 20 < 09:10) y espera
-- maxima vencida en 812/813 (default 09:00): la 812 pasa a TRANSITO con
-- bypass de la escalera, la 813 (sin nada) va al techo de siempre.
DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 09:10-03');

  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:10-03' AND escenario = 1000
     AND zona_id = 810 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase  IS DISTINCT FROM 'GRACIA_VENCIDA' THEN RAISE EXCEPTION 'z810 fase=% (paso 09:00 y el movil no aparecio)', r.arranque_fase; END IF;
  IF r.espera_minutos IS NOT NULL                       THEN RAISE EXCEPTION 'z810 espera=% (solo se guarda en fase PREDICTIVO)', r.espera_minutos; END IF;
  IF r.demora_cruda   IS DISTINCT FROM 120              THEN RAISE EXCEPTION 'z810 cruda=% (gracia vencida -> techo, sin transito que mirar)', r.demora_cruda; END IF;
  IF r.demora_informada IS DISTINCT FROM 105            THEN RAISE EXCEPTION 'z810 informada=% (escalera subiendo: 75 previo + subida_max 30)', r.demora_informada; END IF;

  -- 812: vencio la espera maxima (09:00) -> los DOS transitos entran con
  -- su dedicacion 0.2: cruda = 1 / (2 x 0.2/30) = 75. La informada es 75
  -- DIRECTO (venia de 120): entrar en fase TRANSITO bypassea la escalera
  -- ("a la corrida siguiente del max, una mejor demora") -- sin bypass
  -- habria publicado 105.
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:10-03' AND escenario = 1000
     AND zona_id = 812 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase    IS DISTINCT FROM 'TRANSITO' THEN RAISE EXCEPTION 'z812 fase=%', r.arranque_fase; END IF;
  IF r.demora_cruda     IS DISTINCT FROM 75         THEN RAISE EXCEPTION 'z812 cruda=% (los transitos ya cuentan: 1/(2x0.2/30))', r.demora_cruda; END IF;
  IF r.demora_informada IS DISTINCT FROM 75         THEN RAISE EXCEPTION 'z812 informada=% (bypass al entrar en TRANSITO; sin el, 105)', r.demora_informada; END IF;

  -- 813: paso el max, NO hay transito NI moviles -> fase NULL y cae al
  -- respaldo Despacho + cola (45 + 0), no al techo: con la zona muerta,
  -- el valor del Despacho es el mejor dato disponible (medido 3/8).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:10-03' AND escenario = 1000
     AND zona_id = 813 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase IS NOT NULL           THEN RAISE EXCEPTION 'z813 fase=% (pasado el max sin nada, el arranque ya no aplica)', r.arranque_fase; END IF;
  IF r.sin_capacidad IS DISTINCT FROM true THEN RAISE EXCEPTION 'z813 sin_capacidad=%', r.sin_capacidad; END IF;
  IF r.demora_cruda  IS DISTINCT FROM 45   THEN RAISE EXCEPTION 'z813 cruda=% (respaldo Despacho 45 + cola 0, no techo)', r.demora_cruda; END IF;
  -- Escalera: suavizada previa 80 - bajada 15 = 65, y el escalon redondea
  -- la promesa HACIA ARRIBA -> 75.
  IF r.demora_informada IS DISTINCT FROM 75 THEN RAISE EXCEPTION 'z813 informada=% (suavizada 65 -> escalon arriba 75)', r.demora_informada; END IF;
END $$;
SELECT 'ok 09:10: gracia vencida sube al techo; vencido el max, TRANSITO con bypass (75, no 105) o respaldo Despacho sin nada' AS r;

-- 09:40 -- aparece el PRIORIDAD en la 810: motor normal al toque.
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_zona, tipo_de_servicio, prioridad_o_transito, activa)
VALUES ('903', 810, 1000, 'P', 'URGENTE', 1, true);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 903, DATE '2026-08-05', true);

DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 09:40-03');

  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:40-03' AND escenario = 1000
     AND zona_id = 810 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase     IS NOT NULL          THEN RAISE EXCEPTION 'z810 fase=% (con prioridad activo el arranque no aplica)', r.arranque_fase; END IF;
  IF r.moviles_prioridad IS DISTINCT FROM 1   THEN RAISE EXCEPTION 'z810 prioridad=%', r.moviles_prioridad; END IF;
  IF r.demora_cruda      IS DISTINCT FROM 60  THEN RAISE EXCEPTION 'z810 cruda=% (motor normal: (1 cola + 1) / (1/30))', r.demora_cruda; END IF;
  IF r.demora_informada  IS DISTINCT FROM 60  THEN RAISE EXCEPTION 'z810 informada=% (bypass por cambio de capacidad)', r.demora_informada; END IF;
END $$;
SELECT 'ok 09:40: el prioridad se activa y el motor normal toma el mando (60 directo)' AS r;

-- ─── Sabado 2026-08-08: dia_tipo, respaldo GENERAL y margen ────────────
DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-08 08:30-03');

  -- 810 un sabado: sin muestras SABADO -> GENERAL (los 5 habiles, mediana
  -- 08:40); espera max = default sabado 09:00 (el override era HABIL).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-08 08:30-03' AND escenario = 1000
     AND zona_id = 810 AND tipo_servicio = 'URGENTE';
  IF r.arranque_fase     IS DISTINCT FROM 'PREDICTIVO' THEN RAISE EXCEPTION 'z810 sab fase=%', r.arranque_fase; END IF;
  IF r.activacion_origen IS DISTINCT FROM 'GENERAL'    THEN RAISE EXCEPTION 'z810 sab origen=% (sin sabados en el historico)', r.activacion_origen; END IF;
  IF r.espera_max_at     IS DISTINCT FROM timestamptz '2026-08-08 09:00-03' THEN RAISE EXCEPTION 'z810 sab espera_max=% (default SABADO, no el override HABIL)', r.espera_max_at; END IF;
  IF r.demora_cruda      IS DISTINCT FROM 40           THEN RAISE EXCEPTION 'z810 sab cruda=% (espera 10 + 30)', r.demora_cruda; END IF;
  IF r.demora_informada  IS DISTINCT FROM 45           THEN RAISE EXCEPTION 'z810 sab informada=%', r.demora_informada; END IF;
END $$;
SELECT 'ok sabado: estimador GENERAL + espera maxima del dia SABADO (el override HABIL no gatea)' AS r;

-- Margen: con 30 minutos de colchon la estimada pasa a 09:10 pero la
-- espera se capea al max (09:00).
DO $$
DECLARE v bigint; r record;
BEGIN
  UPDATE demoras_modelo SET activacion_margen_minutos = 30 WHERE escenario_id = 1000;

  v := demoras_calcular_run(timestamptz '2026-08-08 08:40-03');

  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-08 08:40-03' AND escenario = 1000
     AND zona_id = 810 AND tipo_servicio = 'URGENTE';
  IF r.activacion_estimada_at IS DISTINCT FROM timestamptz '2026-08-08 09:10-03' THEN RAISE EXCEPTION 'z810 margen estimada=% (08:40 + 30 margen, sin capear)', r.activacion_estimada_at; END IF;
  IF r.espera_minutos         IS DISTINCT FROM 20.0 THEN RAISE EXCEPTION 'z810 margen espera=% (capeada al max 09:00)', r.espera_minutos; END IF;
  IF r.demora_cruda           IS DISTINCT FROM 50   THEN RAISE EXCEPTION 'z810 margen cruda=%', r.demora_cruda; END IF;

  UPDATE demoras_modelo SET activacion_margen_minutos = 0 WHERE escenario_id = 1000;
END $$;
SELECT 'ok margen: se suma a la estimada y la espera se capea a la maxima' AS r;

-- Ventana del cron POR TIPO DE DIA: acortar el sabado a 12:00 apaga la
-- corrida de las 13:00 aunque demoras_config siga diciendo 23:30.
DO $$
DECLARE v bigint; n integer;
BEGIN
  UPDATE demoras_ventanas SET hora_fin = '12:00'
   WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE' AND dia_tipo = 'SABADO';

  v := demoras_calcular_run(timestamptz '2026-08-08 13:00-03');

  SELECT count(*) INTO n FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-08 13:00-03' AND escenario = 1000
     AND tipo_servicio = 'URGENTE' AND zona_id IN (810, 811, 812, 813);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'la corrida de las 13:00 escribio % filas URGENTE con la ventana del sabado cerrada a las 12:00', n;
  END IF;

  UPDATE demoras_ventanas SET hora_fin = '23:30'
   WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE' AND dia_tipo = 'SABADO';
END $$;
SELECT 'ok ventana por tipo de dia: el sabado corto apaga el motor a las 13:00 (config decia 23:30)' AS r;

-- ─── Snapshot nocturno ─────────────────────────────────────────────────
DO $$
DECLARE v integer; r record;
BEGIN
  v := demoras_activacion_snapshot(DATE '2026-08-05');

  -- 810: el primer moviles_prioridad > 0 del dia fue la corrida de 09:40.
  SELECT * INTO r FROM demoras_activacion_hist
   WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE'
     AND zona_id = 810 AND fecha = DATE '2026-08-05';
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot: sin fila para la 810'; END IF;
  IF r.primer_prioridad_at IS DISTINCT FROM timestamptz '2026-08-05 09:40-03' THEN RAISE EXCEPTION 'snapshot 810 primer=% (esperaba la corrida de 09:40)', r.primer_prioridad_at; END IF;
  IF r.dia_tipo IS DISTINCT FROM 'HABIL' THEN RAISE EXCEPTION 'snapshot 810 dia_tipo=%', r.dia_tipo; END IF;

  -- 812: todo el dia con transito pero sin prioridad -> fila con NULL
  -- (cuenta como dia SIN muestra, no desaparece).
  SELECT * INTO r FROM demoras_activacion_hist
   WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE'
     AND zona_id = 812 AND fecha = DATE '2026-08-05';
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot: sin fila para la 812'; END IF;
  IF r.primer_prioridad_at IS NOT NULL THEN RAISE EXCEPTION 'snapshot 812 primer=% (nunca hubo prioridad)', r.primer_prioridad_at; END IF;
END $$;
SELECT 'ok snapshot: primer prioridad del dia (09:40) y dia sin prioridad como NULL' AS r;

-- ─── CHECKs de las perillas nuevas ─────────────────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET activacion_percentil = 1.5 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'percentil 1.5 fue ACEPTADO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE demoras_modelo SET activacion_gracia_minutos = 200 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'gracia 200 fue ACEPTADA';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT 'ok CHECKs de activacion_percentil y activacion_gracia_minutos' AS r;

-- ─── Teardown: dejar el mundo como estaba ──────────────────────────────
UPDATE demoras_modelo
   SET arranque_sin_movil_modo = 'TECHO',
       suavizado_bypass_cambio_capacidad = false,
       activacion_margen_minutos = 0
 WHERE escenario_id = 1000;
DELETE FROM demoras_calculadas WHERE zona_id IN (810, 811, 812, 813);
DELETE FROM demoras_activacion_hist WHERE zona_id IN (810, 811, 812, 813);
DELETE FROM demoras_espera_max WHERE zona_id IN (810, 811, 812, 813);
DELETE FROM pedidos WHERE id = 910 AND escenario = 1000;
DELETE FROM moviles_dia WHERE escenario_id = 1000 AND movil_id IN (901, 902, 903);
DELETE FROM moviles_zonas WHERE escenario_id = 1000 AND zona_id IN (810, 811, 812, 813);
DELETE FROM demoras WHERE escenario_id = 1000 AND zona_id IN (810, 811, 812, 813);
SELECT 'ok teardown arranque-predictivo (universo restaurado)' AS r;
