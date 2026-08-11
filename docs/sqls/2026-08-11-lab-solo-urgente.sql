-- ════════════════════════════════════════════════════════════════════
-- El laboratorio mide SOLO servicio URGENTE                2026-08-11
-- ════════════════════════════════════════════════════════════════════
--
-- Por que
-- -------
-- Hasta hoy el evaluador nocturno y el scoreboard de pantalla median
-- URGENTE + NOCTURNO juntos. Son dos operaciones distintas:
--
--   * URGENTE  se toma de 8 a 20, muchos moviles, colas cortas por movil.
--     El modelo de cola (cola por delante x ritmo) describe bien esa
--     realidad: sesgo del motor -3,5 minutos sobre 16.000 pedidos.
--
--   * NOCTURNO se toma de 20 a 22 (99% de los casos), quedan ~23 moviles
--     de los 93 del dia y cada uno lleva 3 pedidos arriba: no los sirve
--     de a uno, hace UNA VUELTA con todo cargado. El modelo lineal cobra
--     tres veces el ritmo y se pasa: sesgo -26 minutos, 20,7 puntos por
--     debajo del Despacho.
--
-- Con el 5% del volumen, el nocturno arrastraba el resultado global de
-- +2,9 a +1,8 puntos y, peor, ensuciaba la vara con la que se decide
-- promover una variante al motor.
--
-- Que cambia
-- ----------
--   1. demoras_variantes_evaluar  -> nuevo parametro p_tipo (default
--      'URGENTE'). El job nocturno lo llama con 2 argumentos, asi que
--      toma el default. Deja la puerta abierta a medir NOCTURNO aparte.
--   2. metricas_variantes_scoreboard -> el `tipo` del payload ahora
--      default 'URGENTE' en vez de "los dos juntos".
--
-- Que NO cambia
-- -------------
--   * El motor sigue calculando y publicando para todos los servicios.
--     Esto es la capa de MEDICION, no la de calculo.
--   * demoras_evaluar_perillas (la que usa el optimizador) ya tenia
--     p_tipo DEFAULT 'URGENTE': el optimizador venia midiendo bien.
--
-- Ojo con el DROP
-- ---------------
-- CREATE OR REPLACE con un parametro nuevo NO reemplaza: crea una
-- SEGUNDA funcion y toda llamada de 2 argumentos queda ambigua (42725).
-- Ya paso tres veces en este proyecto. Por eso el DROP explicito.
--
-- Despues de aplicar hay que recalcular los dias ya evaluados:
--   SELECT demoras_variantes_evaluar(d, 1000)
--     FROM generate_series('2026-08-07'::date, '2026-08-10'::date, '1 day') g(d);
-- (el INSERT es ON CONFLICT DO UPDATE, pisa lo viejo)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. El evaluador nocturno ────────────────────────────────────────
DROP FUNCTION IF EXISTS demoras_variantes_evaluar(date, integer);

CREATE FUNCTION demoras_variantes_evaluar(
  p_fecha date, p_escenario integer, p_tipo text DEFAULT 'URGENTE')
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
      fecha, escenario, variante_id, tolerancia, n, le_tol, sesgo, p80,
      despacho_le_tol, motor_le_tol, calculado_at)
    SELECT p_fecha, p_escenario, v.variante_id, t, v.n, v.le_tol, v.sesgo, v.p80,
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
    ON CONFLICT (fecha, escenario, variante_id, tolerancia) DO UPDATE SET
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

COMMENT ON FUNCTION demoras_variantes_evaluar(date, integer, text) IS
  'Cierra un dia: persiste en demoras_variantes_resultados cuanto acerto cada variante en cada tolerancia, con su sesgo y p80, contra el Despacho y contra el motor real. Mide SOLO p_tipo (por defecto URGENTE).';

-- ─── 2. El scoreboard de la pantalla ─────────────────────────────────

