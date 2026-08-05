-- =====================================================================
-- RPC metricas_desfasaje_analisis: el analisis del informe, vivo
-- Fecha: 2026-08-05 | Idempotente | Requiere: 2026-08-03-desfasaje-demoras
--
-- Lleva a la app (card "Analisis del acierto") las aperturas que el
-- usuario pidio tener con datos reales y filtro por dia:
--   por_dia  : poblacion COMUN por fecha — Despacho vs motor <=25' y p80
--              (la tabla del "recalculo de la semana", pero con lo
--              realmente publicado; desde el 5/8 el motor publicado ES la
--              parametria nueva completa).
--   por_hora : % tarde >=30', sesgo (mediana CON signo) y p80 |desf| por
--              hora de la toma — "cuando falla".
--   por_zona : las peores zonas (n >= min_zona) por p80 — "donde falla".
--   peores   : los N incumplimientos mas gruesos (desfasaje positivo).
--
-- p: { escenario (req), desde?, hasta? (default: ultimos 30 dias con
--      dato), tipo? (URGENTE|NOCTURNO; ausente = ambos),
--      empresas?: int[] (fail-closed: [] = payload vacio),
--      fuente? ('informada'|'calculada', default 'informada') — que
--      proyeccion se autopsia en por_hora/por_zona/peores (por_dia
--      siempre compara las dos sobre la poblacion comun),
--      fecha? (YYYY-MM-DD) — filtra por_hora/por_zona/peores a UN dia
--      (por_dia ignora el filtro: es el indice de dias),
--      min_zona? (int) — umbral de pedidos por zona (default 30 sin
--      fecha, 10 con fecha; parametrizable tambien para los asserts). }
-- =====================================================================

CREATE OR REPLACE FUNCTION metricas_desfasaje_analisis(p jsonb)
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
  v_max            date;
  v_fuente         text;
  v_fecha          date;
  v_min_zona       integer;
  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;
  v_result         jsonb;

  EMPTY_PAYLOAD CONSTANT jsonb := jsonb_build_object(
    'rango', null, 'fuente', null, 'fecha', null, 'diagnostico', null,
    'por_dia', '[]'::jsonb, 'por_hora', '[]'::jsonb,
    'por_zona', '[]'::jsonb, 'peores', '[]'::jsonb
  );
