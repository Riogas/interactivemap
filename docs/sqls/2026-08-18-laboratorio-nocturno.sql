-- ====================================================================
-- Laboratorio de variantes para NOCTURNO (y para cualquier otro tipo)
-- Fecha: 2026-08-18 | Idempotente | Aplicar via pg-meta.
-- ====================================================================
--
-- Pedido de Diego (18/8): "quiero que nos involucremos con nocturnos...
-- que vayas haciendo como en el laboratorio de urgentes calculos y
-- formulas cada noche para llegar a un % alto de acierto <= 25".
--
-- QUE YA ESTABA HECHO (verificado): el motor ya publica NOCTURNO (71
-- zonas, ventana 18:00-23:30) y el laboratorio YA espeja las 25
-- variantes para NOCTURNO en demoras_calculadas_variantes (38.625 filas
-- el 17/8). O sea, el calculo alternativo ya existe.
--
-- EL BLOQUEO REAL: las dos tablas de RESULTADOS no distinguen el tipo de
-- servicio, asi que evaluar NOCTURNO pisaba las filas de URGENTE.
--   * demoras_variantes_resultados: PK (fecha, escenario, variante_id, tolerancia)
--   * demoras_variantes_propuestas: UNIQUE (escenario, huella)
-- Esta migracion agrega tipo_servicio a las dos, corrige las claves, y
-- deja el evaluador y el optimizador parametrizados por tipo.
--
-- Todo lo existente se backfillea como 'URGENTE', que es lo que era.
--
-- CONTEXTO IMPORTANTE PARA QUIEN LEA ESTO DESPUES: el nocturno HOY esta
-- muy mal. Medido 11-17/8 sobre poblacion comun: motor 40,2% vs Despacho
-- 58,2%. Y una promesa CONSTANTE de 35-40 minutos para todos daria 63,5%
-- (66,3% fuera de muestra). O sea que hoy el modelo de cola le RESTA
-- valor al nocturno. Este laboratorio existe para encontrar, con datos,
-- que parametria lo arregla -- o para demostrar que hace falta otro
-- modelo. La vara a superar NO es el motor actual: es el numero fijo.
--
-- ROLLBACK: las columnas tienen DEFAULT 'URGENTE', asi que basta con
-- volver las claves viejas y las funciones anteriores (guardadas en
-- scratchpad/cur-*.sql del 18/8).
-- ====================================================================

-- --- 1. Las tablas de resultados aprenden de que servicio hablan -------
ALTER TABLE demoras_variantes_resultados
  ADD COLUMN IF NOT EXISTS tipo_servicio text NOT NULL DEFAULT 'URGENTE';

ALTER TABLE demoras_variantes_propuestas
  ADD COLUMN IF NOT EXISTS tipo_servicio text NOT NULL DEFAULT 'URGENTE';

ALTER TABLE demoras_variantes_resultados
  DROP CONSTRAINT IF EXISTS demoras_variantes_resultados_pkey;
ALTER TABLE demoras_variantes_resultados
  ADD CONSTRAINT demoras_variantes_resultados_pkey
  PRIMARY KEY (fecha, escenario, tipo_servicio, variante_id, tolerancia);

ALTER TABLE demoras_variantes_propuestas
  DROP CONSTRAINT IF EXISTS demoras_variantes_propuestas_escenario_huella_key;
ALTER TABLE demoras_variantes_propuestas
  DROP CONSTRAINT IF EXISTS demoras_variantes_propuestas_escenario_tipo_huella_key;
ALTER TABLE demoras_variantes_propuestas
  ADD CONSTRAINT demoras_variantes_propuestas_escenario_tipo_huella_key
  UNIQUE (escenario, tipo_servicio, huella);

COMMENT ON COLUMN demoras_variantes_resultados.tipo_servicio IS
  'Servicio evaluado. URGENTE y NOCTURNO se miden por separado: son operaciones distintas y mezclarlas ensucia el ranking.';
COMMENT ON COLUMN demoras_variantes_propuestas.tipo_servicio IS
  'Servicio para el que el optimizador buscó esta combinación.';

