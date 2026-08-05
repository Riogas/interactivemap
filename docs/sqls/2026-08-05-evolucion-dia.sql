-- =====================================================================
-- RPC metricas_evolucion_dia: la sala de control del dia, EN VIVO
-- Fecha: 2026-08-05 | Idempotente | Requiere: motor TRAMOS + predictivo
--
-- Una fila por corrida del motor (cada 10 min) con la foto del momento y
-- el acumulado del dia hasta esa corrida:
--   - que publico el motor (promedio) y que tenia el Despacho,
--   - cuantas zonas estaban en cada fase del arranque predictivo
--     (PREDICTIVO / GRACIA_VENCIDA / TRANSITO) y cuantas sin movil,
--   - entregados acumulados y % <=25' de las DOS promesas sobre los
--     pedidos ya entregados a esa hora (poblacion comun).
--
-- El cumplimiento se calcula EN VIVO desde `pedidos` (no espera el job
-- nocturno de metricas_cumplimiento): entregado hoy + no agendado; el
-- desfasaje del Despacho sale de demora_informada congelada en el pedido
-- y el del motor de la corrida vigente a la hora de la toma (lookup por
-- indice, igual que el backfill).
--
-- p: { escenario (req), fecha? (default hoy Montevideo),
--      tipo? (URGENTE|NOCTURNO; ausente = ambos),
--      empresas?: int[] (fail-closed: [] = vacio; filtra las ENTREGAS —
--      las corridas son publicaciones por zona, iguales para todos) }
-- =====================================================================

CREATE OR REPLACE FUNCTION metricas_evolucion_dia(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc            integer;
  v_tipo           text;
  v_fecha          date;
  v_ini            timestamptz;
  v_fin            timestamptz;
  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;
  v_result         jsonb;

  EMPTY_PAYLOAD CONSTANT jsonb := jsonb_build_object(
    'fecha', null, 'corridas', '[]'::jsonb, 'resumen', null
  );
BEGIN
  v_esc  := (p->>'escenario')::integer;
  v_tipo := nullif(p->>'tipo', '');
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('URGENTE', 'NOCTURNO') THEN
    v_tipo := NULL;
  END IF;

  v_fecha := coalesce(nullif(p->>'fecha', '')::date,
                      (now() AT TIME ZONE 'America/Montevideo')::date);
  v_ini := v_fecha::timestamp AT TIME ZONE 'America/Montevideo';
  v_fin := (v_fecha + 1)::timestamp AT TIME ZONE 'America/Montevideo';

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

  WITH entregados AS MATERIALIZED (
    SELECT p2.fch_hora_finalizacion,
           CASE WHEN p2.demora_informada > 0
                THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                     - p2.demora_informada
           END AS d_desp,
           CASE WHEN mm.demora_informada IS NOT NULL
                THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                     - mm.demora_informada
           END AS d_mot
    FROM pedidos p2
    LEFT JOIN LATERAL (
      SELECT dc.demora_informada
      FROM demoras_calculadas dc
      WHERE dc.escenario = v_esc
        AND dc.zona_id = p2.zona_nro
        AND dc.tipo_servicio = upper(trim(p2.servicio_nombre))
        AND dc.corrida_at <= p2.fch_hora_para
        AND dc.corrida_at >= v_ini
      ORDER BY dc.corrida_at DESC
      LIMIT 1
    ) mm ON true
    WHERE p2.escenario = v_esc
      AND p2.estado_nro = 2 AND p2.sub_estado_nro = 3
      AND coalesce(p2.orden_cancelacion, 'N') <> 'S'
      AND upper(trim(p2.servicio_nombre)) IN ('URGENTE', 'NOCTURNO')
      AND (v_tipo IS NULL OR upper(trim(p2.servicio_nombre)) = v_tipo)
      AND p2.fch_hora_finalizacion >= v_ini AND p2.fch_hora_finalizacion < v_fin
      AND p2.fch_hora_para IS NOT NULL
      -- Agendados afuera (misma regla que los hechos): lo asignaron mas de
      -- 60' antes del "para cuando". Sin hora de asignacion, no es agendado.
      AND NOT (coalesce(p2.fch_hora_asignado, p2.fch_hora_para)
               + interval '60 minutes' < p2.fch_hora_para)
      AND (v_empresas IS NULL OR p2.empresa_fletera_id = ANY(v_empresas))
  ),
  corridas AS (
    SELECT dc.corrida_at,
           count(*)::int AS zonas,
           round(avg(dc.demora_informada), 1) AS prom_motor,
           round(avg(dc.demora_as400), 1)     AS prom_despacho,
           count(*) FILTER (WHERE dc.arranque_fase = 'PREDICTIVO')::int     AS f_predictivo,
           count(*) FILTER (WHERE dc.arranque_fase = 'GRACIA_VENCIDA')::int AS f_gracia,
           count(*) FILTER (WHERE dc.arranque_fase = 'TRANSITO')::int       AS f_transito,
           count(*) FILTER (WHERE dc.sin_capacidad)::int                    AS sin_movil
    FROM demoras_calculadas dc
    WHERE dc.escenario = v_esc
      AND dc.corrida_at >= v_ini AND dc.corrida_at < v_fin
      AND dc.tipo_servicio IN ('URGENTE', 'NOCTURNO')
      AND (v_tipo IS NULL OR dc.tipo_servicio = v_tipo)
    GROUP BY dc.corrida_at
  ),
  linea AS (
    SELECT c.*,
           a.entregados, a.comun, a.d_le25, a.m_le25
    FROM corridas c
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS entregados,
             count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL)::int AS comun,
             round(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL
                                      AND abs(e.d_desp) <= 25)::numeric
                   / nullif(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL), 0), 4) AS d_le25,
             round(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL
                                      AND abs(e.d_mot) <= 25)::numeric
                   / nullif(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL), 0), 4) AS m_le25
      FROM entregados e
      WHERE e.fch_hora_finalizacion <= c.corrida_at
    ) a
  ),
  resumen AS (
    SELECT count(*)::int AS entregados,
           count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL)::int AS comun,
           round(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL
                                    AND abs(e.d_desp) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL), 0), 4) AS d_le25,
           round(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL
                                    AND abs(e.d_mot) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL), 0), 4) AS m_le25,
           round((percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(e.d_desp))
                    FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL))::numeric, 1) AS d_p80,
           round((percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(e.d_mot))
                    FILTER (WHERE e.d_desp IS NOT NULL AND e.d_mot IS NOT NULL))::numeric, 1) AS m_p80
    FROM entregados e
  )
  SELECT jsonb_build_object(
    'fecha', v_fecha,
    'corridas', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.corrida_at) FROM linea x), '[]'::jsonb),
    'resumen', (SELECT to_jsonb(x) FROM resumen x)
  ) INTO v_result;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION metricas_evolucion_dia(jsonb) IS
  'Sala de control del dia en vivo: una fila por corrida del motor con lo publicado (motor y Despacho), las fases del arranque predictivo y el acumulado de cumplimiento del dia calculado directo de pedidos (desfasaje Despacho por demora_informada congelada; desfasaje motor por la corrida vigente a la toma). Ver docs/sqls/2026-08-05-evolucion-dia.sql.';

REVOKE EXECUTE ON FUNCTION metricas_evolucion_dia(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_evolucion_dia(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_evolucion_dia(jsonb) TO service_role;
