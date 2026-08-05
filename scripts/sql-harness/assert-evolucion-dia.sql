-- Asserts de 2026-08-05-evolucion-dia.sql (sala de control en vivo).
-- AUTOSUFICIENTE: corridas y pedidos propios (zona 610, 2026-06-25,
-- ids 450+) y teardown completo.
--
-- Fixture:
--   Corridas 08:00 y 08:10 en zona 610 URGENTE (fases PREDICTIVO y
--   GRACIA_VENCIDA, motor 45/60, Despacho 40/40).
--   Pedido 451: toma 08:02, entregado 08:05+40'=08:42... (ver abajo);
--   la promesa del motor sale de la corrida de las 08:00 (45), NO de la
--   de 08:10 (lookup <= toma).
INSERT INTO demoras_calculadas
  (corrida_at, escenario, zona_id, tipo_servicio, demora_informada,
   demora_suavizada, demora_cruda, demora_as400, sin_capacidad,
   arranque_fase)
VALUES
  ('2026-06-25 08:00-03', 1000, 610, 'URGENTE', 45, 45, 45, 40, true,  'PREDICTIVO'),
  ('2026-06-25 08:10-03', 1000, 610, 'URGENTE', 60, 60, 60, 40, true,  'GRACIA_VENCIDA');

INSERT INTO pedidos
  (id, escenario, servicio_nombre, zona_nro, empresa_fletera_id, movil, fletero,
   fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
   estado_nro, sub_estado_nro, orden_cancelacion, demora_informada, fch_para)
VALUES
  -- 451: toma 08:02, entrega 08:42 -> real 40'. Despacho prometio 30
  -- (d_desp +10, <=25 OK); motor vigente a la toma = corrida 08:00 = 45
  -- (d_mot -5, <=25 OK). Entregado ANTES de la corrida 08:10? No:
  -- 08:42 > 08:10 -> cuenta solo en el acumulado de corridas >= 08:42
  -- (aca: en ninguna de las dos filas; si en el resumen del dia).
  (451, 1000, 'URGENTE', 610, 7, 9, 'F1',
   '2026-06-25 08:03-03', '2026-06-25 08:42-03', '2026-06-25 08:02-03', '2026-06-25 08:32-03',
   2, 3, 'N', 30, DATE '2026-06-25'),
  -- 452: toma 08:01, entrega 08:09 -> real 8'. Despacho 45 (d -37, tarde
  -- NO: llego 37' ANTES -> fuera del <=25). Motor corrida 08:00 = 45
  -- (d -37 tambien). Entregado antes de la corrida de las 08:10 -> el
  -- acumulado de esa corrida ya lo cuenta.
  (452, 1000, 'URGENTE', 610, 7, 9, 'F1',
   '2026-06-25 08:02-03', '2026-06-25 08:09-03', '2026-06-25 08:01-03', '2026-06-25 08:46-03',
   2, 3, 'N', 45, DATE '2026-06-25'),
  -- 453: AGENDADO (asignado 2 horas antes del "para") -> excluido.
  (453, 1000, 'URGENTE', 610, 7, 9, 'F1',
   '2026-06-25 08:00-03', '2026-06-25 10:20-03', '2026-06-25 10:15-03', '2026-06-25 10:45-03',
   2, 3, 'N', 30, DATE '2026-06-25');

