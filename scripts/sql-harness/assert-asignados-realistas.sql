-- Asserts de 2026-08-04-asignados-realistas.sql (asignados_modo).
-- AUTOSUFICIENTE (setea el modo, no confia en la activacion: asserts
-- previos re-siembran demoras_modelo) y con TEARDOWN (los asserts
-- posteriores esperan el comportamiento COMPLETO y el mundo sin estas
-- filas). Zona 700, fecha 2026-08-06 — sin colision con otros fixtures.

-- ─── Fixture ───────────────────────────────────────────────────────────
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 701, DATE '2026-08-06', true),
  (1000, 702, DATE '2026-08-06', true),
  (1000, 703, DATE '2026-08-06', true);

INSERT INTO pedidos
  (id, escenario, servicio_nombre, zona_nro, movil, fch_hora_asignado, fch_hora_para,
   estado_nro, sub_estado_nro, orden_cancelacion, fch_para)
VALUES
  -- asignado hace 15 min (con vara 30 -> le falta 0.5; con vara 60 -> 0.75)
  (701, 1000, 'URGENTE', 700, 701, '2026-08-06 09:45-03', '2026-08-06 09:40-03', 1, 0, 'N', DATE '2026-08-06'),
  -- asignado hace 90 min -> le falta 0 en cualquier vara razonable
  (702, 1000, 'URGENTE', 700, 702, '2026-08-06 08:30-03', '2026-08-06 08:25-03', 1, 0, 'N', DATE '2026-08-06'),
  -- asignado SIN fch_hora_asignado -> entra el PROXY updated_at (se fija abajo)
  (703, 1000, 'URGENTE', 700, 703, NULL,                  '2026-08-06 09:00-03', 1, 0, 'N', DATE '2026-08-06'),
  -- sin asignar -> cuenta 1 siempre
  (704, 1000, 'URGENTE', 700, NULL, NULL,                 '2026-08-06 09:50-03', 1, 0, 'N', DATE '2026-08-06'),
  -- atrapado (movil 999 sin moviles_dia activo) -> fuera con EXCLUIR
  (705, 1000, 'URGENTE', 700, 999, '2026-08-06 09:00-03', '2026-08-06 08:55-03', 1, 0, 'N', DATE '2026-08-06');

-- El proxy de P703: updated_at 09:30 = 30 min antes de la corrida.
UPDATE pedidos SET updated_at = '2026-08-06 09:30-03' WHERE id = 703 AND escenario = 1000;
-- Los demas con updated_at viejo para que NO les gane al campo real.
UPDATE pedidos SET updated_at = '2026-08-06 07:00-03' WHERE id IN (701, 702, 704, 705) AND escenario = 1000;

-- 1. PROGRESO con vara por DEFECTO (sin corrida previa -> ritmo_default 30):
--    cola = 1 sin_asignar + (0.5 real + 0 real + 0 proxy) = 1.5
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET asignados_modo = 'PROGRESO' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-08-06', timestamptz '2026-08-06 10:00-03')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'zona 700 sin fila de cola'; END IF;
  IF r.asignados   <> 4 THEN RAISE EXCEPTION 'asignados=% (conteo fisico no debe cambiar)', r.asignados; END IF;
  IF r.sin_asignar <> 1 THEN RAISE EXCEPTION 'sin_asignar=%', r.sin_asignar; END IF;
  IF r.atrapados   <> 1 THEN RAISE EXCEPTION 'atrapados=%', r.atrapados; END IF;
  IF r.cola_efectiva IS DISTINCT FROM 1.5 THEN
    RAISE EXCEPTION 'PROGRESO vara 30: cola=% (esperaba 1.5 = 1 + 0.5 + 0 + 0)', r.cola_efectiva;
  END IF;
END $$;
SELECT 'ok PROGRESO vara 30: cola 1.5 (15min->0.5, 90min->0, proxy 30min->0, SA->1, atrapado fuera)' AS r;

-- 2. La vara sale de la ULTIMA corrida (ritmo_usado 60 -> 15min falta 0.75).
DO $$
DECLARE r record;
BEGIN
  INSERT INTO demoras_calculadas
    (corrida_at, escenario, zona_id, tipo_servicio, demora_informada, demora_suavizada, demora_cruda, ritmo_usado)
  VALUES ('2026-08-06 09:50-03', 1000, 700, 'URGENTE', 45, 45, 45.0, 60);

  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-08-06', timestamptz '2026-08-06 10:00-03')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 2.25 THEN
    RAISE EXCEPTION 'PROGRESO vara 60: cola=% (esperaba 2.25 = 1 + 0.75 + 0 + 0.5 proxy)', r.cola_efectiva;
  END IF;
END $$;
SELECT 'ok PROGRESO vara de la ultima corrida: ritmo 60 -> cola 2.25 (el proxy tambien escala)' AS r;

-- 3. PESO fijo: cada asignado activo vale peso_asignados (0.25 -> 3x0.25).
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET asignados_modo = 'PESO', peso_asignados = 0.25 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-08-06', timestamptz '2026-08-06 10:00-03')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 1.75 THEN
    RAISE EXCEPTION 'PESO 0.25: cola=% (esperaba 1.75 = 1 + 3*0.25)', r.cola_efectiva;
  END IF;
END $$;
SELECT 'ok PESO 0.25: cola 1.75' AS r;

-- 4. COMPLETO reproduce el conteo historico exacto.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET asignados_modo = 'COMPLETO' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-08-06', timestamptz '2026-08-06 10:00-03')
   WHERE zona_id = 700 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'COMPLETO: cola=% (esperaba 4 = 1 + 3 asignados activos)', r.cola_efectiva;
  END IF;
END $$;
SELECT 'ok COMPLETO: cola 4 (identico al historico)' AS r;

-- 5. El CHECK rechaza modos invalidos.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET asignados_modo = 'MITAD' WHERE escenario_id = 1000;
    RAISE EXCEPTION 'el CHECK no rechazo un asignados_modo invalido';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;
SELECT 'ok CHECK de asignados_modo' AS r;

-- ─── Teardown ───────────────────────────────────────────────────────────
DELETE FROM demoras_calculadas WHERE zona_id = 700;
DELETE FROM pedidos WHERE id BETWEEN 701 AND 705 AND escenario = 1000;
DELETE FROM moviles_dia WHERE escenario_id = 1000 AND movil_id IN (701, 702, 703) AND fecha = DATE '2026-08-06';
UPDATE demoras_modelo SET asignados_modo = 'COMPLETO', peso_asignados = 0.5 WHERE escenario_id = 1000;
SELECT 'ok teardown asignados-realistas' AS r;
