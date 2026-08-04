-- Asserts de 2026-08-04-arranque-despacho.sql (perilla de arranque).
-- AUTOSUFICIENTE: asserts anteriores re-siembran demoras_modelo (la
-- activación de la migración no sobrevive), así que el modo se setea acá.
-- Usa zonas 800/801/802 y corridas del 2026-08-05 para no chocar, y al
-- final LIMPIA sus fixtures y vuelve el modo a TECHO — los asserts que
-- corren después (run-v3, tramos...) cuentan filas por corrida y un
-- universo agrandado les rompería los números.

-- ─── Fixture ───────────────────────────────────────────────────────────
-- Tres zonas en el universo (moviles_zonas + demoras URGENTE activa),
-- NINGUN movil activo en moviles_dia, sin pedidos (salvo zona 801):
--   800: URGENTE con valor del Despacho 45 y sin pedidos -> caso feliz.
--   801: URGENTE con valor del Despacho 40 pero CON un pedido esperando.
--   802: SERVICE (el Despacho no informa SERVICE) -> sin valor.
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_zona, tipo_de_servicio, prioridad_o_transito, activa) VALUES
  ('M800', 800, 1000, 'P', 'URGENTE', 1, true),
  ('M801', 801, 1000, 'P', 'URGENTE', 1, true),
  ('M802', 802, 1000, 'P', 'SERVICE', 1, true);

INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa, zona_nombre) VALUES
  (1000, 800, 'Distribucion', 'URGENTE', 45, true, 'ZONA ARRANQUE'),
  (1000, 801, 'Distribucion', 'URGENTE', 40, true, 'ZONA CON COLA'),
  (1000, 802, 'Distribucion', 'URGENTE', 50, true, 'ZONA SERVICE');

INSERT INTO pedidos
  (id, escenario, servicio_nombre, zona_nro, empresa_fletera_id, movil, fletero,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   estado_nro, sub_estado_nro, orden_cancelacion, demora_informada, fch_para)
VALUES
  (900, 1000, 'URGENTE', 801, 7, NULL, NULL,
   NULL, NULL, '2026-08-05 08:55-03', '2026-08-05 09:35-03',
   1, 0, 'N', 40, DATE '2026-08-05');

UPDATE demoras_config SET motor_activo = true WHERE escenario_id = 1000;
UPDATE demoras_modelo SET arranque_sin_movil_modo = 'DESPACHO' WHERE escenario_id = 1000;

-- ─── Modo DESPACHO ──────────────────────────────────────────────────────
DO $$
DECLARE v bigint; r record;
BEGIN
  v := demoras_calcular_run(timestamptz '2026-08-05 09:00-03');

  -- Zona 800: sin moviles, sin pedidos, Despacho 45 -> informa 45 (no 120).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:00-03' AND escenario = 1000
     AND zona_id = 800 AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'zona 800 sin fila'; END IF;
  IF r.demora_cruda     IS DISTINCT FROM 45   THEN RAISE EXCEPTION 'z800 cruda=% (debia ser el valor del Despacho)', r.demora_cruda; END IF;
  IF r.demora_informada IS DISTINCT FROM 45   THEN RAISE EXCEPTION 'z800 informada=%', r.demora_informada; END IF;
  IF r.sin_capacidad    IS DISTINCT FROM true THEN RAISE EXCEPTION 'z800 sin_capacidad=% (el estado del mundo no cambia)', r.sin_capacidad; END IF;
  IF r.demora_as400     IS DISTINCT FROM 45   THEN RAISE EXCEPTION 'z800 as400=%', r.demora_as400; END IF;

  -- Zona 801: sin moviles PERO con un pedido esperando -> techo, como siempre.
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:00-03' AND escenario = 1000
     AND zona_id = 801 AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'zona 801 sin fila'; END IF;
  IF r.demora_informada IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'z801 informada=% (con cola el techo sigue mandando)', r.demora_informada;
  END IF;

  -- Zona 802 SERVICE: el Despacho no informa SERVICE -> techo (fallback).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:00-03' AND escenario = 1000
     AND zona_id = 802 AND tipo_servicio = 'SERVICE';
  IF NOT FOUND THEN RAISE EXCEPTION 'zona 802 sin fila'; END IF;
  IF r.demora_informada IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'z802 informada=% (sin valor del Despacho, techo)', r.demora_informada;
  END IF;
END $$;
SELECT 'ok modo DESPACHO: zona vacia informa 45 del Despacho; con cola o sin valor, techo' AS r;