DO $$
DECLARE r jsonb; c jsonb;
BEGIN
  r := metricas_evolucion_dia(jsonb_build_object(
    'escenario', 1000, 'fecha', '2026-06-25'));

  IF jsonb_array_length(r->'corridas') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'corridas = % (esperaba 2)', jsonb_array_length(r->'corridas');
  END IF;

  -- Corrida 08:00: la foto del momento + acumulado vacio (nada entregado).
  c := r->'corridas'->0;
  IF (c->>'prom_motor')::numeric    IS DISTINCT FROM 45 THEN RAISE EXCEPTION '08:00 prom_motor = %', c->>'prom_motor'; END IF;
  IF (c->>'prom_despacho')::numeric IS DISTINCT FROM 40 THEN RAISE EXCEPTION '08:00 prom_despacho = %', c->>'prom_despacho'; END IF;
  IF (c->>'f_predictivo')::int      IS DISTINCT FROM 1  THEN RAISE EXCEPTION '08:00 f_predictivo = %', c->>'f_predictivo'; END IF;
  IF (c->>'entregados')::int        IS DISTINCT FROM 0  THEN RAISE EXCEPTION '08:00 entregados = %', c->>'entregados'; END IF;

  -- Corrida 08:10: fase GRACIA + el pedido 452 ya entregado (08:09):
  -- comun 1, Despacho |−37| > 25 -> 0%, motor |−37| > 25 -> 0%.
  c := r->'corridas'->1;
  IF (c->>'f_gracia')::int   IS DISTINCT FROM 1 THEN RAISE EXCEPTION '08:10 f_gracia = %', c->>'f_gracia'; END IF;
  IF (c->>'entregados')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION '08:10 entregados = %', c->>'entregados'; END IF;
  IF (c->>'comun')::int      IS DISTINCT FROM 1 THEN RAISE EXCEPTION '08:10 comun = %', c->>'comun'; END IF;
  IF (c->>'d_le25')::numeric IS DISTINCT FROM 0 THEN RAISE EXCEPTION '08:10 d_le25 = %', c->>'d_le25'; END IF;

  -- Resumen del dia: 451 y 452 (el agendado 453 afuera). Comun 2:
  -- Despacho: |+10| ok, |−37| no -> 0.5 ; motor: |−5| ok, |−37| no -> 0.5.
  IF (r->'resumen'->>'entregados')::int IS DISTINCT FROM 2   THEN RAISE EXCEPTION 'resumen entregados = %', r->'resumen'->>'entregados'; END IF;
  IF (r->'resumen'->>'comun')::int      IS DISTINCT FROM 2   THEN RAISE EXCEPTION 'resumen comun = %', r->'resumen'->>'comun'; END IF;
  IF (r->'resumen'->>'d_le25')::numeric IS DISTINCT FROM 0.5 THEN RAISE EXCEPTION 'resumen d_le25 = %', r->'resumen'->>'d_le25'; END IF;
  IF (r->'resumen'->>'m_le25')::numeric IS DISTINCT FROM 0.5 THEN RAISE EXCEPTION 'resumen m_le25 = % (la promesa del motor debe salir de la corrida de las 08:00, no de la de 08:10)', r->'resumen'->>'m_le25'; END IF;
END $$;
SELECT 'ok evolucion: corridas con fases + acumulado en vivo + lookup de la corrida vigente a la toma + agendado excluido' AS r;

-- Fail-closed de empresas y dia sin datos.
DO $$
DECLARE r jsonb;
BEGIN
  r := metricas_evolucion_dia(jsonb_build_object(
    'escenario', 1000, 'fecha', '2026-06-25', 'empresas', '[]'::jsonb));
  IF r->'resumen' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'empresas [] debia dar payload vacio';
  END IF;

  r := metricas_evolucion_dia(jsonb_build_object(
    'escenario', 1000, 'fecha', '2026-06-26'));
  IF jsonb_array_length(r->'corridas') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'dia sin corridas debia dar lista vacia';
  END IF;
  IF (r->'resumen'->>'entregados')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'dia sin entregas debia dar resumen en 0';
  END IF;
END $$;
SELECT 'ok evolucion: fail-closed de empresas y dia vacio' AS r;

-- ─── Teardown ──────────────────────────────────────────────────────────
DELETE FROM demoras_calculadas WHERE zona_id = 610;
DELETE FROM pedidos WHERE id IN (451, 452, 453) AND escenario = 1000;
SELECT 'ok teardown evolucion-dia' AS r;
