-- =====================================================================
-- RPC metricas_zona_corrida: la radiografia POR ZONA de una corrida
-- Fecha: 2026-08-05 | Idempotente | Pedido de Diego (audio 12):
-- "del dia de hoy, por zona: que demora dio el Despacho, que dio el
--  motor, cual es la brecha y cual es el porcentaje de acierto en cada
--  zona — y poder elegir alguna corrida en particular de un combo".
--
-- Devuelve:
--   corridas : todas las corridas del dia (para el combo del horario).
--   corrida  : la elegida (p.corrida) o la ULTIMA del dia.
--   zonas    : la foto POR ZONA de esa corrida (motor, Despacho, brecha,
--              fase del arranque, cola, ritmo) + el ACIERTO DEL DIA por
--              zona EN VIVO (misma tecnica que metricas_evolucion_dia:
--              entregados de hoy contra la promesa de la corrida vigente
--              a la toma — sin esperar el job nocturno).
--
-- p: { escenario (req), fecha? (default hoy Montevideo),
--      corrida? (timestamptz; null = la ultima del dia),
--      tipo? (URGENTE|NOCTURNO; ausente = ambos),
--      empresas?: int[] (fail-closed; filtra las ENTREGAS del acierto) }
-- =====================================================================

CREATE OR REPLACE FUNCTION metricas_zona_corrida(p jsonb)
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
  v_corrida        timestamptz;
  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;
  v_result         jsonb;

  EMPTY_PAYLOAD CONSTANT jsonb := jsonb_build_object(
    'fecha', null, 'corrida', null, 'corridas', '[]'::jsonb, 'zonas', '[]'::jsonb
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

  -- La corrida elegida: la del combo, o la ultima del dia.
  v_corrida := nullif(p->>'corrida', '')::timestamptz;
  IF v_corrida IS NULL THEN
    SELECT max(corrida_at) INTO v_corrida
      FROM demoras_calculadas
     WHERE escenario = v_esc AND corrida_at >= v_ini AND corrida_at < v_fin;
  END IF;
  IF v_corrida IS NULL THEN
    RETURN jsonb_build_object('fecha', v_fecha, 'corrida', null,
                              'corridas', '[]'::jsonb, 'zonas', '[]'::jsonb);
  END IF;

  WITH corridas AS (
    SELECT DISTINCT corrida_at
    FROM demoras_calculadas
    WHERE escenario = v_esc AND corrida_at >= v_ini AND corrida_at < v_fin
  ),
  -- El acierto del dia POR ZONA, en vivo desde pedidos (promesa del
  -- motor = corrida vigente a la toma; agendados excluidos).
  entregados AS MATERIALIZED (
    SELECT p2.zona_nro,
           upper(trim(p2.servicio_nombre)) AS tipo,
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
      WHERE dc.escenario = v_esc AND dc.zona_id = p2.zona_nro
        AND dc.tipo_servicio = upper(trim(p2.servicio_nombre))
        AND dc.corrida_at <= p2.fch_hora_para AND dc.corrida_at >= v_ini
      ORDER BY dc.corrida_at DESC LIMIT 1
    ) mm ON true
    WHERE p2.escenario = v_esc
      AND p2.estado_nro = 2 AND p2.sub_estado_nro = 3
      AND coalesce(p2.orden_cancelacion, 'N') <> 'S'
      AND upper(trim(p2.servicio_nombre)) IN ('URGENTE', 'NOCTURNO')
      AND (v_tipo IS NULL OR upper(trim(p2.servicio_nombre)) = v_tipo)
      AND p2.fch_hora_finalizacion >= v_ini AND p2.fch_hora_finalizacion < v_fin
      AND p2.fch_hora_para IS NOT NULL
      AND NOT (coalesce(p2.fch_hora_asignado, p2.fch_hora_para)
               + interval '60 minutes' < p2.fch_hora_para)
      AND (v_empresas IS NULL OR p2.empresa_fletera_id = ANY(v_empresas))
  ),
  acierto_zona AS (
    SELECT zona_nro AS zona_id, tipo AS tipo_servicio,
           count(*)::int AS entregados,
           count(*) FILTER (WHERE d_desp IS NOT NULL AND d_mot IS NOT NULL)::int AS comun,
           round(count(*) FILTER (WHERE d_desp IS NOT NULL AND d_mot IS NOT NULL AND abs(d_desp) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE d_desp IS NOT NULL AND d_mot IS NOT NULL), 0), 4) AS d_le25,
           round(count(*) FILTER (WHERE d_desp IS NOT NULL AND d_mot IS NOT NULL AND abs(d_mot) <= 25)::numeric
                 / nullif(count(*) FILTER (WHERE d_desp IS NOT NULL AND d_mot IS NOT NULL), 0), 4) AS m_le25
    FROM entregados
    GROUP BY zona_nro, tipo
  ),
  foto AS (
    SELECT dc.zona_id, dc.tipo_servicio,
           dc.demora_informada AS motor,
           dc.demora_as400     AS despacho,
           CASE WHEN dc.demora_as400 IS NOT NULL
                THEN dc.demora_informada - dc.demora_as400 END AS brecha,
           dc.arranque_fase, dc.sin_capacidad,
           dc.cola_por_delante, dc.ritmo_usado,
           dc.moviles_prioridad, dc.moviles_transito,
           az.entregados, az.comun, az.d_le25, az.m_le25
    FROM demoras_calculadas dc
    LEFT JOIN acierto_zona az
           ON az.zona_id = dc.zona_id AND az.tipo_servicio = dc.tipo_servicio
    WHERE dc.escenario = v_esc AND dc.corrida_at = v_corrida
      AND dc.tipo_servicio IN ('URGENTE', 'NOCTURNO')
      AND (v_tipo IS NULL OR dc.tipo_servicio = v_tipo)
  )
  SELECT jsonb_build_object(
    'fecha', v_fecha,
    'corrida', v_corrida,
    'corridas', coalesce((SELECT jsonb_agg(c.corrida_at ORDER BY c.corrida_at) FROM corridas c), '[]'::jsonb),
    'zonas', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY abs(coalesce(f.brecha, 0)) DESC) FROM foto f), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION metricas_zona_corrida(jsonb) IS
  'Radiografia por zona de una corrida elegida (o la ultima del dia): motor vs Despacho vs brecha + fase del arranque + el acierto del dia POR ZONA calculado en vivo desde pedidos. Alimenta la card con el combo de corridas (pedido de Diego, audio 12 del 5/8). Ver docs/sqls/2026-08-05-zona-corrida.sql.';

REVOKE EXECUTE ON FUNCTION metricas_zona_corrida(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_zona_corrida(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_zona_corrida(jsonb) TO service_role;
