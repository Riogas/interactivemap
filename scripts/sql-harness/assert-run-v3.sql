\set ON_ERROR_STOP on
-- =====================================================================
-- Asserts de docs/sqls/2026-08-01-demoras-calcular-run-v3.sql
--
-- Parte de assert-run-v2.sql (mismo escenario base 1000: zona 100, un solo
-- movil dedicado -movil 2-, 2 pedidos sin asignar, fechado 2026-07-30) y
-- agrega lo que pide el brief de esta task:
--
--   1-2. Dos escenarios (1000 y 2000) con fila en demoras_modelo se
--        calculan LOS DOS en una misma corrida; un tercero (4000) con
--        demoras_config Y demanda real pero SIN fila en demoras_modelo NO
--        se calcula. Es el bloque que prueba que se fue el 1000 clavado.
--   3. Los dos modelos (ahora CONSUMO_TRAMOS y CAPACIDAD_PROMEDIO --
--      PROXIMO_HUECO ya no es un valor valido despues de la Task 1, el
--      CHECK de demoras_modelo lo rechaza) siguen dando distinto.
--   4. Las columnas de auditoria del modelo nuevo (capacidad_inicial,
--      capacidad_final, tramos, cola_por_delante, moviles_considerados) se
--      persisten con CONSUMO_TRAMOS -verificadas contra el calculo DIRECTO
--      de demoras_consumo_tramos, no solo "no son NULL"- y quedan NULL con
--      CAPACIDAD_PROMEDIO.
--   5. sin_capacidad no diverge entre modelos (el hallazgo Critical de la
--      tanda anterior, ahora con moviles_activos <= 0 en las DOS ramas, sin
--      CASE por modelo).
--   6. El advisory lock sigue en su lugar (dispara el test de concurrencia
--      del runner) Y esta ANTES del loop de escenarios en el texto de la
--      funcion (chequeo estatico de posicion): un lock adentro del loop
--      serializaria escenario por escenario, no la corrida entera.
--
-- Fix round 1 (review): dos hallazgos del reviewer, cada uno con mutante
-- propio y verificado, que sobrevivian a los 71 asserts de la primera
-- entrega:
--   7. El suavizado NO se filtra entre escenarios: la CTE `prev` tiene que
--      seguir siendo POR ESCENARIO aunque dos zonas de departamentos
--      distintos compartan el mismo NUMERO. Sin el filtro `escenario =
--      v_esc`, una zona toma como "corrida anterior" la de OTRO escenario
--      con el mismo numero de zona, y el suavizado arrastra un valor
--      ajeno sin ningun error visible -- el riesgo real que introduce el
--      cambio de alcance de esta task (antes de esta task ese filtro era
--      decorativo, con un solo escenario nunca podia colisionar).
--   8. El valor devuelto (filas escritas) tiene que ser la SUMA de todos
--      los escenarios, no la del ultimo procesado -- un acumulador que
--      usa `:=` en vez de sumar miente en silencio sobre cuanto trabajo
--      hizo la corrida.
--
-- No se replican aca los DO $$ ... $$ que prueban comportamiento
-- ESPECIFICO de CAPACIDAD_PROMEDIO como unico modelo posible (siguen en
-- assert-run.sql) ni el resto de los bloques de assert-run-v2.sql que no
-- cambian con esta task (idempotencia del ON CONFLICT, etc.) -- ver el
-- header de assert-run-v2.sql para esa justificacion, que sigue vigente.
--
-- OJO -- dependencia cruzada real encontrada escribiendo este archivo: el
-- bloque "sello de version" original (assert-run-v2.sql) lee
-- `SELECT DISTINCT modelo_version INTO v_ver FROM demoras_calculadas WHERE
-- corrida_at = ...` SIN filtrar por escenario. Con un solo escenario
-- configurado (v2) eso era inambiguo; en ESTE archivo, para esa misma
-- corrida_at ya hay filas de los escenarios 1000 Y 2000 (sembrados en el
-- primer bloque, mas abajo, y nunca limpiados hasta el final del archivo),
-- cada uno con su PROPIA version en demoras_modelo. Sin el filtro, `SELECT
-- DISTINCT ... INTO` (no STRICT) no lanza error con mas de una fila: toma
-- la primera segun un orden no garantizado, y el assert podria comparar
-- contra la version del escenario EQUIVOCADO y pasar por casualidad la
-- mitad de las veces. Se agrega `AND escenario = 1000` a esa consulta (y,
-- por prolijidad/robustez, a los demas bloques reusados que ya filtraban
-- por zona_id/tipo_servicio pero no explicitaban el escenario).
--
-- No se siembra metricas_cumplimiento a proposito: sin ninguna muestra, el
-- ritmo cae de forma deterministica a demoras_modelo.ritmo_default_minutos
-- (30, DEFECTO) para los dos modelos, en los tres escenarios.
-- =====================================================================
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, demoras, demoras_calculadas, metricas_cumplimiento;

