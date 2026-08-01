\set ON_ERROR_STOP on
-- =====================================================================
-- Version relativa, no absoluta (fix Task 7, tanda CONSUMO_TRAMOS).
--
-- Hasta la tanda anterior, este archivo asumia que demoras_modelo llegaba
-- "virgen" (version=1, modelo='PROXIMO_HUECO'): nada la habia tocado antes.
-- Desde que 2026-08-01-demoras-modelo-tramos.sql existe, la cadena real de
-- aplicacion (la que arma el archivo unico) hace un UPDATE real sobre esa
-- misma fila ANTES de que este assert corra (normaliza PROXIMO_HUECO ->
-- CONSUMO_TRAMOS), y el trigger de versionado bumpea version a 2 y deja 1
-- fila en el historial -- version=1/historial=0 hardcodeados dejaban de ser
-- ciertos y el bloque 1 fallaba con "version inicial: 2 (esperaba 1)" en
-- CUALQUIER corrida de la regresion completa. La version del defecto:
-- version/historial se CAPTURAN al empezar cada bloque y los checks
-- siguientes son DELTAS contra esa captura -- mismo patron que ya usa el
-- bloque 5 de assert-modelo-tramos.sql (v0/v1), que por eso nunca se rompio.
-- =====================================================================

-- 1) La fila del escenario 1000 existe con los defaults del diseno.
-- 'modelo' default paso de PROXIMO_HUECO a CONSUMO_TRAMOS en la tanda de
-- consumo por tramos (ALTER COLUMN ... SET DEFAULT en
-- 2026-08-01-demoras-modelo-tramos.sql) -- es el default vigente, no un
-- artefacto de orden de cadena.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = 1000;
  IF NOT FOUND THEN RAISE EXCEPTION 'falta la fila del escenario 1000'; END IF;
  IF m.version IS NULL OR m.version < 1 THEN RAISE EXCEPTION 'version invalida: %', m.version; END IF;
  IF m.modelo IS DISTINCT FROM 'CONSUMO_TRAMOS' THEN RAISE EXCEPTION 'modelo: %', m.modelo; END IF;
  IF m.ritmo_metrica IS DISTINCT FROM 'ENTRE_ENTREGAS' THEN RAISE EXCEPTION 'ritmo_metrica: %', m.ritmo_metrica; END IF;
  IF m.ritmo_dias_ventana IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'ritmo_dias_ventana: %', m.ritmo_dias_ventana; END IF;
  IF m.ritmo_min_muestras IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'ritmo_min_muestras: %', m.ritmo_min_muestras; END IF;
  RAISE NOTICE 'ok seed con defaults (version=%, modelo=%)', m.version, m.modelo;
END $$;

-- 2) Un UPDATE real versiona: bump de version + fila anterior al historial.
DO $$
DECLARE v_before integer; v_ver integer; v_hist_before integer; v_hist integer; v_old text;
BEGIN
  SELECT version INTO v_before FROM demoras_modelo WHERE escenario_id = 1000;
  SELECT count(*) INTO v_hist_before FROM demoras_modelo_historial WHERE escenario_id = 1000;

  UPDATE demoras_modelo SET estadistico = 'P90', updated_by = 'tester' WHERE escenario_id = 1000;

  SELECT version INTO v_ver FROM demoras_modelo WHERE escenario_id = 1000;
  IF v_ver IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION 'version tras update: % (esperaba %)', v_ver, v_before + 1;
  END IF;

  SELECT count(*) INTO v_hist FROM demoras_modelo_historial WHERE escenario_id = 1000;
  IF v_hist IS DISTINCT FROM v_hist_before + 1 THEN
    RAISE EXCEPTION 'filas de historial: % (esperaba %)', v_hist, v_hist_before + 1;
  END IF;

  SELECT fila->>'estadistico' INTO v_old
    FROM demoras_modelo_historial WHERE escenario_id = 1000 AND version = v_before;
  IF v_old IS DISTINCT FROM 'MEDIANA' THEN
    RAISE EXCEPTION 'el historial guardo el valor NUEVO (%), tiene que guardar el ANTERIOR', v_old;
  END IF;
  RAISE NOTICE 'ok versionado (version % -> %)', v_before, v_ver;
END $$;

-- 3) Un UPDATE que no cambia nada NO versiona (si no, tocar la pantalla
--    sin editar infla el historial y rompe la trazabilidad).
DO $$
DECLARE v_before integer; v_ver integer; v_hist_before integer; v_hist integer;
BEGIN
  SELECT version INTO v_before FROM demoras_modelo WHERE escenario_id = 1000;
  SELECT count(*) INTO v_hist_before FROM demoras_modelo_historial WHERE escenario_id = 1000;

  UPDATE demoras_modelo SET estadistico = 'P90' WHERE escenario_id = 1000;

  SELECT version INTO v_ver FROM demoras_modelo WHERE escenario_id = 1000;
  SELECT count(*) INTO v_hist FROM demoras_modelo_historial WHERE escenario_id = 1000;
  IF v_ver IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'update sin cambios versiono: % -> %', v_before, v_ver; END IF;
  IF v_hist IS DISTINCT FROM v_hist_before THEN RAISE EXCEPTION 'update sin cambios escribio historial: % -> %', v_hist_before, v_hist; END IF;
  RAISE NOTICE 'ok update inocuo no versiona';
END $$;

-- 4) Los CHECK rechazan basura.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET modelo = 'FRUTA' WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un modelo invalido';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET max_minutos = 10, min_minutos = 30 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto max < min';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET ritmo_dias_ventana = 0 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto una ventana de 0 dias';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'ok constraints';
END $$;

-- 5) La anon key del browser no puede leer ni escribir la config del motor.
DO $$
BEGIN
  IF has_table_privilege('anon','demoras_modelo','SELECT') THEN RAISE EXCEPTION 'anon puede leer demoras_modelo'; END IF;
  IF has_table_privilege('anon','demoras_modelo','UPDATE') THEN RAISE EXCEPTION 'anon puede escribir demoras_modelo'; END IF;
  IF has_table_privilege('authenticated','demoras_modelo','UPDATE') THEN RAISE EXCEPTION 'authenticated puede escribir demoras_modelo'; END IF;
  IF has_table_privilege('anon','demoras_modelo_historial','SELECT') THEN RAISE EXCEPTION 'anon puede leer el historial'; END IF;
  RAISE NOTICE 'ok grants';
END $$;

-- 6) demoras_calculadas tiene el sello de version.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='demoras_calculadas' AND column_name='modelo_version') THEN
    RAISE EXCEPTION 'falta demoras_calculadas.modelo_version';
  END IF;
  RAISE NOTICE 'ok sello de version';
END $$;

-- Restaurar para no ensuciar asserts posteriores en la misma invocacion.
UPDATE demoras_modelo SET estadistico = 'MEDIANA', min_minutos = 30, max_minutos = 120
 WHERE escenario_id = 1000;