-- --- 2. El evaluador escribe el tipo que evaluo ----------------------
CREATE OR REPLACE FUNCTION public.demoras_variantes_evaluar(p_fecha date, p_escenario integer, p_tipo text DEFAULT 'URGENTE'::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_n     integer := 0;
  v_paso  integer;
  t       integer;
BEGIN
  FOREACH t IN ARRAY ARRAY[10, 15, 25] LOOP
    INSERT INTO demoras_variantes_resultados (
      fecha, escenario, tipo_servicio, variante_id, tolerancia, n, le_tol, sesgo, p80,
      despacho_le_tol, motor_le_tol, calculado_at)
    SELECT p_fecha, p_escenario, p_tipo, v.variante_id, t, v.n, v.le_tol, v.sesgo, v.p80,
           v.despacho_le_tol, mot.motor_le_tol, now()
    FROM (
      SELECT dv.variante_id,
             count(*)::integer AS n,
             round(100.0 * count(*) FILTER (WHERE abs(e.real_min - dv.demora_informada) <= t)
                   / nullif(count(*), 0), 2) AS le_tol,
             round(avg(e.real_min - dv.demora_informada)::numeric, 2) AS sesgo,
             round(percentile_cont(0.8) WITHIN GROUP (
                     ORDER BY abs(e.real_min - dv.demora_informada))::numeric, 2) AS p80,
             round(100.0 * count(*) FILTER (WHERE abs(e.d_desp) <= t) / nullif(count(*), 0), 2) AS despacho_le_tol
      FROM (
        SELECT p2.zona_nro AS zona, upper(trim(p2.servicio_nombre)) AS tipo,
               EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0 AS real_min,
               CASE WHEN p2.demora_informada > 0
                    THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                         - p2.demora_informada END AS d_desp,
               mc.corrida_at
        FROM pedidos p2
        LEFT JOIN LATERAL (
          SELECT dc.corrida_at FROM demoras_calculadas dc
          WHERE dc.escenario = p_escenario AND dc.zona_id = p2.zona_nro
            AND dc.tipo_servicio = upper(trim(p2.servicio_nombre))
            AND dc.corrida_at <= p2.fch_hora_para
            AND dc.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
          ORDER BY dc.corrida_at DESC LIMIT 1
        ) mc ON true
        WHERE p2.escenario = p_escenario AND p2.estado_nro = 2 AND p2.sub_estado_nro = 3
          AND coalesce(p2.orden_cancelacion, 'N') <> 'S'
          AND upper(trim(p2.servicio_nombre)) = p_tipo
          AND (p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date = p_fecha
          AND p2.fch_hora_finalizacion IS NOT NULL
          AND NOT (coalesce(p2.fch_hora_asignado, p2.fch_hora_para)
                   + interval '60 minutes' < p2.fch_hora_para)
      ) e
      JOIN demoras_calculadas_variantes dv
        ON dv.escenario = p_escenario AND dv.corrida_at = e.corrida_at
       AND dv.zona_id = e.zona AND dv.tipo_servicio = e.tipo
      WHERE e.d_desp IS NOT NULL AND dv.demora_informada IS NOT NULL
      GROUP BY dv.variante_id
    ) v
    CROSS JOIN LATERAL (
      SELECT round(100.0 * count(*) FILTER (WHERE abs(x.d_mot) <= t) / nullif(count(*), 0), 2) AS motor_le_tol
      FROM (
        SELECT EXTRACT(EPOCH FROM (p3.fch_hora_finalizacion - p3.fch_hora_para)) / 60.0
               - mm.demora_informada AS d_mot
        FROM pedidos p3
        LEFT JOIN LATERAL (
          SELECT dc.demora_informada FROM demoras_calculadas dc
          WHERE dc.escenario = p_escenario AND dc.zona_id = p3.zona_nro
            AND dc.tipo_servicio = upper(trim(p3.servicio_nombre))
            AND dc.corrida_at <= p3.fch_hora_para
            AND dc.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
          ORDER BY dc.corrida_at DESC LIMIT 1
        ) mm ON true
        WHERE p3.escenario = p_escenario AND p3.estado_nro = 2 AND p3.sub_estado_nro = 3
          AND coalesce(p3.orden_cancelacion, 'N') <> 'S'
          AND upper(trim(p3.servicio_nombre)) = p_tipo
          AND (p3.fch_hora_para AT TIME ZONE 'America/Montevideo')::date = p_fecha
          AND p3.fch_hora_finalizacion IS NOT NULL
          AND p3.demora_informada > 0
          AND mm.demora_informada IS NOT NULL
          AND NOT (coalesce(p3.fch_hora_asignado, p3.fch_hora_para)
                   + interval '60 minutes' < p3.fch_hora_para)
      ) x
    ) mot
    ON CONFLICT (fecha, escenario, tipo_servicio, variante_id, tolerancia) DO UPDATE SET
      n = EXCLUDED.n, le_tol = EXCLUDED.le_tol, sesgo = EXCLUDED.sesgo, p80 = EXCLUDED.p80,
      despacho_le_tol = EXCLUDED.despacho_le_tol, motor_le_tol = EXCLUDED.motor_le_tol,
      calculado_at = EXCLUDED.calculado_at;

    -- OJO: en una variable propia. Reusar `t` (la tolerancia) para el
    -- ROW_COUNT rompia el FOREACH en silencio.
    GET DIAGNOSTICS v_paso = ROW_COUNT;
    v_n := v_n + v_paso;
  END LOOP;

  RETURN v_n;
END;
$function$;

-- --- 3. El optimizador busca por tipo --------------------------------
-- OJO: agregar un parametro con DEFAULT NO reemplaza, crea una SEGUNDA
-- funcion y las llamadas quedan ambiguas (42725). Hay que DROP explicito.
DROP FUNCTION IF EXISTS demoras_variantes_optimizar(integer, integer, numeric);

CREATE OR REPLACE FUNCTION public.demoras_variantes_optimizar(p_escenario integer, p_dias integer DEFAULT 7, p_tolerancia numeric DEFAULT 25, p_tipo text DEFAULT 'URGENTE'::text)
 RETURNS TABLE(propuestas integer, evaluaciones integer, mejor jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_hasta   date;
  v_train_h date;
  v_train_d date;
  base      jsonb;
  mejor_p   jsonb;
  cand      jsonb;
  eje       record;
  val       jsonb;
  m         record;
  best_le   numeric;
  base_le   numeric;
  v_eval    integer := 0;
  v_prop    integer := 0;
  v_huella  text;
  v_var     smallint;
  v_nuevo   smallint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(2180637409::bigint + hashtext(p_tipo)) THEN
    RETURN;
  END IF;

  -- Validacion = el ultimo dia con datos; entrenamiento = los previos.
  SELECT max(fecha_local) INTO v_hasta FROM demoras_corrida_meta WHERE escenario = p_escenario;
  IF v_hasta IS NULL THEN RETURN; END IF;
  v_train_h := v_hasta - 1;
  v_train_d := GREATEST(v_train_h - (p_dias - 1),
                        (SELECT min(fecha_local) FROM demoras_corrida_meta WHERE escenario = p_escenario));
  IF v_train_d > v_train_h THEN RETURN; END IF;

  -- El punto de partida es el campeon (la parametria vigente).
  base := '{}'::jsonb;
  SELECT le_tol INTO base_le
    FROM demoras_evaluar_perillas(p_escenario, v_train_d, v_train_h, base, p_tolerancia, p_tipo);
  v_eval := v_eval + 1;
  mejor_p := base;

  -- Un eje por vez. Las grillas cubren el rango razonable de cada
  -- perilla; los extremos estan puestos a proposito para que el
  -- optimizador pueda decir "por aca no".
  FOR eje IN
    SELECT * FROM (VALUES
      ('factor_calibracion', ARRAY['0.70','0.75','0.80','0.85','0.90','0.95','1.00','1.05']),
      ('escalon_minutos',    ARRAY['5','10','15']),
      ('min_minutos',        ARRAY['15','20','25','30','35']),
      ('subida_max',         ARRAY['10','15','30','45']),
      ('estadistico',        ARRAY['"MEDIANA"','"MEDIA"','"P75"','"P90"']),
      ('nivel_ritmo',        ARRAY['"CASCADA"','"ZONA"','"MOVIL"']),
      ('recargo_factor',     ARRAY['0.50','0.60','0.70','0.85','1.00']),
      ('peso_carga_otro',    ARRAY['0','0.5','1.0'])
    ) AS t(perilla, valores)
  LOOP
    best_le := base_le;
    FOREACH v_huella IN ARRAY eje.valores LOOP
      cand := base || jsonb_build_object(eje.perilla, v_huella::jsonb);
      -- subida y bajada se mueven juntas: es "la escalera", no dos.
      IF eje.perilla = 'subida_max' THEN
        cand := cand || jsonb_build_object('bajada_max', v_huella::jsonb);
      END IF;

      SELECT * INTO m FROM demoras_evaluar_perillas(
        p_escenario, v_train_d, v_train_h, cand, p_tolerancia, p_tipo);
      v_eval := v_eval + 1;

      IF m.le_tol IS NOT NULL AND m.le_tol > coalesce(best_le, -1) THEN
        best_le := m.le_tol;
        mejor_p := mejor_p || (cand - ARRAY(SELECT jsonb_object_keys(base)));
      END IF;
    END LOOP;
  END LOOP;

  -- El combo de los mejores ejes, que puede ser mejor (o peor: los ejes
  -- no son del todo independientes) que cada uno por separado.
  FOR cand IN SELECT unnest(ARRAY[mejor_p]) LOOP
    v_huella := md5(cand::text);
    CONTINUE WHEN EXISTS (SELECT 1 FROM demoras_variantes_propuestas
                           WHERE escenario = p_escenario AND tipo_servicio = p_tipo
                             AND huella = v_huella);
    CONTINUE WHEN cand = '{}'::jsonb;

    -- Entrenamiento y VALIDACION en el dia que no vio.
    SELECT * INTO m FROM demoras_evaluar_perillas(
      p_escenario, v_train_d, v_train_h, cand, p_tolerancia, p_tipo);
    v_eval := v_eval + 1;

    INSERT INTO demoras_variantes_propuestas (
      escenario, tipo_servicio, perillas, huella, train_desde, train_hasta, train_le_tol, train_n)
    VALUES (p_escenario, p_tipo, cand, v_huella, v_train_d, v_train_h, m.le_tol, m.n)
    RETURNING id INTO v_var;

    SELECT * INTO m FROM demoras_evaluar_perillas(
      p_escenario, v_hasta, v_hasta, cand, p_tolerancia, p_tipo);
    v_eval := v_eval + 1;

    UPDATE demoras_variantes_propuestas
       SET valida_fecha = v_hasta, valida_le_tol = m.le_tol, valida_n = m.n,
           despacho_le_tol = m.despacho_le_tol
     WHERE id = v_var;

    -- Solo entra al catalogo si TAMBIEN gano en el dia de validacion.
    IF m.le_tol IS NOT NULL AND m.despacho_le_tol IS NOT NULL
       AND m.le_tol > m.despacho_le_tol THEN
      SELECT coalesce(max(id), 0) + 1 INTO v_nuevo FROM demoras_variantes;
      INSERT INTO demoras_variantes (
        id, codigo, nombre, descripcion, estadistico, nivel_ritmo, factor,
        escalon_minutos, suavizado, suavizado_paso, min_minutos, activa,
        recargo_factor, peso_carga_otro)
      VALUES (
        v_nuevo,
        CASE WHEN p_tipo = 'URGENTE' THEN 'AUTO_' ELSE 'AUTO' || left(p_tipo,1) || '_' END || v_nuevo,
        'Propuesta automática #' || v_nuevo || ' (' || p_tipo || ')',
        'La encontró el optimizador el ' || v_hasta || ' optimizando ' || p_tipo || ' sobre los días '
          || v_train_d || ' a ' || v_train_h || '. En entrenamiento y en el día de validación '
          || '(que no vio) le ganó al Despacho. Todavía tiene que cumplir la regla de promoción.',
        cand->>'estadistico', cand->>'nivel_ritmo',
        (cand->>'factor_calibracion')::numeric, (cand->>'escalon_minutos')::smallint,
        coalesce((cand->>'suavizado')::boolean, true),
        (cand->>'subida_max')::smallint, (cand->>'min_minutos')::smallint, true,
        (cand->>'recargo_factor')::numeric, (cand->>'peso_carga_otro')::numeric);

      UPDATE demoras_variantes_propuestas SET variante_id = v_nuevo WHERE id = v_var;
      v_prop := v_prop + 1;
    END IF;
  END LOOP;

  propuestas   := v_prop;
  evaluaciones := v_eval;
  mejor        := mejor_p;
  RETURN NEXT;
END;
$function$;