-- Defensivo (mismo patron que assert-cola.sql / assert-run-v2.sql): Step 5
-- corre los asserts encadenados contra el MISMO contenedor.
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;

-- Defensivo: los parametros de demoras_modelo que este assert calcula A
-- MANO tienen que partir de un valor conocido. `transito_modo` NO esta en
-- esta lista -- la Task 1 dio de baja esa columna (y transito_castigo_
-- minutos / transito_margen_minutos con ella); un UPDATE que la mencione
-- falla con "column does not exist" antes de escribir una sola fila. En su
-- lugar van los cuatro parametros nuevos de CONSUMO_TRAMOS (Task 1), fijados
-- en sus defaults para que este archivo no dependa de que nadie los edite.
UPDATE demoras_modelo SET
  min_minutos = 30, max_minutos = 120, escalon_minutos = 15,
  subida_max = 30, bajada_max = 15,
  suavizado_bypass_cambio_capacidad = false,
  ritmo_metrica = 'ENTRE_ENTREGAS', estadistico = 'MEDIANA',
  ritmo_default_minutos = 30, factor_calibracion = 1.0,
  incluir_entrega_propia = true,
  dedicacion_transito = 0.20, transito_dedicacion_max_total = 0.60,
  traslado_fuera_zona_minutos = 15, ritmo_hueco_min_minutos = 5,
  atrapados_modo = 'EXCLUIR',
  modelo = 'CONSUMO_TRAMOS'
 WHERE escenario_id = 1000;

UPDATE demoras_config SET motor_activo = true, hora_inicio = '00:00', hora_fin = '23:59'
 WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE';

-- Zona 100 activa (AS400), un solo movil dedicado (movil 2, prioridad),
-- 2 pedidos sin asignar el 2026-07-30. Sin asignados a proposito: aisla el
-- efecto que motivo toda la tanda (el modelo viejo cuenta asignados+sin
-- asignar contra la capacidad; CONSUMO_TRAMOS solo pone en cola a los sin
-- asignar -- los asignados en zona entran por demoras_cola v2, no por aca)
-- sin mezclar los dos conteos en la misma corrida.
INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
VALUES (1000, 100, 'Distribucion', 'URGENTE', 35, true);

INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('2', 100, 1000, 'URGENTE', 1);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 2, DATE '2026-07-30', true);

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (20001, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30'),
       (20002, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30');

-- ─── Dos escenarios se calculan; uno sin fila en demoras_modelo NO ───
-- Es el bloque que prueba que se fue el `v_esc integer := 1000` clavado.
-- Escenario 2000: fila propia en demoras_modelo Y demoras_config, con
-- demanda real (zona 2100, un movil, un pedido sin asignar) -- si el
-- orquestador siguiera clavado en 1000, este escenario nunca escribiria
-- nada aunque este perfectamente configurado.
-- Escenario 4000: demanda real y fila en demoras_config (o sea, esta
-- "operativamente" listo), pero SIN fila en demoras_modelo -- tiene que
-- quedar completamente afuera, exactamente como pide el brief punto 2.
DO $$
DECLARE v_n bigint; v_1000 integer; v_2000 integer; v_4000 integer;
BEGIN
  INSERT INTO escenario_settings (escenario_id, peso_transito_alpha, nombre)
  VALUES (2000, 0.3, 'Escenario 2000');
  INSERT INTO demoras_modelo (escenario_id) VALUES (2000);
  INSERT INTO demoras_config (escenario_id, tipo_servicio, motor_activo, hora_inicio, hora_fin)
  VALUES (2000, 'URGENTE', true, '00:00', '23:59');
  INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
  VALUES (2000, 2100, 'Distribucion', 'URGENTE', 40, true);
  INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
  VALUES ('20', 2100, 2000, 'URGENTE', 1);
  INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
  VALUES (2000, 20, DATE '2026-07-30', true);
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (22001, 2000, 'URGENTE', NULL, 2100, 1, DATE '2026-07-30');

  INSERT INTO demoras_config (escenario_id, tipo_servicio, motor_activo, hora_inicio, hora_fin)
  VALUES (4000, 'URGENTE', true, '00:00', '23:59');
  INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
  VALUES (4000, 4100, 'Distribucion', 'URGENTE', 40, true);
  INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
  VALUES ('40', 4100, 4000, 'URGENTE', 1);
  INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
  VALUES (4000, 40, DATE '2026-07-30', true);
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (44001, 4000, 'URGENTE', NULL, 4100, 1, DATE '2026-07-30');

  v_n := demoras_calcular_run(timestamptz '2026-07-30 13:00:00-03');
  IF v_n = 0 THEN RAISE EXCEPTION 'la corrida con 3 escenarios seed no escribio ninguna fila'; END IF;

  SELECT count(*) INTO v_1000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 13:00:00-03' AND escenario = 1000;
  SELECT count(*) INTO v_2000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 13:00:00-03' AND escenario = 2000;
  SELECT count(*) INTO v_4000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 13:00:00-03' AND escenario = 4000;

  IF v_1000 = 0 THEN
    RAISE EXCEPTION 'escenario 1000 no escribio nada en una corrida con 3 escenarios sembrados';
  END IF;
  IF v_2000 = 0 THEN
    RAISE EXCEPTION 'escenario 2000 (fila propia en demoras_modelo, demanda real) no se calculo: el 1000 sigue clavado';
  END IF;
  IF v_4000 <> 0 THEN
    RAISE EXCEPTION 'escenario 4000 (SIN fila en demoras_modelo, pero CON demoras_config y demanda real) escribio % filas: se calculo algo que no deberia haberse tocado', v_4000;
  END IF;

  RAISE NOTICE 'ok dos escenarios con fila en demoras_modelo se calculan los dos (1000=% filas, 2000=% filas); uno sin fila en demoras_modelo NO se calcula aunque tenga demoras_config y demanda real', v_1000, v_2000;
END $$;

-- ─── Los dos modelos corren sobre los MISMOS datos ───────────────────
-- Este es el assert que justifica todo el trabajo: el parametro `modelo`
-- tiene que producir numeros distintos, o no sirve para comparar nada.
-- PROXIMO_HUECO -> CONSUMO_TRAMOS: el CHECK de demoras_modelo (Task 1) ya
-- no acepta el valor viejo.
DO $$
DECLARE v_tramos integer; v_viejo integer; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:00:00-03');
  IF v_n = 0 THEN RAISE EXCEPTION 'CONSUMO_TRAMOS no escribio ninguna fila'; END IF;
  SELECT demora_informada INTO v_tramos FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:00:00-03'
     AND escenario = 1000 AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:10:00-03');
  SELECT demora_informada INTO v_viejo FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:10:00-03'
     AND escenario = 1000 AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  IF v_tramos IS NULL OR v_viejo IS NULL THEN
    RAISE EXCEPTION 'falta alguna de las dos corridas: tramos=% viejo=%', v_tramos, v_viejo;
  END IF;
  IF v_tramos = v_viejo THEN
    RAISE EXCEPTION 'los dos modelos dieron lo mismo (%): el parametro no esta despachando', v_tramos;
  END IF;
  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok los dos modelos dan distinto (tramos=%, viejo=%)', v_tramos, v_viejo;
END $$;

-- ─── Las columnas de auditoria del modelo nuevo se persisten ─────────
-- capacidad_inicial / capacidad_final / tramos / cola_por_delante /
-- moviles_considerados son los insumos REALES de demoras_consumo_tramos.
-- Se verifica contra el resultado DIRECTO de esa funcion para la misma
-- zona/fecha/corrida (no solo "no son NULL"), y que en CAPACIDAD_PROMEDIO
-- las cinco queden NULL.
DO $$
DECLARE v_directo record; v_guardado record; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE escenario_id = 1000;
  SELECT * INTO v_directo FROM demoras_consumo_tramos(1000, DATE '2026-07-30', timestamptz '2026-07-30 16:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 16:00:00-03');
  SELECT capacidad_inicial, capacidad_final, tramos, cola_por_delante, moviles_considerados
    INTO v_guardado
    FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 16:00:00-03'
     AND escenario = 1000 AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  IF v_guardado.capacidad_inicial IS NULL THEN
    RAISE EXCEPTION 'CONSUMO_TRAMOS: capacidad_inicial quedo NULL (deberia venir de demoras_consumo_tramos)';
  END IF;
  IF v_guardado.capacidad_inicial IS DISTINCT FROM v_directo.capacidad_inicial THEN
    RAISE EXCEPTION 'CONSUMO_TRAMOS: capacidad_inicial guardado % (esperaba % del calculo directo)', v_guardado.capacidad_inicial, v_directo.capacidad_inicial;
  END IF;
  IF v_guardado.capacidad_final IS DISTINCT FROM v_directo.capacidad_final THEN
    RAISE EXCEPTION 'CONSUMO_TRAMOS: capacidad_final guardado % (esperaba %)', v_guardado.capacidad_final, v_directo.capacidad_final;
  END IF;
  IF v_guardado.tramos IS DISTINCT FROM v_directo.tramos THEN
    RAISE EXCEPTION 'CONSUMO_TRAMOS: tramos guardado % (esperaba %)', v_guardado.tramos, v_directo.tramos;
  END IF;
  IF v_guardado.cola_por_delante IS DISTINCT FROM v_directo.cola_por_delante THEN
    RAISE EXCEPTION 'CONSUMO_TRAMOS: cola_por_delante guardado % (esperaba %)', v_guardado.cola_por_delante, v_directo.cola_por_delante;
  END IF;
  IF v_guardado.moviles_considerados IS DISTINCT FROM v_directo.moviles_considerados THEN
    RAISE EXCEPTION 'CONSUMO_TRAMOS: moviles_considerados guardado % (esperaba %)', v_guardado.moviles_considerados, v_directo.moviles_considerados;
  END IF;

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 16:10:00-03');
  SELECT capacidad_inicial, capacidad_final, tramos, cola_por_delante, moviles_considerados
    INTO v_guardado
    FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 16:10:00-03'
     AND escenario = 1000 AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v_guardado.capacidad_inicial IS NOT NULL OR v_guardado.capacidad_final IS NOT NULL
     OR v_guardado.tramos IS NOT NULL OR v_guardado.cola_por_delante IS NOT NULL
     OR v_guardado.moviles_considerados IS NOT NULL THEN
    RAISE EXCEPTION 'CAPACIDAD_PROMEDIO no debio persistir columnas de auditoria de CONSUMO_TRAMOS: capacidad_inicial=% capacidad_final=% tramos=% cola_por_delante=% moviles_considerados=%',
      v_guardado.capacidad_inicial, v_guardado.capacidad_final, v_guardado.tramos, v_guardado.cola_por_delante, v_guardado.moviles_considerados;
  END IF;

  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok columnas de auditoria de CONSUMO_TRAMOS persistidas y verificadas contra el calculo directo; NULL en CAPACIDAD_PROMEDIO';
END $$;

-- ─── El sello de version ─────────────────────────────────────────────
-- OJO: filtrado por escenario = 1000 -- ver el comentario del encabezado.
-- Sin ese filtro, con los escenarios 2000/4000 sembrados mas arriba, esta
-- corrida tambien escribe filas de 2000 con SU PROPIA version y el
-- `SELECT DISTINCT ... INTO` (no STRICT) podria tomar cualquiera de las
-- dos sin avisar.
DO $$
DECLARE v_ver integer; v_actual integer; v_n bigint;
BEGIN
  SELECT version INTO v_actual FROM demoras_modelo WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:20:00-03');
  SELECT DISTINCT modelo_version INTO v_ver FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:20:00-03' AND escenario = 1000;
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
     AND escenario = 1000 AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v1 IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'sin moviles esperaba 120, dio %', v1; END IF;

  UPDATE moviles_dia SET activo = true
   WHERE escenario_id = 1000 AND movil_id = 2 AND fecha = DATE '2026-07-30';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:10:00-03');
  SELECT demora_informada INTO v2 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:10:00-03'
     AND escenario = 1000 AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v2 >= 105 THEN
    RAISE EXCEPTION 'con bypass, la baja no debio frenarse en 15 min/corrida: paso de % a %', v1, v2;
  END IF;
  RAISE NOTICE 'ok bypass del suavizado por cambio de capacidad (% -> %)', v1, v2;
END $$;

-- ─── sin_capacidad describe el ESTADO DEL MUNDO, no un atajo de modelo ──
-- Fix round 1 de la tanda anterior (reviewer, Critical), cerrado ahora para
-- los DOS modelos con la MISMA expresion (moviles_activos <= 0, sin CASE):
-- con moviles de TRANSITO y peso_transito_alpha=0 (config soportada por el
-- CHECK de demoras_modelo), demoras_capacidad da capacidad_efectiva=0
-- aunque haya moviles activos trabajando la zona. El modelo viejo va a
-- informar igual el techo (via a.capacidad<=0 en la rama de demora_cruda,
-- que NO se toca) pero SIN la bandera puesta: es un defecto real de ESE
-- modelo, no algo que este bloque deba tapar.
--
-- Zona 700, pura de transito (NINGUN movil de prioridad asignado), un solo
-- movil activo, alpha=0: capacidad_efectiva sale 0 pero SI hay alguien
-- trabajando. Los dos modelos tienen que marcar sin_capacidad=false.
DO $$
DECLARE v_sin_tramos boolean; v_sin_viejo boolean; v_n bigint;
BEGIN
  INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
  VALUES (1000, 700, 'Distribucion', 'URGENTE', 40, true);
  INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
  VALUES ('70', 700, 1000, 'URGENTE', 2);
  INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
  VALUES (1000, 70, DATE '2026-07-30', true);
  UPDATE escenario_settings SET peso_transito_alpha = 0 WHERE escenario_id = 1000;

  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:20:00-03');
  SELECT sin_capacidad INTO v_sin_tramos FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:20:00-03'
     AND escenario = 1000 AND zona_id = 700 AND tipo_servicio = 'URGENTE';

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:30:00-03');
  SELECT sin_capacidad INTO v_sin_viejo FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:30:00-03'
     AND escenario = 1000 AND zona_id = 700 AND tipo_servicio = 'URGENTE';

  IF v_sin_tramos IS NULL OR v_sin_viejo IS NULL THEN
    RAISE EXCEPTION 'falta alguna de las dos corridas en zona 700: tramos=% viejo=%', v_sin_tramos, v_sin_viejo;
  END IF;
  IF v_sin_tramos IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'zona de puro transito con alpha=0: CONSUMO_TRAMOS debia marcar sin_capacidad=false (hay un movil activo), dio %', v_sin_tramos;
  END IF;
  IF v_sin_viejo IS DISTINCT FROM v_sin_tramos THEN
    RAISE EXCEPTION 'sin_capacidad diverge entre modelos con capacidad prorrateada 0 pero movil activo: tramos=% viejo=% (el endpoint de comparativa excluye estas filas del promedio -- si difieren, los dos modelos se comparan sobre poblaciones distintas)', v_sin_tramos, v_sin_viejo;
  END IF;

  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE escenario_id = 1000;
  UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok sin_capacidad no diverge entre modelos con transito puro y alpha=0 (tramos=%, viejo=%)', v_sin_tramos, v_sin_viejo;
END $$;

-- ─── Fix round 1 (review): el suavizado NO se filtra entre escenarios ──
-- Hallazgo del reviewer: si se le saca a la CTE `prev` el filtro
-- `escenario = v_esc`, los 71 asserts de la primera entrega seguian
-- pasando. Es el riesgo real que introduce el cambio de alcance de esta
-- task: antes habia un solo escenario y el filtro era decorativo; ahora es
-- lo que separa los departamentos. Sin el, una zona del escenario 1000
-- tomaria como "corrida anterior" la de una zona con el MISMO NUMERO del
-- escenario 2000, y el suavizado arrastraria un valor ajeno sin ningun
-- error visible.
--
-- Zona 9500, CON EL MISMO NUMERO en los dos escenarios (1000 y 2000), cada
-- uno con su propio movil y la MISMA demanda (2 sin asignar, sin
-- historial de ritmo -> crudo=90 en los dos, identico -- verificado igual
-- que el crudo=90 del bloque "los dos modelos dan distinto" mas arriba,
-- mismo movil unico + misma cola). Se siembra a mano (INSERT directo, sin
-- pasar por el motor) una fila "corrida anterior" para cada escenario, EN
-- INSTANTES DISTINTOS (16:50 el 1000, 16:55 el 2000) para que un DISTINCT
-- ON sin filtro de escenario NO empate: sin el filtro, "la mas reciente
-- para zona 9500/URGENTE" es SIEMPRE la del escenario 2000 (16:55),
-- para los DOS escenarios.
--
-- Con crudo=90 identico en los dos y prev DISTINTO (40 el 1000, 100 el
-- 2000), subida_max=30/bajada_max=15 hacen que el resultado dependa
-- del prev de forma verificable con un numero exacto:
--   1000 (prev propio 40): 90>40 -> sube, tope 40+30=70 -> ceil(70/15)*15=75
--   2000 (prev propio 100): 90<100 -> baja, piso 100-15=85 -> ceil(85/15)*15=90
-- Si el filtro faltara, el 1000 leeria el prev del 2000 (100 en vez de 40)
-- y darial 90 en vez de 75 -- exactamente el numero que atrapa al mutante,
-- verificado mas abajo en el reporte de la task.
DO $$
DECLARE v_1000 integer; v_2000 integer; v_n bigint;
BEGIN
  INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
  VALUES (1000, 9500, 'Distribucion', 'URGENTE', 35, true),
         (2000, 9500, 'Distribucion', 'URGENTE', 35, true);
  INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
  VALUES ('95', 9500, 1000, 'URGENTE', 1),
         ('96', 9500, 2000, 'URGENTE', 1);
  INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
  VALUES (1000, 95, DATE '2026-07-30', true),
         (2000, 96, DATE '2026-07-30', true);
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (95001, 1000, 'URGENTE', NULL, 9500, 1, DATE '2026-07-30'),
         (95002, 1000, 'URGENTE', NULL, 9500, 1, DATE '2026-07-30'),
         (95003, 2000, 'URGENTE', NULL, 9500, 1, DATE '2026-07-30'),
         (95004, 2000, 'URGENTE', NULL, 9500, 1, DATE '2026-07-30');

  -- El bypass por cambio de capacidad no debe interferir: se fuerza false
  -- en los dos escenarios (2000 ya nace en false por default; 1000 puede
  -- venir en true del bloque anterior).
  UPDATE demoras_modelo SET suavizado_bypass_cambio_capacidad = false WHERE escenario_id IN (1000, 2000);

  -- "Corrida anterior" sembrada A MANO, sin pasar por el motor -- lo que se
  -- prueba es la lectura de `prev`, no como se llego a ese valor.
  INSERT INTO demoras_calculadas
    (corrida_at, escenario, zona_id, tipo_servicio, demora_informada, demora_suavizada, demora_cruda, moviles_activos)
  VALUES
    (timestamptz '2026-07-30 16:50:00-03', 1000, 9500, 'URGENTE', 40,  40,  40,  1),
    (timestamptz '2026-07-30 16:55:00-03', 2000, 9500, 'URGENTE', 100, 100, 100, 1);

  v_n := demoras_calcular_run(timestamptz '2026-07-30 17:00:00-03');

  SELECT demora_informada INTO v_1000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 17:00:00-03'
     AND escenario = 1000 AND zona_id = 9500 AND tipo_servicio = 'URGENTE';
  SELECT demora_informada INTO v_2000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 17:00:00-03'
     AND escenario = 2000 AND zona_id = 9500 AND tipo_servicio = 'URGENTE';

  IF v_1000 IS NULL OR v_2000 IS NULL THEN
    RAISE EXCEPTION 'falta alguna de las dos corridas en zona 9500: 1000=% 2000=%', v_1000, v_2000;
  END IF;
  IF v_1000 <> 75 THEN
    RAISE EXCEPTION 'escenario 1000, zona 9500: demora_informada=% (esperaba 75, de su PROPIO prev=40; si dio 90 es que arrastro el prev=100 del escenario 2000 -- el suavizado se filtro entre escenarios)', v_1000;
  END IF;
  IF v_2000 <> 90 THEN
    RAISE EXCEPTION 'escenario 2000, zona 9500: demora_informada=% (esperaba 90, de su propio prev=100)', v_2000;
  END IF;
  RAISE NOTICE 'ok el suavizado no se filtra entre escenarios con zonas de igual numero (1000=%, 2000=%, mismo crudo=90 los dos)', v_1000, v_2000;
END $$;

-- ─── Fix round 1 (review): el acumulador suma TODOS los escenarios ────
-- Hallazgo del reviewer: si `v_escritas` se ASIGNA (`:=`) en vez de
-- sumarse en cada vuelta del loop, tambien pasaban los 71 asserts -- el
-- valor devuelto quedaria en la cantidad de filas del ULTIMO escenario
-- procesado (2000, por el ORDER BY escenario_id), no el total. Es la
-- mentira silenciosa que un `bigint := v_n` en vez de `bigint := bigint +
-- v_n` produce: la funcion devuelve la cantidad de filas escritas y eso es
-- lo que se mira para saber si una corrida hizo algo.
--
-- No se hardcodean numeros de fila esperados (dependen de cuantas zonas
-- quedaron activas en cada escenario a esta altura del archivo): se
-- verifica el INVARIANTE -- el valor devuelto tiene que ser la SUMA de
-- las filas realmente escritas en TODOS los escenarios de esa corrida,
-- contadas de forma independiente con un count(*) plano -- y que el
-- fixture efectivamente tenga cantidades DISTINTAS por escenario (si
-- dieran lo mismo, un acumulador que se queda con el ultimo podria pasar
-- por coincidencia).
DO $$
DECLARE v_n bigint; v_total bigint; v_1000 bigint; v_2000 bigint;
BEGIN
  v_n := demoras_calcular_run(timestamptz '2026-07-30 17:10:00-03');

  SELECT count(*) INTO v_total FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 17:10:00-03';
  SELECT count(*) INTO v_1000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 17:10:00-03' AND escenario = 1000;
  SELECT count(*) INTO v_2000 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 17:10:00-03' AND escenario = 2000;

  IF v_1000 = 0 OR v_2000 = 0 THEN
    RAISE EXCEPTION 'el fixture no sirve para este test: algun escenario no escribio nada (1000=%, 2000=%)', v_1000, v_2000;
  END IF;
  IF v_1000 = v_2000 THEN
    RAISE EXCEPTION 'el fixture no sirve para este test: escenario 1000 y 2000 escribieron la misma cantidad de filas (%); hace falta que difieran para detectar un acumulador que se queda con el ultimo', v_1000;
  END IF;
  IF v_n IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'demoras_calcular_run devolvio % pero se escribieron % filas en total (1000=%, 2000=%): el acumulador no esta sumando todos los escenarios', v_n, v_total, v_1000, v_2000;
  END IF;
  RAISE NOTICE 'ok el valor devuelto es la suma de todos los escenarios (% = % filas totales; 1000=%, 2000=%)', v_n, v_total, v_1000, v_2000;
END $$;

-- ─── El advisory lock: existe Y esta ANTES del loop de escenarios ─────
-- El runner busca la cadena advisory_xact_lock en este archivo para decidir
-- si lanza las dos conexiones concurrentes (existencia). Ademas, chequeo
-- ESTATICO de posicion en el texto de la funcion: el lock tiene que
-- aparecer ANTES de "FOR m IN SELECT" (el loop sobre demoras_modelo). Un
-- lock reubicado ADENTRO del loop tomaria/soltaria el lock una vez por
-- escenario -- serializando escenario por escenario, no la corrida entera
-- -- y una corrida solapada podria escribir un estado mezclado (algunos
-- escenarios si, otros no) en vez de rechazarse completa. El test de
-- concurrencia con dos conexiones (mas abajo, a cargo del runner) no puede
-- por si solo distinguir ese defecto de la version correcta cuando la
-- sesion bloqueante cubre TODA la ventana de la corrida -- las dos
-- variantes terminan escribiendo cero filas igual en ese escenario
-- particular. Este chequeo de posicion es el que efectivamente cierra ese
-- hueco.
DO $$
DECLARE v_def text; v_pos_lock int; v_pos_loop int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p WHERE p.proname = 'demoras_calcular_run';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'no existe la funcion demoras_calcular_run';
  END IF;

  v_pos_lock := position('advisory_xact_lock' in v_def);
  IF v_pos_lock = 0 THEN
    RAISE EXCEPTION 'demoras_calcular_run perdio el advisory lock';
  END IF;

  v_pos_loop := position('FOR m IN SELECT' in v_def);
  IF v_pos_loop = 0 THEN
    RAISE EXCEPTION 'demoras_calcular_run perdio el loop sobre demoras_modelo (no se encontro "FOR m IN SELECT" en el texto de la funcion)';
  END IF;

  IF v_pos_lock > v_pos_loop THEN
    RAISE EXCEPTION 'el advisory lock quedo DESPUES del inicio del loop de escenarios: se movio adentro, serializando escenario por escenario en vez de la corrida entera';
  END IF;

  RAISE NOTICE 'ok el lock esta antes del loop de escenarios (posicion % < %), cubre la corrida entera', v_pos_lock, v_pos_loop;
END $$;

-- ─── Limpieza: no ensuciar corridas posteriores en la misma invocacion ──
-- (mismo patron que assert-run-v2.sql / assert-modelo.sql / assert-hueco.sql
-- para el escenario 1000; los escenarios 2000/4000 son exclusivos de este
-- archivo, asi que se borran del todo para no dejar escenarios "fantasma"
-- configurados si Step 5/T7 encadena mas asserts contra el mismo container).
DELETE FROM demoras_modelo WHERE escenario_id IN (2000, 4000);
DELETE FROM demoras_config WHERE escenario_id IN (2000, 4000);
DELETE FROM escenario_settings WHERE escenario_id = 2000;

UPDATE demoras_modelo SET
  suavizado_bypass_cambio_capacidad = false,
  bajada_max = 15,
  modelo = 'CONSUMO_TRAMOS'
 WHERE escenario_id = 1000;
