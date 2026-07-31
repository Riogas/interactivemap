\set ON_ERROR_STOP on
-- =====================================================================
-- Asserts de docs/sqls/2026-07-31-demoras-calcular-run-v2.sql
--
-- Setup adaptado de assert-run.sql (mismo escenario base: una zona activa
-- con un movil dedicado y demanda pendiente), pero:
--   - Fechado 2026-07-30, no 2026-07-29: los bloques nuevos del Step 1
--     corren corridas ese dia.
--   - El movil se llama 2, no 10: el bloque del bypass de suavizado
--     (mas abajo) apaga TODOS los moviles del escenario/fecha y despues
--     reactiva puntualmente movil_id=2, tal cual lo pide el brief.
--   - No se replican los DO $$ ... $$ viejos de assert-run.sql (esos
--     prueban comportamiento ESPECIFICO del modelo CAPACIDAD_PROMEDIO como
--     unico modelo posible -- interruptor global, ventana por tipo,
--     precedencia capacidad>demanda, idempotencia -- y siguen viviendo en
--     assert-run.sql. Por eso assert-run.sql se cae de la lista de la
--     Task 7 (Step 5 del brief no lo incluye): con el motor despachando
--     entre dos modelos, `UPDATE demoras_config SET motor_activo=false`
--     y las aserciones de demora_informada=120/30 de ese archivo siguen
--     siendo validas igual (el interruptor y la ventana no cambiaron),
--     pero no hace falta duplicarlas aca. Este archivo prueba solo lo que
--     agrega la v2: el despacho entre modelos, el sello de version, el
--     bypass del suavizado, la baja de columnas y el lock.
--
-- No se siembra metricas_cumplimiento a proposito: sin ninguna muestra,
-- el ritmo cae de forma deterministica a demoras_modelo.ritmo_default_minutos
-- (30, DEFECTO) para los dos modelos, que es justamente lo que hace
-- reproducibles a mano los numeros verificados mas abajo.
-- =====================================================================
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, demoras, demoras_calculadas, metricas_cumplimiento;

-- Defensivo (mismo patron que assert-cola.sql / assert-servidores.sql):
-- Step 5 corre los asserts encadenados contra el MISMO contenedor, y
-- assert-hueco.sql dejo pedidos_sa_minutos_antes en NULL. No dependemos de
-- ese valor (los pedidos de aca abajo no llevan fch_hora_para, asi que la
-- ventana SA nunca los filtra), pero se deja explicito para no heredar
-- estado de otro archivo por accidente.
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;

-- Defensivo: los parametros de demoras_modelo que este assert calcula A
-- MANO tienen que partir de un valor conocido, no del que haya dejado
-- otro assert de la misma invocacion (Step 5 encadena varios archivos
-- contra el mismo Postgres). `modelo` no se resetea aca: el primer bloque
-- de mas abajo lo fija explicitamente como primera accion.
UPDATE demoras_modelo SET
  min_minutos = 30, max_minutos = 120, escalon_minutos = 15,
  subida_max = 30, bajada_max = 15,
  suavizado_bypass_cambio_capacidad = false,
  ritmo_metrica = 'ENTRE_ENTREGAS', estadistico = 'MEDIANA',
  ritmo_default_minutos = 30, factor_calibracion = 1.0,
  incluir_entrega_propia = true,
  transito_modo = 'SOLO_SI_NO_HAY',
  atrapados_modo = 'EXCLUIR'
 WHERE escenario_id = 1000;

UPDATE demoras_config SET motor_activo = true, hora_inicio = '00:00', hora_fin = '23:59'
 WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE';

-- Zona 100 activa (AS400), un solo movil dedicado (movil 2, prioridad),
-- 2 pedidos sin asignar el 2026-07-30. Sin asignados a proposito: aisla el
-- efecto que motiva toda la task (el viejo modelo cuenta asignados+sin
-- asignar contra la capacidad; el nuevo solo pone en cola a los sin
-- asignar, porque el trabajo ya asignado entra por el tiempo de
-- liberacion del movil) sin mezclar los dos conteos en la misma corrida.
INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
VALUES (1000, 100, 'Distribucion', 'URGENTE', 35, true);

INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('2', 100, 1000, 'URGENTE', 1);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 2, DATE '2026-07-30', true);

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (20001, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30'),
       (20002, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30');

-- ─── Los dos modelos corren sobre los MISMOS datos ───────────────────
-- Este es el assert que justifica todo el trabajo: el parametro `modelo`
-- tiene que producir numeros distintos, o no sirve para comparar nada.
DO $$
DECLARE v_hueco integer; v_viejo integer; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:00:00-03');
  IF v_n = 0 THEN RAISE EXCEPTION 'PROXIMO_HUECO no escribio ninguna fila'; END IF;
  SELECT demora_informada INTO v_hueco FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:00:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:10:00-03');
  SELECT demora_informada INTO v_viejo FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:10:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  IF v_hueco IS NULL OR v_viejo IS NULL THEN
    RAISE EXCEPTION 'falta alguna de las dos corridas: hueco=% viejo=%', v_hueco, v_viejo;
  END IF;
  IF v_hueco = v_viejo THEN
    RAISE EXCEPTION 'los dos modelos dieron lo mismo (%): el parametro no esta despachando', v_hueco;
  END IF;
  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok los dos modelos dan distinto (hueco=%, viejo=%)', v_hueco, v_viejo;
END $$;

-- ─── Los insumos de auditoria del modelo nuevo se persisten (Important 1,
-- review final) ────────────────────────────────────────────────────────
-- ritmo_aplicado / libre_primero / cola_por_delante / moviles_considerados
-- son los insumos REALES que produjeron demora_cruda en PROXIMO_HUECO --
-- demoras_proximo_hueco ya los devolvia, pero el orquestador los
-- descartaba y persistia ritmo_usado/ritmo_origen del blend de ZONA (el
-- FALLBACK del modelo nuevo, no lo que usa cuando el movil tiene ritmo
-- propio). Sobre el ejemplo de DEMORA_MODELO.md 7.3: Centro informa 60
-- desde el ritmo 15 de M2, pero la fila guardaba 17.50 -- un numero que no
-- participo del calculo. Se verifica contra el resultado DIRECTO de
-- demoras_proximo_hueco para la misma zona/fecha/corrida (no solo "no son
-- NULL"), y que en CAPACIDAD_PROMEDIO las cuatro queden NULL.
DO $$
DECLARE v_directo record; v_guardado record; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  SELECT * INTO v_directo FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 16:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 16:00:00-03');
  SELECT ritmo_aplicado, libre_primero, cola_por_delante, moviles_considerados
    INTO v_guardado
    FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 16:00:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  IF v_guardado.ritmo_aplicado IS NULL THEN
    RAISE EXCEPTION 'PROXIMO_HUECO: los insumos de auditoria quedaron NULL (deberian venir de demoras_proximo_hueco)';
  END IF;
  IF v_guardado.ritmo_aplicado IS DISTINCT FROM v_directo.ritmo_aplicado THEN
    RAISE EXCEPTION 'PROXIMO_HUECO: ritmo_aplicado guardado % (esperaba % del calculo directo)', v_guardado.ritmo_aplicado, v_directo.ritmo_aplicado;
  END IF;
  IF v_guardado.libre_primero IS DISTINCT FROM v_directo.libre_primero THEN
    RAISE EXCEPTION 'PROXIMO_HUECO: libre_primero guardado % (esperaba %)', v_guardado.libre_primero, v_directo.libre_primero;
  END IF;
  IF v_guardado.cola_por_delante IS DISTINCT FROM v_directo.cola_por_delante THEN
    RAISE EXCEPTION 'PROXIMO_HUECO: cola_por_delante guardado % (esperaba %)', v_guardado.cola_por_delante, v_directo.cola_por_delante;
  END IF;
  IF v_guardado.moviles_considerados IS DISTINCT FROM v_directo.moviles_considerados THEN
    RAISE EXCEPTION 'PROXIMO_HUECO: moviles_considerados guardado % (esperaba %)', v_guardado.moviles_considerados, v_directo.moviles_considerados;
  END IF;

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 16:10:00-03');
  SELECT ritmo_aplicado, libre_primero, cola_por_delante, moviles_considerados
    INTO v_guardado
    FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 16:10:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v_guardado.ritmo_aplicado IS NOT NULL OR v_guardado.libre_primero IS NOT NULL
     OR v_guardado.cola_por_delante IS NOT NULL OR v_guardado.moviles_considerados IS NOT NULL THEN
    RAISE EXCEPTION 'CAPACIDAD_PROMEDIO no debio persistir insumos de PROXIMO_HUECO: ritmo_aplicado=% libre_primero=% cola_por_delante=% moviles_considerados=%',
      v_guardado.ritmo_aplicado, v_guardado.libre_primero, v_guardado.cola_por_delante, v_guardado.moviles_considerados;
  END IF;

  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok insumos de auditoria de PROXIMO_HUECO persistidos y verificados contra el calculo directo; NULL en CAPACIDAD_PROMEDIO';
END $$;

-- ─── El sello de version ─────────────────────────────────────────────
DO $$
DECLARE v_ver integer; v_actual integer; v_n bigint;
BEGIN
  SELECT version INTO v_actual FROM demoras_modelo WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:20:00-03');
  SELECT DISTINCT modelo_version INTO v_ver FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:20:00-03';
  IF v_ver IS DISTINCT FROM v_actual THEN
    RAISE EXCEPTION 'modelo_version sellado: % (esperaba %)', v_ver, v_actual;
  END IF;
  RAISE NOTICE 'ok sello de version en cada fila';
END $$;

-- ─── El suavizado se saltea cuando cambia la capacidad ───────────────
-- Corrida 1 sin moviles (techo 120). Se activa un movil. Corrida 2 tiene
-- que poder bajar mas de bajada_max, porque la baja es real.
DO $$
DECLARE v1 integer; v2 integer; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET suavizado_bypass_cambio_capacidad = true, bajada_max = 15
   WHERE escenario_id = 1000;
  UPDATE moviles_dia SET activo = false WHERE escenario_id = 1000 AND fecha = DATE '2026-07-30';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:00:00-03');
  SELECT demora_informada INTO v1 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:00:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v1 IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'sin moviles esperaba 120, dio %', v1; END IF;

  UPDATE moviles_dia SET activo = true
   WHERE escenario_id = 1000 AND movil_id = 2 AND fecha = DATE '2026-07-30';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:10:00-03');
  SELECT demora_informada INTO v2 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:10:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v2 >= 105 THEN
    RAISE EXCEPTION 'con bypass, la baja no debio frenarse en 15 min/corrida: paso de % a %', v1, v2;
  END IF;
  RAISE NOTICE 'ok bypass del suavizado por cambio de capacidad (% -> %)', v1, v2;
END $$;

-- ─── Las columnas de calculo ya no estan en demoras_config ───────────
-- DESVIO DEL PLAN, documentado tambien junto al ALTER TABLE de la
-- migracion: 'ritmo_cascada' se saco de esta lista. A diferencia de las
-- otras ocho, demoras_ritmo (Task 3, ya commiteada) todavia la lee de
-- demoras_config POR TIPO (docs/sqls/2026-07-31-demoras-ritmo-v2.sql,
-- CTE cascada_cruda) y su propio assert (assert-ritmo.sql) prueba URGENTE
-- y SERVICE con cascadas distintas A LA VEZ -- algo que demoras_modelo,
-- con una sola fila por escenario, no puede representar. Confirmado con
-- el harness: dropear esta columna igual que las otras rompe
-- demoras_ritmo en runtime ("column dc.ritmo_cascada does not exist"), y
-- como demoras_servidores/demoras_proximo_hueco/este mismo orquestador
-- llaman a demoras_ritmo, tumba el motor ENTERO (los dos modelos), no
-- solo al viejo -- el peor de los dos resultados posibles.
DO $$
DECLARE v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['min_minutos','max_minutos','escalon_minutos','subida_max',
                               'bajada_max','estadistico',
                               'ritmo_default_minutos','factor_calibracion'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'demoras_config' AND column_name = v_col) THEN
      RAISE EXCEPTION 'demoras_config todavia tiene la columna de calculo %', v_col;
    END IF;
  END LOOP;

  -- Lo operativo SI se queda. ritmo_cascada tambien -ver el comentario de
  -- arriba y el de la migracion-, asi que va con el resto de lo que
  -- sobrevive, no con lo que se da de baja.
  FOREACH v_col IN ARRAY ARRAY['motor_activo','hora_inicio','hora_fin','ritmo_cascada'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'demoras_config' AND column_name = v_col) THEN
      RAISE EXCEPTION 'demoras_config perdio la columna operativa %', v_col;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok reparto de columnas entre las dos tablas (ritmo_cascada se queda, ver desvio documentado)';
END $$;

-- ─── sin_capacidad describe el ESTADO DEL MUNDO, no un atajo del modelo ──
-- Fix round 1 (reviewer, Critical): con moviles de TRANSITO y
-- peso_transito_alpha=0 (config soportada por el CHECK de demoras_modelo y
-- documentada en transito_modo=ALPHA), demoras_capacidad da
-- capacidad_efectiva=0 aunque haya moviles activos trabajando la zona.
-- Antes del fix, el modelo viejo marcaba sin_capacidad=true ahi (via
-- a.capacidad<=0, la capacidad PRORRATEADA) y el nuevo no (via a.mov_act<=0,
-- que solo mira si hay ALGUN movil activo): el mismo dato quedaba en
-- poblaciones distintas para el endpoint de comparativa, que EXCLUYE del
-- promedio y de la brecha las filas con sin_capacidad=true. Comparar los
-- dos modelos sobre los mismos datos -el punto de esta task- se rompe si
-- cada uno decide con una regla distinta cuales filas cuentan.
--
-- Zona 700, pura de transito (NINGUN movil de prioridad asignado), un solo
-- movil activo, alpha=0: capacidad_efectiva sale 0 pero SI hay alguien
-- trabajando. Los dos modelos tienen que marcar sin_capacidad=false.
-- (El modelo viejo va a informar igual el techo -via a.capacidad<=0 en la
-- rama de demora_cruda, sin tocar- pero SIN la bandera puesta: es un
-- defecto real del modelo viejo, no algo que este bloque deba tapar.)
DO $$
DECLARE v_sin_hueco boolean; v_sin_viejo boolean; v_n bigint;
BEGIN
  INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
  VALUES (1000, 700, 'Distribucion', 'URGENTE', 40, true);
  INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
  VALUES ('70', 700, 1000, 'URGENTE', 2);
  INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
  VALUES (1000, 70, DATE '2026-07-30', true);
  UPDATE escenario_settings SET peso_transito_alpha = 0 WHERE escenario_id = 1000;

  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:20:00-03');
  SELECT sin_capacidad INTO v_sin_hueco FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:20:00-03'
     AND zona_id = 700 AND tipo_servicio = 'URGENTE';

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:30:00-03');
  SELECT sin_capacidad INTO v_sin_viejo FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:30:00-03'
     AND zona_id = 700 AND tipo_servicio = 'URGENTE';

  IF v_sin_hueco IS NULL OR v_sin_viejo IS NULL THEN
    RAISE EXCEPTION 'falta alguna de las dos corridas en zona 700: hueco=% viejo=%', v_sin_hueco, v_sin_viejo;
  END IF;
  IF v_sin_hueco IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'zona de puro transito con alpha=0: PROXIMO_HUECO debia marcar sin_capacidad=false (hay un movil activo), dio %', v_sin_hueco;
  END IF;
  IF v_sin_viejo IS DISTINCT FROM v_sin_hueco THEN
    RAISE EXCEPTION 'sin_capacidad diverge entre modelos con capacidad prorrateada 0 pero movil activo: hueco=% viejo=% (el endpoint de comparativa excluye estas filas del promedio -- si difieren, los dos modelos se comparan sobre poblaciones distintas)', v_sin_hueco, v_sin_viejo;
  END IF;

  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok sin_capacidad no diverge entre modelos con transito puro y alpha=0 (hueco=%, viejo=%)', v_sin_hueco, v_sin_viejo;
END $$;

-- ─── El advisory lock (dispara el test de concurrencia del harness) ───
-- El runner busca la cadena advisory_xact_lock en los asserts para decidir
-- si lanza las dos conexiones concurrentes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.proname = 'demoras_calcular_run'
       AND pg_get_functiondef(p.oid) LIKE '%advisory_xact_lock%') THEN
    RAISE EXCEPTION 'demoras_calcular_run perdio el advisory lock';
  END IF;
  RAISE NOTICE 'ok el lock sigue en su lugar';
END $$;

-- Restaurar demoras_modelo para no ensuciar corridas posteriores en la
-- misma invocacion del harness (mismo patron que assert-modelo.sql /
-- assert-hueco.sql). No hay ningun assert despues de este en la Step 5
-- del brief, pero es gratis y evita sorpresas si algun dia se agrega uno.
UPDATE demoras_modelo SET
  suavizado_bypass_cambio_capacidad = false,
  bajada_max = 15
 WHERE escenario_id = 1000;
