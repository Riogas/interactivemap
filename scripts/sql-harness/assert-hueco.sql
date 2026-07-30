\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE escenario_settings SET peso_transito_alpha = 0.3, pedidos_sa_minutos_antes = NULL
 WHERE escenario_id = 1000;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', transito_modo = 'IGUAL',
       incluir_entrega_propia = true, atrapados_modo = 'EXCLUIR',
       estadistico = 'MEDIANA', max_minutos = 120
 WHERE escenario_id = 1000;

-- ─── El ejemplo del documento (DEMORA_MODELO.md 2.5) ─────────────────
-- Centro=100, Costa=200, Cerro=300.
-- M1 prioridad Centro. M2 prioridad Centro + transito Costa.
-- M3 prioridad Costa. M4 prioridad Cerro, NO salio.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'1',100,'URGENTE',1,true),
       (1000,'2',100,'URGENTE',1,true),
       (1000,'2',200,'URGENTE',2,true),
       (1000,'3',200,'URGENTE',1,true),
       (1000,'4',300,'URGENTE',1,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,1,DATE '2026-07-30',true),
       (1000,2,DATE '2026-07-30',true),
       (1000,3,DATE '2026-07-30',true),
       (1000,4,DATE '2026-07-30',false);   -- M4 no salio

-- Ritmos: M1=20, M2=15, M3=25 (5 hechos c/u para ganar el nivel MOVIL).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 5000 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, m.zona, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (1,100,20.0),(2,100,15.0),(3,200,25.0)) AS m(movil, zona, r),
     generate_series(1,5) g;

-- Estado a las 14:00: Centro 3 asignados a M1 + 2 sin asignar.
--                     Costa  1 a M2 + 2 a M3, nada sin asignar.
--                     Cerro  1 atrapado con M4 + 3 sin asignar.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (2,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (3,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (4,1000,'URGENTE',NULL,100,1,DATE '2026-07-30'),
       (5,1000,'URGENTE',NULL,100,1,DATE '2026-07-30'),
       (6,1000,'URGENTE',2,   200,1,DATE '2026-07-30'),
       (7,1000,'URGENTE',3,   200,1,DATE '2026-07-30'),
       (8,1000,'URGENTE',3,   200,1,DATE '2026-07-30'),
       (9,1000,'URGENTE',4,   300,1,DATE '2026-07-30'),
      (10,1000,'URGENTE',NULL,300,1,DATE '2026-07-30'),
      (11,1000,'URGENTE',NULL,300,1,DATE '2026-07-30'),
      (12,1000,'URGENTE',NULL,300,1,DATE '2026-07-30');

-- 1) CENTRO = 60. Es el numero que el documento le prometio al usuario.
--    M1 libre a los 60 (3x20), M2 a los 15 (1x15).
--    SA#1 -> M2 (15 < 60), M2 pasa a 30. SA#2 -> M2 (30 < 60), pasa a 45.
--    El nuevo -> M2 a los 45, mas 15 de su propia entrega = 60.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'CENTRO: % (esperaba 60 = 45 de espera + 15 de entrega)', r.demora_cruda;
  END IF;
  IF r.cola_por_delante IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'CENTRO cola: %', r.cola_por_delante; END IF;
  IF round(r.libre_primero) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'CENTRO libre_primero: % (esperaba 15, M2 antes de la cola)', r.libre_primero;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'CENTRO no puede estar sin capacidad'; END IF;
  RAISE NOTICE 'ok CENTRO = 60 (el ejemplo del documento)';
END $$;

-- 2) COSTA = 30. M3 libre a los 50 (2x25), M2 a los 15 (1x15). Sin cola.
--    El nuevo -> M2 a los 15, mas 15 = 30.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'COSTA: % (esperaba 30)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok COSTA = 30';
END $$;

-- 3) CERRO: ningun movil activo -> sin_capacidad y se informa el techo.
--    El atrapado de M4 no rescata nada.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 300 AND tipo_servicio = 'URGENTE';
  IF NOT r.sin_capacidad THEN RAISE EXCEPTION 'CERRO debio quedar sin capacidad'; END IF;
  IF round(r.demora_cruda) IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'CERRO: % (esperaba el techo, 120)', r.demora_cruda;
  END IF;
  IF r.moviles_considerados <> 0 THEN RAISE EXCEPTION 'CERRO moviles: %', r.moviles_considerados; END IF;
  RAISE NOTICE 'ok CERRO = techo por falta de moviles';
END $$;

-- 4) incluir_entrega_propia = false: la demora llega hasta que SALE el movil.
--    Centro pasa de 60 a 45.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET incluir_entrega_propia = false WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION 'sin entrega propia: % (esperaba 45)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET incluir_entrega_propia = true WHERE escenario_id = 1000;
  RAISE NOTICE 'ok incluir_entrega_propia';
END $$;

-- 5) El pedido nuevo va al PRIMERO que se libera, no al promedio. Le
--    sacamos la cola a Centro: M1 a 60, M2 a 15 -> 15 + 15 = 30, no el
--    promedio de 37,5 + entrega.
DO $$
DECLARE r record;
BEGIN
  DELETE FROM pedidos WHERE id IN (4,5);
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'el minimo sobre servidores: % (esperaba 30, no un promedio)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok el primero que se libera, no el promedio';
END $$;

-- 6) factor_calibracion multiplica el crudo.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET factor_calibracion = 2.0 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'factor 2.0 sobre 30: % (esperaba 60)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET factor_calibracion = 1.0 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok factor_calibracion';
END $$;

-- 7) Una zona con capacidad y cola vacia da el minimo posible, no cero.
--    (El piso duro lo aplica demoras_acabado; aca solo verificamos que el
--    crudo sea el tiempo real y no un 0 enmascarado.)
--    Vaciamos la carga de M2 -el mas rapido, ritmo 15- que vive en la
--    zona 200 (pedido 6), no la de M1: M2 queda libre YA (0) mientras M1
--    sigue ocupado (60, sus 3 pedidos de zona 100 siguen en pie), asi que
--    el minimo no es ambiguo. Vaciar en cambio zona_nro=100 deja a M1 -el
--    mas LENTO, ritmo 20- en 0 y a M2 en 15 (su pedido de zona 200 sigue
--    contando: la carga es global, no por zona): el minimo pasa a ser M1
--    y el resultado da 20, no 15 -- ese fue justamente el bug que este
--    bloque encontro contra la version original del assert.
DO $$
DECLARE r record;
BEGIN
  DELETE FROM pedidos WHERE movil = 2;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'zona vacia: % (esperaba 15 = el ritmo de M2, libre ya)', r.demora_cruda;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'con moviles activos no puede decir sin_capacidad'; END IF;
  RAISE NOTICE 'ok zona con capacidad y cola vacia';
END $$;

TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS', transito_modo = 'SOLO_SI_NO_HAY'
 WHERE escenario_id = 1000;