BEGIN
  v_esc  := (p->>'escenario')::integer;
  v_tipo := nullif(p->>'tipo', '');
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('URGENTE', 'NOCTURNO') THEN
    v_tipo := NULL;
  END IF;

  v_fuente := coalesce(nullif(p->>'fuente', ''), 'informada');
  IF v_fuente NOT IN ('informada', 'calculada') THEN v_fuente := 'informada'; END IF;

  v_fecha    := nullif(p->>'fecha', '')::date;
  v_min_zona := coalesce(nullif(p->>'min_zona', '')::integer,
                         CASE WHEN v_fecha IS NULL THEN 30 ELSE 10 END);

  -- empresas: mismo contrato fail-closed que metricas_desfasaje.
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

  v_desde := nullif(p->>'desde', '')::date;
  v_hasta := nullif(p->>'hasta', '')::date;
  IF v_desde IS NULL OR v_hasta IS NULL THEN
    SELECT max(fecha) INTO v_max
      FROM metricas_cumplimiento
     WHERE escenario = v_esc
       AND desfasaje_informado_mins IS NOT NULL
       AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas));
    IF v_max IS NULL THEN RETURN EMPTY_PAYLOAD; END IF;
    v_hasta := v_max;
    v_desde := v_max - 29;
  END IF;

  WITH base AS MATERIALIZED (
    SELECT fecha, zona_nro, tipo_servicio, corrida_calc_at,
           fch_hora_para, fch_hora_finalizacion,
           desfasaje_informado_mins AS d_inf,
           desfasaje_calc_mins      AS d_cal,
           CASE WHEN v_fuente = 'calculada' THEN desfasaje_calc_mins
                ELSE desfasaje_informado_mins END AS d
    FROM metricas_cumplimiento
    WHERE escenario = v_esc
      AND fecha BETWEEN v_desde AND v_hasta
      AND tipo_servicio IN ('URGENTE', 'NOCTURNO')
      AND (v_tipo IS NULL OR tipo_servicio = v_tipo)
      AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas))
      AND (desfasaje_informado_mins IS NOT NULL OR desfasaje_calc_mins IS NOT NULL)
  ),
  -- Poblacion COMUN por dia: la unica base justa para comparar acierto.
  por_dia AS (
    SELECT fecha,
           count(*) AS n,
           round(count(*) FILTER (WHERE abs(d_inf) <= 25)::numeric / count(*), 4) AS despacho_le25,
           round(count(*) FILTER (WHERE abs(d_cal) <= 25)::numeric / count(*), 4) AS motor_le25,
           round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d_inf))::numeric, 1) AS despacho_p80,
           round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d_cal))::numeric, 1) AS motor_p80
    FROM base
    WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL
    GROUP BY fecha
  ),
  -- El detalle se autopsia sobre UNA proyeccion (v_fuente), con signo.
  det AS (
    SELECT * FROM base
    WHERE d IS NOT NULL
      AND (v_fecha IS NULL OR fecha = v_fecha)
  ),
  -- por_hora y por_zona ademas del detalle de la fuente traen el
  -- HEAD-TO-HEAD sobre la comun de ese corte (despacho_le25 vs
  -- motor_le25): donde y cuando el sistema nuevo ya le gana al Despacho.
  por_hora AS (
    SELECT to_char(date_trunc('hour', fch_hora_para AT TIME ZONE 'America/Montevideo'), 'HH24:00') AS hora,
           count(*) AS n,
           round(count(*) FILTER (WHERE d >= 30)::numeric / count(*), 4) AS tarde30_pct,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d)::numeric, 1)      AS sesgo_mediana,
           round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d))::numeric, 1) AS p80,
           count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL) AS n_comun,
           round(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL AND abs(d_inf) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL), 0), 4) AS despacho_le25,
           round(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL AND abs(d_cal) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL), 0), 4) AS motor_le25
    FROM det
    WHERE fch_hora_para IS NOT NULL
    GROUP BY 1
    HAVING count(*) >= 5
  ),
  por_zona AS (
    SELECT zona_nro AS zona_id,
           count(*) AS n,
           round(count(*) FILTER (WHERE d <= 0)::numeric  / count(*), 4) AS a_tiempo_pct,
           round(count(*) FILTER (WHERE d >= 30)::numeric / count(*), 4) AS tarde30_pct,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d)::numeric, 1)      AS sesgo_mediana,
           round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d))::numeric, 1) AS p80,
           count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL) AS n_comun,
           round(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL AND abs(d_inf) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL), 0), 4) AS despacho_le25,
           round(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL AND abs(d_cal) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL), 0), 4) AS motor_le25
    FROM det
    WHERE zona_nro IS NOT NULL
    GROUP BY zona_nro
    HAVING count(*) >= v_min_zona
    ORDER BY p80 DESC
    LIMIT 12
  ),
  -- Resumen ejecutivo del corte que se esta mirando (respeta el filtro de
  -- fecha): la comun completa, Despacho vs motor.
  resumen AS (
    SELECT count(*) AS n,
           round(count(*) FILTER (WHERE abs(d_inf) <= 25)::numeric / nullif(count(*), 0), 4) AS despacho_le25,
           round(count(*) FILTER (WHERE abs(d_cal) <= 25)::numeric / nullif(count(*), 0), 4) AS motor_le25,
           round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d_inf))::numeric, 1) AS despacho_p80,
           round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d_cal))::numeric, 1) AS motor_p80
    FROM base
    WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL
      AND (v_fecha IS NULL OR fecha = v_fecha)
  ),
  peores AS (
    SELECT fecha,
           to_char(fch_hora_para AT TIME ZONE 'America/Montevideo', 'HH24:MI') AS toma,
           zona_nro AS zona_id,
           round(EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_para)) / 60.0 - d)::int AS prometido,
           round(EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_para)) / 60.0)::int     AS tardo,
           round(d)::int AS desfasaje
    FROM det
    WHERE d > 0 AND fch_hora_para IS NOT NULL
    ORDER BY d DESC
    LIMIT 15
  ),
  -- ── Diagnostico: POR QUE gano quien gano, con causas nombradas ──────
  -- Cada pedido de la comun del corte se clasifica: quien acerto, y si el
  -- motor fallo, POR QUE (mirando la corrida vigente a la toma):
  --   TECHO_SIN_MOVIL : la corrida publicaba sin moviles (techo/arranque).
  --   ESCALERA        : el numero CRUDO del modelo acertaba, pero lo
  --                     publicado venia frenado por el suavizado.
  --   MODELO_SOBRESTIMO / MODELO_SUBESTIMO : el propio modelo erro.
  --   OPERATIVO       : la entrega real paso de 90' — eso no lo arregla
  --                     ninguna formula de demora.
  -- Ademas, el contrafactico HONESTO: cuanto habria dado el motor
  -- publicando el numero crudo del modelo (sin escalera/clamp/redondeo).
  diag_base AS (
    SELECT b.*,
           dc.sin_capacidad, dc.suavizado_aplicado, dc.demora_cruda,
           EXTRACT(EPOCH FROM (b.fch_hora_finalizacion - b.fch_hora_para)) / 60.0 AS real_min
    FROM base b
    LEFT JOIN demoras_calculadas dc
           ON dc.corrida_at = b.corrida_calc_at AND dc.escenario = v_esc
          AND dc.zona_id = b.zona_nro AND dc.tipo_servicio = b.tipo_servicio
    WHERE b.d_inf IS NOT NULL AND b.d_cal IS NOT NULL
      AND (v_fecha IS NULL OR b.fecha = v_fecha)
  ),
  diag_class AS (
    SELECT *,
           (abs(d_inf) <= 25) AS hit_d,
           (abs(d_cal) <= 25) AS hit_m,
           CASE WHEN demora_cruda IS NOT NULL
                THEN abs(real_min - demora_cruda) <= 25 END AS hit_cruda,
           CASE
             WHEN abs(d_cal) <= 25 THEN NULL
             WHEN d_cal > 25 AND real_min > 90 THEN 'OPERATIVO'
             WHEN d_cal > 25 THEN 'MODELO_SUBESTIMO'
             WHEN sin_capacidad IS TRUE THEN 'TECHO_SIN_MOVIL'
             WHEN suavizado_aplicado IS TRUE AND demora_cruda IS NOT NULL
                  AND abs(real_min - demora_cruda) <= 25 THEN 'ESCALERA'
             ELSE 'MODELO_SOBRESTIMO'
           END AS causa_miss
    FROM diag_base
  ),
  diagnostico AS (
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE hit_d AND hit_m)::int         AS ambos,
           count(*) FILTER (WHERE hit_d AND NOT hit_m)::int     AS solo_despacho,
           count(*) FILTER (WHERE NOT hit_d AND hit_m)::int     AS solo_motor,
           count(*) FILTER (WHERE NOT hit_d AND NOT hit_m)::int AS ninguno,
           count(*) FILTER (WHERE hit_d AND NOT hit_m AND causa_miss = 'TECHO_SIN_MOVIL')::int   AS c_techo,
           count(*) FILTER (WHERE hit_d AND NOT hit_m AND causa_miss = 'ESCALERA')::int          AS c_escalera,
           count(*) FILTER (WHERE hit_d AND NOT hit_m AND causa_miss = 'MODELO_SOBRESTIMO')::int AS c_sobrestimo,
           count(*) FILTER (WHERE hit_d AND NOT hit_m AND causa_miss = 'MODELO_SUBESTIMO')::int  AS c_subestimo,
           count(*) FILTER (WHERE hit_d AND NOT hit_m AND causa_miss = 'OPERATIVO')::int         AS c_operativo,
           count(*) FILTER (WHERE NOT hit_d AND hit_m AND d_inf < -25)::int AS despacho_colchon,
           count(*) FILTER (WHERE NOT hit_d AND hit_m AND d_inf > 25)::int  AS despacho_tarde,
           round(count(*) FILTER (WHERE hit_d)::numeric / nullif(count(*), 0), 4) AS despacho_le25,
           round(count(*) FILTER (WHERE hit_m)::numeric / nullif(count(*), 0), 4) AS motor_le25,
           round(count(*) FILTER (WHERE hit_cruda)::numeric
                 / nullif(count(*) FILTER (WHERE hit_cruda IS NOT NULL), 0), 4)   AS cruda_le25,
           count(*) FILTER (WHERE hit_cruda IS NOT NULL)::int AS cruda_n
    FROM diag_class
  )
  SELECT jsonb_build_object(
    'rango',  jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'fuente', v_fuente,
    'fecha',  v_fecha,
    'resumen', (SELECT CASE WHEN x.n > 0 THEN to_jsonb(x) ELSE NULL END FROM resumen x),
    'diagnostico', (SELECT CASE WHEN x.n > 0 THEN to_jsonb(x) ELSE NULL END FROM diagnostico x),
    'por_dia',  coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.fecha) FROM por_dia x), '[]'::jsonb),
    'por_hora', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hora)  FROM por_hora x), '[]'::jsonb),
    'por_zona', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.p80 DESC) FROM por_zona x), '[]'::jsonb),
    'peores',   coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.desfasaje DESC) FROM peores x), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION metricas_desfasaje_analisis(jsonb) IS
  'Analisis del acierto de la demora para la card "donde y cuando falla": poblacion comun por dia (Despacho vs motor), por hora de la toma, peores zonas y peores casos — sobre metricas_cumplimiento, con fuente (informada|calculada), filtro por fecha y umbral de zona parametrizable. Ver docs/sqls/2026-08-05-desfasaje-analisis.sql.';

REVOKE EXECUTE ON FUNCTION metricas_desfasaje_analisis(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_desfasaje_analisis(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_desfasaje_analisis(jsonb) TO service_role;
