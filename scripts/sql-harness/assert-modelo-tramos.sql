\set ON_ERROR_STOP on

-- 1) Los cuatro parametros nuevos existen con sus defaults.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = 1000;
  IF m.dedicacion_transito           IS DISTINCT FROM 0.20 THEN RAISE EXCEPTION 'dedicacion_transito: %', m.dedicacion_transito; END IF;
  IF m.transito_dedicacion_max_total IS DISTINCT FROM 0.60 THEN RAISE EXCEPTION 'transito_max_total: %', m.transito_dedicacion_max_total; END IF;
  IF m.traslado_fuera_zona_minutos   IS DISTINCT FROM 15   THEN RAISE EXCEPTION 'traslado: %', m.traslado_fuera_zona_minutos; END IF;
  IF m.ritmo_hueco_min_minutos       IS DISTINCT FROM 5    THEN RAISE EXCEPTION 'hueco_min: %', m.ritmo_hueco_min_minutos; END IF;
  IF m.modelo IS DISTINCT FROM 'CONSUMO_TRAMOS' THEN RAISE EXCEPTION 'modelo: %', m.modelo; END IF;
  RAISE NOTICE 'ok parametros nuevos con sus defaults';
END $$;

-- 2) PROXIMO_HUECO ya no es un valor valido: el CHECK lo rechaza.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto PROXIMO_HUECO, que fue retirado';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- CAPACIDAD_PROMEDIO si sigue siendo valido: es contra lo que se compara.
  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS'     WHERE escenario_id = 1000;
  RAISE NOTICE 'ok el CHECK de modelo';
END $$;

-- 3) Los CHECK de los parametros nuevos rechazan basura.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET dedicacion_transito = 1.5 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto una dedicacion mayor a 1';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET transito_dedicacion_max_total = -0.1 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un tope negativo';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET traslado_fuera_zona_minutos = -5 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un traslado negativo';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- El piso del ritmo TIENE que ser menor que el techo, o no queda ninguna
  -- muestra viva y todas las zonas caen al ritmo por defecto en silencio.
  BEGIN
    UPDATE demoras_modelo SET ritmo_hueco_min_minutos = 200 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un piso del ritmo mayor que el techo (90)';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'ok constraints de los parametros nuevos';
END $$;

-- 4) Los tres parametros de transito_modo se dieron de baja.
DO $$
DECLARE v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['transito_modo','transito_castigo_minutos','transito_margen_minutos'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'demoras_modelo' AND column_name = v_col) THEN
      RAISE EXCEPTION 'demoras_modelo todavia tiene %', v_col;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok los transito_* se dieron de baja';
END $$;

-- 5) El versionado sigue andando sobre las columnas nuevas.
DO $$
DECLARE v0 integer; v1 integer;
BEGIN
  SELECT version INTO v0 FROM demoras_modelo WHERE escenario_id = 1000;
  UPDATE demoras_modelo SET dedicacion_transito = 0.25 WHERE escenario_id = 1000;
  SELECT version INTO v1 FROM demoras_modelo WHERE escenario_id = 1000;
  IF v1 <> v0 + 1 THEN RAISE EXCEPTION 'el trigger no versiono un cambio de parametro nuevo'; END IF;
  IF (SELECT (fila->>'dedicacion_transito')::numeric FROM demoras_modelo_historial
       WHERE escenario_id = 1000 AND version = v0) IS DISTINCT FROM 0.20 THEN
    RAISE EXCEPTION 'el historial no guardo el valor anterior del parametro nuevo';
  END IF;
  UPDATE demoras_modelo SET dedicacion_transito = 0.20 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok versionado sobre los parametros nuevos';
END $$;