CREATE OR REPLACE FUNCTION metricas_variantes_scoreboard(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc            integer;
  v_tipo           text;
  v_desde          date;
  v_hasta          date;
  v_tol            numeric;
  v_ini            timestamptz;
  v_fin            timestamptz;
  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;
  v_result         jsonb;

  MIN_N_DIA CONSTANT integer := 20;

  EMPTY_PAYLOAD CONSTANT jsonb := jsonb_build_object(
    'desde', null, 'hasta', null, 'tolerancia', null, 'min_n_dia', null,
    'desde_datos', null, 'campeon_ok', null, 'desfase', null,
    'despacho', null, 'motor', null, 'variantes', '[]'::jsonb
  );
BEGIN
  v_esc  := (p->>'escenario')::integer;
  -- 2026-08-11: la vara del laboratorio es URGENTE. Nocturno es otra
  -- operacion (un movil carga varios pedidos y hace una vuelta) y el
  -- modelo de cola no le sirve; mezclarlo ensuciaba el ranking. Se puede
  -- pedir NOCTURNO explicito, pero por defecto NO entra.
  v_tipo := coalesce(nullif(p->>'tipo', ''), 'URGENTE');
  IF v_tipo NOT IN ('URGENTE', 'NOCTURNO') THEN
    v_tipo := 'URGENTE';
  END IF;

  v_hasta := coalesce(nullif(p->>'hasta', '')::date,
                      (now() AT TIME ZONE 'America/Montevideo')::date);
  v_desde := coalesce(nullif(p->>'desde', '')::date, v_hasta - 6);
  IF v_desde > v_hasta THEN v_desde := v_hasta; END IF;

  v_tol := least(60, greatest(5, coalesce(nullif(p->>'tolerancia','')::numeric, 25)));

  v_ini := v_desde::timestamp AT TIME ZONE 'America/Montevideo';
  v_fin := (v_hasta + 1)::timestamp AT TIME ZONE 'America/Montevideo';

  v_empresas_type := jsonb_typeof(p->'empresas');
  IF v_empresas_type IS NULL OR v_empresas_type = 'null' THEN
    v_empresas := NULL;
  ELSIF v_empresas_type = 'array' THEN
    IF jsonb_array_length(p->'empresas') = 0 THEN
      v_empresas_empty := true;
    ELSE
      SELECT array_agg(x::int) INTO v_empresas FROM jsonb_array_elements_text(p->'empresas') AS x;
    END IF;
  END IF;
  IF v_empresas_empty THEN RETURN EMPTY_PAYLOAD; END IF;

  WITH ent AS MATERIALIZED (
    -- Entregas del rango, con la promesa del Despacho, la corrida del
    -- motor vigente a la toma y la promesa del motor. El dia del pedido
    -- es el de la TOMA (fch_hora_para): a ese dia pertenecen su corrida
    -- y su promesa.
    SELECT p2.zona_nro AS zona,
           upper(trim(p2.servicio_nombre)) AS tipo,
           (p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date AS fecha,
           EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0 AS real_min,
           CASE WHEN p2.demora_informada > 0
                THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                     - p2.demora_informada
           END AS d_desp,
           mc.corrida_at,
           CASE WHEN mc.demora_informada IS NOT NULL
                THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                     - mc.demora_informada
           END AS d_mot
    FROM pedidos p2
    LEFT JOIN LATERAL (
      SELECT dc.corrida_at, dc.demora_informada
      FROM demoras_calculadas dc
      WHERE dc.escenario = v_esc AND dc.zona_id = p2.zona_nro
        AND dc.tipo_servicio = upper(trim(p2.servicio_nombre))
        AND dc.corrida_at <= p2.fch_hora_para
        AND dc.corrida_at >= ((p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date::timestamp
                              AT TIME ZONE 'America/Montevideo')
      ORDER BY dc.corrida_at DESC LIMIT 1
    ) mc ON true
    WHERE p2.escenario = v_esc
      AND p2.estado_nro = 2 AND p2.sub_estado_nro = 3
      AND coalesce(p2.orden_cancelacion, 'N') <> 'S'
      AND upper(trim(p2.servicio_nombre)) = v_tipo
      AND p2.fch_hora_para >= v_ini AND p2.fch_hora_para < v_fin
      AND p2.fch_hora_finalizacion IS NOT NULL
      AND NOT (coalesce(p2.fch_hora_asignado, p2.fch_hora_para)
               + interval '60 minutes' < p2.fch_hora_para)
      AND (v_empresas IS NULL OR p2.empresa_fletera_id = ANY(v_empresas))
  ),
  -- EL UNIVERSO COMPARABLE. El laboratorio arranco el 7/8/2026, asi que
  -- de un rango de 7 dias puede tener promesas para 2. Medir al motor
  -- sobre los 7 y a las variantes sobre los 2 haria que TODAS las
  -- variantes "le ganen al motor" por puro artefacto del rango (visto
  -- el 7/8: motor 55,3% sobre 12.761 pedidos contra 72,3% del CAMPEON
  -- -- que es el mismo calculo -- sobre 1.423). Asi que el motor y el
  -- Despacho se miden sobre EXACTAMENTE los pedidos que tienen promesa
  -- del laboratorio.
  cubiertos AS MATERIALIZED (
    SELECT e.*
    FROM ent e
    WHERE e.corrida_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM demoras_calculadas_variantes dv
        WHERE dv.corrida_at = e.corrida_at AND dv.escenario = v_esc
          AND dv.zona_id = e.zona AND dv.tipo_servicio = e.tipo
      )
  ),
  -- La promesa de CADA variante para cada pedido: mismo corrida_at que
  -- el motor (las variantes se calculan en las mismas corridas).
  vp AS MATERIALIZED (
    SELECT e.fecha, e.zona, e.tipo, e.real_min, e.d_desp,
           dv.variante_id,
           e.real_min - dv.demora_informada AS d_var
    FROM cubiertos e
    JOIN demoras_calculadas_variantes dv
      ON dv.corrida_at = e.corrida_at AND dv.escenario = v_esc
     AND dv.zona_id = e.zona AND dv.tipo_servicio = e.tipo
    WHERE e.d_desp IS NOT NULL
      AND dv.demora_informada IS NOT NULL
  ),
  var_dia AS (
    SELECT variante_id, fecha,
           count(*)::int AS n,
           round(100.0 * count(*) FILTER (WHERE abs(d_var)  <= v_tol) / count(*), 1) AS le_tol,
           round(100.0 * count(*) FILTER (WHERE abs(d_desp) <= v_tol) / count(*), 1) AS despacho_le_tol,
           round(avg(d_var)::numeric, 1) AS sesgo
    FROM vp
    GROUP BY variante_id, fecha
  ),
  var_tot AS (
    SELECT variante_id,
           count(*) FILTER (WHERE n >= MIN_N_DIA)::int            AS dias_total,
           count(*) FILTER (WHERE n >= MIN_N_DIA AND le_tol > despacho_le_tol)::int AS dias_ganados
    FROM var_dia
    GROUP BY variante_id
  ),
  var_tot_fino AS (
    SELECT variante_id,
           count(*)::int AS n,
           round(100.0 * count(*) FILTER (WHERE abs(d_var) <= v_tol) / count(*), 1) AS le_tol,
           round(avg(d_var)::numeric, 1) AS sesgo
    FROM vp
    GROUP BY variante_id
  ),
  var_dias_json AS (
    SELECT variante_id,
           jsonb_agg(jsonb_build_object(
             'fecha', fecha, 'n', n, 'le_tol', le_tol,
             'despacho_le_tol', despacho_le_tol,
             'gana', CASE WHEN n >= MIN_N_DIA THEN le_tol > despacho_le_tol END
           ) ORDER BY fecha) AS dias
    FROM var_dia
    GROUP BY variante_id
  ),
  variantes_json AS (
    SELECT jsonb_agg(jsonb_build_object(
             'id', c.id, 'codigo', c.codigo, 'nombre', c.nombre,
             'descripcion', c.descripcion, 'activa', c.activa,
             'knobs', jsonb_build_object(
               'estadistico', c.estadistico, 'nivel_ritmo', c.nivel_ritmo,
               'factor', c.factor, 'escalon_minutos', c.escalon_minutos,
               'suavizado', c.suavizado, 'suavizado_paso', c.suavizado_paso,
               'min_minutos', c.min_minutos),
             'n', coalesce(f.n, 0), 'le_tol', f.le_tol, 'sesgo', f.sesgo,
             'dias_ganados', coalesce(t.dias_ganados, 0),
             'dias_total',   coalesce(t.dias_total, 0),
             'dias', coalesce(dj.dias, '[]'::jsonb)
           ) ORDER BY f.le_tol DESC NULLS LAST, c.id) AS lista
    FROM demoras_variantes c
    LEFT JOIN var_tot       t  ON t.variante_id  = c.id
    LEFT JOIN var_tot_fino  f  ON f.variante_id  = c.id
    LEFT JOIN var_dias_json dj ON dj.variante_id = c.id
    WHERE c.activa
  ),
  -- El motor REAL (lo publicado) y el Despacho, sobre el MISMO universo
  -- que las variantes (ver el comentario de `cubiertos`).
  motor_comun AS (
    SELECT * FROM cubiertos WHERE d_desp IS NOT NULL AND d_mot IS NOT NULL
  ),
  motor_dia_json AS (
    SELECT jsonb_agg(jsonb_build_object('fecha', fecha, 'n', n, 'le_tol', le_tol) ORDER BY fecha) AS dias
    FROM (
      SELECT fecha, count(*)::int AS n,
             round(100.0 * count(*) FILTER (WHERE abs(d_mot) <= v_tol) / count(*), 1) AS le_tol
      FROM motor_comun GROUP BY fecha
    ) x
  ),
  campeon AS (
    SELECT id FROM demoras_variantes WHERE codigo = 'CAMPEON' LIMIT 1
  ),
  campeon_ok AS (
    SELECT count(*)::int AS corridas,
           count(*) FILTER (WHERE dc.demora_informada = dv.demora_informada)::int AS coincidencias
    FROM demoras_calculadas dc
    JOIN demoras_calculadas_variantes dv
      ON dv.corrida_at = dc.corrida_at AND dv.escenario = dc.escenario
     AND dv.zona_id = dc.zona_id AND dv.tipo_servicio = dc.tipo_servicio
     AND dv.variante_id = (SELECT id FROM campeon)
    WHERE dc.escenario = v_esc
      AND dc.corrida_at >= v_ini AND dc.corrida_at < v_fin
  )
  SELECT jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'tolerancia', v_tol,
    'min_n_dia', MIN_N_DIA,
    'desde_datos', (SELECT (min(corrida_at) AT TIME ZONE 'America/Montevideo')::date
                    FROM demoras_calculadas_variantes WHERE escenario = v_esc),
    'campeon_ok', (SELECT CASE WHEN corridas > 0 THEN jsonb_build_object(
                     'corridas', corridas, 'coincidencias', coincidencias,
                     'pct', round(100.0 * coincidencias / corridas, 1)) END
                   FROM campeon_ok),
    -- Cuanto tardo el laboratorio en espejar cada corrida. Importa
    -- porque las variantes que re-simulan el ritmo necesitan el estado
    -- del mundo del momento: un desfase de segundos es fiel, uno de
    -- horas seria una reconstruccion inventada (por eso el backfill no
    -- lo permite; esto lo deja a la vista igual).
    'desfase', (SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
                  'mediana_seg', round(percentile_cont(0.5) WITHIN GROUP (
                                   ORDER BY EXTRACT(EPOCH FROM (calculado_at - corrida_at)))::numeric, 1),
                  'max_seg', round(max(EXTRACT(EPOCH FROM (calculado_at - corrida_at)))::numeric, 1)) END
                FROM demoras_calculadas_variantes
                WHERE escenario = v_esc AND corrida_at >= v_ini AND corrida_at < v_fin),
    'despacho', (SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
                   'n', count(*)::int,
                   'le_tol', round(100.0 * count(*) FILTER (WHERE abs(d_desp) <= v_tol) / count(*), 1),
                   'sesgo', round(avg(d_desp)::numeric, 1)) END
                 FROM motor_comun),
    'motor', (SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
                'n', count(*)::int,
                'le_tol', round(100.0 * count(*) FILTER (WHERE abs(d_mot) <= v_tol) / count(*), 1),
                'sesgo', round(avg(d_mot)::numeric, 1),
                'dias', coalesce((SELECT dias FROM motor_dia_json), '[]'::jsonb)) END
              FROM motor_comun),
    'variantes', coalesce((SELECT lista FROM variantes_json), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION metricas_variantes_scoreboard(jsonb) IS
  'Ranking del laboratorio de variantes: que hubiera publicado cada configuracion alternativa vs lo que paso de verdad, por dia y acumulado, contra el Despacho y contra el motor real. Incluye el control de sanidad campeon_ok (CAMPEON debe = motor). Alimenta la card Laboratorio de variantes. Ver docs/sqls/2026-08-07-variantes-scoreboard.sql.';

-- Los roles de Supabase pueden no existir en un Postgres pelado (harness
-- local, restore en otra VM): REVOKE/GRANT sobre un rol inexistente es un
-- error duro (42704), no un no-op, y rompe la idempotencia del archivo.
REVOKE EXECUTE ON FUNCTION metricas_variantes_scoreboard(jsonb) FROM PUBLIC;
DO $do$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION metricas_variantes_scoreboard(jsonb) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION metricas_variantes_scoreboard(jsonb) TO service_role;
  END IF;
END
$do$;