-- ─── Modo TECHO (default historico): mismas condiciones -> 120 ──────────
DO $$
DECLARE v bigint; r record;
BEGIN
  UPDATE demoras_modelo SET arranque_sin_movil_modo = 'TECHO' WHERE escenario_id = 1000;

  v := demoras_calcular_run(timestamptz '2026-08-05 09:10-03');

  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:10-03' AND escenario = 1000
     AND zona_id = 800 AND tipo_servicio = 'URGENTE';
  IF r.demora_cruda IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'z800 en modo TECHO dio cruda=% (la perilla no gatea)', r.demora_cruda;
  END IF;
END $$;
SELECT 'ok modo TECHO: la misma zona vacia vuelve al 120 historico (la perilla gatea)' AS r;

-- El CHECK rechaza valores invalidos.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET arranque_sin_movil_modo = 'CUALQUIERA' WHERE escenario_id = 1000;
    RAISE EXCEPTION 'el CHECK no rechazo un modo invalido';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;
SELECT 'ok CHECK de arranque_sin_movil_modo' AS r;

-- ─── Modo DESPACHO_MAS_COLA: con cola informa Despacho + cola x ritmo ───
DO $$
DECLARE v bigint; r record;
BEGIN
  UPDATE demoras_modelo SET arranque_sin_movil_modo = 'DESPACHO_MAS_COLA' WHERE escenario_id = 1000;

  v := demoras_calcular_run(timestamptz '2026-08-05 09:20-03');

  -- Zona 801: sin moviles, 1 pedido, Despacho 40, ritmo default 30
  -- -> cruda 40 + 1x30 = 70. La PUBLICADA es 105, no 75: las corridas
  -- anteriores del assert publicaron 120 (techo) y la escalera baja de a
  -- 15 (el bypass no aplica: mov_act siguio en 0). En la corrida
  -- siguiente seria 90, despues 75.
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:20-03' AND escenario = 1000
     AND zona_id = 801 AND tipo_servicio = 'URGENTE';
  IF r.demora_cruda     IS DISTINCT FROM 70  THEN RAISE EXCEPTION 'z801 MAS_COLA cruda=% (esperaba 70 = 40 + 1x30)', r.demora_cruda; END IF;
  IF r.demora_informada IS DISTINCT FROM 105 THEN RAISE EXCEPTION 'z801 MAS_COLA informada=% (esperaba 105: escalera desde el 120 previo)', r.demora_informada; END IF;

  -- Zona 800 (vacia): identico a DESPACHO -> cruda 45. La publicada es 60:
  -- el test TECHO de 09:10 la dejo en 75 (subida capada desde 45) y la
  -- escalera baja de a 15 (bypass no aplica: mov_act siguio en 0).
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:20-03' AND escenario = 1000
     AND zona_id = 800 AND tipo_servicio = 'URGENTE';
  IF r.demora_cruda     IS DISTINCT FROM 45 THEN RAISE EXCEPTION 'z800 MAS_COLA cruda=% (vacia = Despacho)', r.demora_cruda; END IF;
  IF r.demora_informada IS DISTINCT FROM 60 THEN RAISE EXCEPTION 'z800 MAS_COLA informada=% (esperaba 60: escalera desde el 75 del test TECHO)', r.demora_informada; END IF;

  -- Zona 802 SERVICE (sin valor del Despacho): techo, con o sin cola.
  SELECT * INTO r FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-08-05 09:20-03' AND escenario = 1000
     AND zona_id = 802 AND tipo_servicio = 'SERVICE';
  IF r.demora_informada IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'z802 MAS_COLA informada=%', r.demora_informada; END IF;
END $$;
SELECT 'ok DESPACHO_MAS_COLA: con cola 75 (40 + 1x30), vacia 45, sin Despacho techo' AS r;

-- ─── Teardown: dejar el mundo como estaba para los asserts siguientes ───
UPDATE demoras_modelo SET arranque_sin_movil_modo = 'TECHO' WHERE escenario_id = 1000;
DELETE FROM demoras_calculadas WHERE zona_id IN (800, 801, 802);
DELETE FROM pedidos WHERE id = 900 AND escenario = 1000;
DELETE FROM demoras WHERE zona_id IN (800, 801, 802) AND escenario_id = 1000;
DELETE FROM moviles_zonas WHERE zona_id IN (800, 801, 802) AND escenario_id = 1000;
SELECT 'ok teardown arranque-despacho (universo restaurado)' AS r;
