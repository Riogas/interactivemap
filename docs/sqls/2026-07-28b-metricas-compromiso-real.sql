-- =====================================================================
-- Métricas de Cumplimiento — EL ATRASO SE MIDE CONTRA EL COMPROMISO REAL
-- Fecha: 2026-07-28 | Idempotente | Aplicar en: Supabase SQL Editor.
-- Aplicar DESPUÉS de 2026-07-28-metricas-escenario-primero.sql.
--
-- EL PROBLEMA
-- -----------
-- `atraso_vs_para_mins` y `on_time_pct` se calculaban contra
-- `fch_hora_para`, asumiendo que era la "hora máxima comprometida". No lo
-- es. Medido sobre la base real el 2026-07-28:
--
--   * El 59% de los valores de `fch_hora_para` terminan en `:59` segundos.
--   * Está sistemáticamente ANTES de `fch_hora_asignado` (incluso en los
--     NOCTURNO, que serían los candidatos a estar agendados).
--   * En `services` se ve la relación exacta:
--         fch_hora_para 14:38:59  ->  fch_hora_max_ent_comp 18:38:59
--         fch_hora_para 13:32:59  ->  fch_hora_max_ent_comp 17:32:59
--     es decir, max_ent_comp = para + 4h. `para` es el ALTA del pedido
--     (para cuándo lo quiere ≈ ahora) y `max_ent_comp` es el SLA.
--
-- Consecuencia: nada puede terminar antes de haber entrado al sistema, así
-- que `on_time_pct` daba 0,14% — un artefacto, no un dato operativo.
--
--   Sobre 1000 pedidos cumplidos:
--     contra fch_hora_para          ->  0,2% a tiempo, atraso mediano +28,2 min
--     contra fch_hora_max_ent_comp  -> 77,6% a tiempo, atraso mediano −15,8 min
--
-- LA DECISIÓN: ADITIVA, NO DESTRUCTIVA
-- ------------------------------------
-- NO se renombra ni se pisa `atraso_vs_para_mins`:
--   (a) el path legacy `lib/metricas/build-fact.ts` todavía lo escribe y un
--       rename lo rompería en runtime;
--   (b) `fin − alta` es una métrica válida por sí sola (tiempo total que el
--       cliente esperó desde que pidió), solo que no es "atraso".
-- Se AGREGAN dos columnas y el atraso "oficial" pasa a salir de la nueva.
--
-- `fch_hora_para` SIGUE siendo la base de la regla de agendados, y ahí está
-- bien usado: significa "para cuándo lo quiere". Que la regla dispare poco
-- (26 de 168.315) no es un bug — es que casi todos los pedidos son
-- inmediatos, así que `para ≈ ahora` y no hay espera planificada que
-- descontar.
--
-- BACKFILL SIN RIESGO
-- -------------------
-- Se hace con UPDATE ... FROM, NO con metricas_cumplimiento_run(): ese hace
-- DELETE + INSERT desde pedidos/services y, si la fuente no cubriera todo el
-- rango, borraría hechos históricos irrecuperables. Con UPDATE es imposible
-- perder una fila. (Verificado igual: pedidos llega hasta 2026-04-14 y cubre
-- ~100% de los hechos — 87.537 fuentes vs 87.532 hechos en junio.)
-- =====================================================================


-- =====================================================================
-- 1. Columnas nuevas
-- =====================================================================
ALTER TABLE metricas_cumplimiento
  ADD COLUMN IF NOT EXISTS fch_hora_max_ent_comp     timestamptz,
  ADD COLUMN IF NOT EXISTS atraso_vs_compromiso_mins numeric;

COMMENT ON COLUMN metricas_cumplimiento.fch_hora_max_ent_comp IS
  'Hora máxima de entrega COMPROMETIDA (SLA) del origen. Este es el plazo real contra el cual se mide el atraso.';
COMMENT ON COLUMN metricas_cumplimiento.atraso_vs_compromiso_mins IS
  'MÉTRICA DE ATRASO OFICIAL: fch_hora_finalizacion − fch_hora_max_ent_comp, CON signo (negativo = entregó antes del compromiso). NULL si el origen no trae compromiso.';
COMMENT ON COLUMN metricas_cumplimiento.atraso_vs_para_mins IS
  'Tiempo total desde el ALTA del pedido hasta el cumplimiento (fin − fch_hora_para), CON signo. OJO: NO es un atraso — fch_hora_para es la hora de alta, no un plazo. Para atraso usar atraso_vs_compromiso_mins.';


-- =====================================================================
-- 2. El job: poblar las columnas nuevas de acá en más
-- ---------------------------------------------------------------------
-- Mismo cuerpo que 2026-07-28-metricas-escenario-primero.sql + el
-- compromiso. Se conserva la firma de 3 args (el cron llama con 2).
-- =====================================================================
CREATE OR REPLACE FUNCTION metricas_cumplimiento_run(
  p_desde     date,
  p_hasta     date,
  p_escenario integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_insertados bigint;
BEGIN
  DELETE FROM metricas_cumplimiento
   WHERE fecha BETWEEN p_desde AND p_hasta
     AND (p_escenario IS NULL OR escenario = p_escenario);

  WITH src AS (
    SELECT 'PEDIDO'::text AS origen, id AS pedido_id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           fch_hora_max_ent_comp,
           demora_movil_desde_asignacion_mins
    FROM pedidos
    WHERE estado_nro = 2 AND sub_estado_nro = 3
      AND coalesce(orden_cancelacion, 'N') <> 'S'
      AND escenario IS NOT NULL
      AND (p_escenario IS NULL OR escenario = p_escenario)
      AND fch_hora_finalizacion IS NOT NULL
      AND (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT 'SERVICE', id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           fch_hora_max_ent_comp,
           demora_movil_desde_asignacion_mins
    FROM services
    WHERE estado_nro = 2 AND sub_estado_nro = 3
      AND coalesce(orden_cancelacion, 'N') <> 'S'
      AND escenario IS NOT NULL
      AND (p_escenario IS NULL OR escenario = p_escenario)
      AND fch_hora_finalizacion IS NOT NULL
      AND (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
  ),
  calc AS (
    SELECT
      origen, pedido_id, escenario,
      (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date AS fecha,
      CASE
        WHEN origen = 'SERVICE'                            THEN 'SERVICE'
        WHEN upper(trim(servicio_nombre)) = 'URGENTE'      THEN 'URGENTE'
        WHEN upper(trim(servicio_nombre)) = 'NOCTURNO'     THEN 'NOCTURNO'
        WHEN upper(trim(servicio_nombre)) LIKE 'ESPECIAL%' THEN 'ESPECIAL'
        ELSE 'OTROS'
      END AS tipo_servicio,
      servicio_nombre, movil, zona_nro, empresa_fletera_id,
      nullif(trim(fletero), '') AS chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
      fch_hora_max_ent_comp,
      CASE
        WHEN fch_hora_asignado IS NOT NULL                  THEN 'CAMPO'
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL THEN 'DERIVADO'
        ELSE NULL
      END AS asignado_source,
      CASE
        WHEN fch_hora_asignado IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_asignado)) / 60.0
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL
          THEN demora_movil_desde_asignacion_mins::numeric
        ELSE NULL
      END AS demora_bruta,
      CASE
        WHEN fch_hora_asignado IS NOT NULL THEN fch_hora_asignado
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL
          THEN fch_hora_finalizacion - (demora_movil_desde_asignacion_mins * interval '1 minute')
        ELSE NULL
      END AS asignado_efectivo
    FROM src
  ),
  eff AS (
    SELECT *,
      -- Regla de agendados: sigue sobre fch_hora_para ("para cuándo lo
      -- quiere"), que es su significado correcto.
      (asignado_efectivo IS NOT NULL AND fch_hora_para IS NOT NULL
        AND asignado_efectivo + interval '60 minute' < fch_hora_para) AS es_agendado,
      CASE WHEN fch_hora_para IS NOT NULL
        THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_para)) / 60.0
        ELSE NULL END AS desde_alta_bruto,
      -- Atraso REAL: contra el compromiso (SLA).
      CASE WHEN fch_hora_max_ent_comp IS NOT NULL
        THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_max_ent_comp)) / 60.0
        ELSE NULL END AS atraso_compromiso_bruto
    FROM calc
  ),
  ins AS (
    INSERT INTO metricas_cumplimiento (
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
      demora_mins, demora_efectiva_mins, atraso_vs_para_mins,
      atraso_vs_compromiso_mins, reloj_inicio, asignado_source
    )
    SELECT
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      CASE WHEN asignado_source = 'CAMPO' THEN fch_hora_asignado ELSE NULL END,
      fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
      round(demora_bruta, 2),
      round(CASE WHEN es_agendado THEN greatest(0, desde_alta_bruto) ELSE demora_bruta END, 2),
      round(desde_alta_bruto, 2),
      round(atraso_compromiso_bruto, 2),
      CASE WHEN es_agendado THEN 'PARA' ELSE 'ASIGNADO' END,
      asignado_source
    FROM eff
    WHERE asignado_source IS NOT NULL
      AND demora_bruta >= 0
    ON CONFLICT (origen, pedido_id, escenario) DO UPDATE SET
      fecha                     = EXCLUDED.fecha,
      tipo_servicio             = EXCLUDED.tipo_servicio,
      servicio_nombre           = EXCLUDED.servicio_nombre,
      movil                     = EXCLUDED.movil,
      zona_nro                  = EXCLUDED.zona_nro,
      empresa_fletera_id        = EXCLUDED.empresa_fletera_id,
      chofer                    = EXCLUDED.chofer,
      fch_hora_asignado         = EXCLUDED.fch_hora_asignado,
      fch_hora_finalizacion     = EXCLUDED.fch_hora_finalizacion,
      fch_hora_para             = EXCLUDED.fch_hora_para,
      fch_hora_max_ent_comp     = EXCLUDED.fch_hora_max_ent_comp,
      demora_mins               = EXCLUDED.demora_mins,
      demora_efectiva_mins      = EXCLUDED.demora_efectiva_mins,
      atraso_vs_para_mins       = EXCLUDED.atraso_vs_para_mins,
      atraso_vs_compromiso_mins = EXCLUDED.atraso_vs_compromiso_mins,
      reloj_inicio              = EXCLUDED.reloj_inicio,
      asignado_source           = EXCLUDED.asignado_source
    RETURNING 1
  )
  SELECT count(*) INTO v_insertados FROM ins;

  RETURN v_insertados;
END;
$fn$;

COMMENT ON FUNCTION metricas_cumplimiento_run(date, date, integer) IS
  'Recomputa metricas_cumplimiento para [p_desde, p_hasta] (fecha en America/Montevideo). p_escenario NULL (default) = todos. El atraso oficial sale de fch_hora_max_ent_comp (compromiso/SLA); fch_hora_para queda como hora de alta y como base de la regla de agendados. El cron llama con 2 args.';


-- =====================================================================
-- 3. Backfill de los hechos históricos — UPDATE, nunca DELETE
-- =====================================================================
UPDATE metricas_cumplimiento m
   SET fch_hora_max_ent_comp     = s.fch_hora_max_ent_comp,
       atraso_vs_compromiso_mins = round(
         (EXTRACT(EPOCH FROM (m.fch_hora_finalizacion - s.fch_hora_max_ent_comp)) / 60.0)::numeric, 2)
  FROM (
    SELECT 'PEDIDO'::text AS origen, id AS pedido_id, escenario, fch_hora_max_ent_comp
      FROM pedidos  WHERE fch_hora_max_ent_comp IS NOT NULL
    UNION ALL
    SELECT 'SERVICE',      id,        escenario, fch_hora_max_ent_comp
      FROM services WHERE fch_hora_max_ent_comp IS NOT NULL
  ) s
 WHERE m.origen    = s.origen
   AND m.pedido_id = s.pedido_id
   AND m.escenario = s.escenario;


-- =====================================================================
-- 4. Vistas: `promedio_atraso_mins` pasa a medir contra el compromiso
-- ---------------------------------------------------------------------
-- CREATE OR REPLACE (no DROP): no cambian nombres, tipos ni orden de
-- columnas — solo de dónde sale el promedio de atraso. Cero impacto en
-- consumidores.
-- =====================================================================
CREATE OR REPLACE VIEW vw_metricas_cumplimiento_diario AS
  SELECT escenario, 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         fecha AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*)                                                          AS cantidad,
         ROUND(AVG(demora_efectiva_mins), 2)                               AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins)                                         AS min_mins,
         MAX(demora_efectiva_mins)                                         AS max_mins,
         ROUND(AVG(atraso_vs_compromiso_mins), 2)                          AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY escenario, chofer, fecha, tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'MOVIL', movil::text, fecha, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_compromiso_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, movil, fecha, tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'ZONA', zona_nro::text, fecha, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_compromiso_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, zona_nro, fecha, tipo_servicio, empresa_fletera_id;

CREATE OR REPLACE VIEW vw_metricas_cumplimiento_semanal AS
  SELECT escenario, 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         date_trunc('week', fecha)::date AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*) AS cantidad, ROUND(AVG(demora_efectiva_mins),2) AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins) AS min_mins, MAX(demora_efectiva_mins) AS max_mins,
         ROUND(AVG(atraso_vs_compromiso_mins),2) AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY escenario, chofer, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'MOVIL', movil::text, date_trunc('week', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_compromiso_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, movil, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'ZONA', zona_nro::text, date_trunc('week', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_compromiso_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, zona_nro, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id;

CREATE OR REPLACE VIEW vw_metricas_cumplimiento_mensual AS
  SELECT escenario, 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         date_trunc('month', fecha)::date AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*) AS cantidad, ROUND(AVG(demora_efectiva_mins),2) AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins) AS min_mins, MAX(demora_efectiva_mins) AS max_mins,
         ROUND(AVG(atraso_vs_compromiso_mins),2) AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY escenario, chofer, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'MOVIL', movil::text, date_trunc('month', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_compromiso_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, movil, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'ZONA', zona_nro::text, date_trunc('month', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_compromiso_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, zona_nro, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id;

CREATE OR REPLACE VIEW vw_metricas_cumplimiento_escenarios AS
  SELECT m.escenario,
         COALESCE(es.nombre, 'Escenario ' || m.escenario)                    AS escenario_nombre,
         m.fecha, m.tipo_servicio, m.empresa_fletera_id,
         COUNT(*)                                                            AS cantidad,
         ROUND(AVG(m.demora_efectiva_mins), 2)                               AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY m.demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY m.demora_efectiva_mins) AS p90_mins,
         ROUND(AVG(m.atraso_vs_compromiso_mins), 2)                          AS promedio_atraso_mins,
         COUNT(*) FILTER (WHERE m.atraso_vs_compromiso_mins <= 0)             AS cantidad_a_tiempo,
         COUNT(*) FILTER (WHERE m.atraso_vs_compromiso_mins IS NOT NULL)      AS cantidad_con_compromiso
  FROM metricas_cumplimiento m
  LEFT JOIN escenario_settings es ON es.escenario_id = m.escenario
  GROUP BY m.escenario, es.nombre, m.fecha, m.tipo_servicio, m.empresa_fletera_id;


-- =====================================================================
-- 5. RPC: `promedio_atraso` y `on_time_pct` contra el compromiso
-- ---------------------------------------------------------------------
-- Los NOMBRES del payload no cambian (promedio_atraso, on_time_pct,
-- ranking[].atraso) — solo su fuente. La UI y los tipos TS quedan igual.
-- =====================================================================
CREATE OR REPLACE FUNCTION metricas_dashboard(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc          integer;
  v_ventana      text;
  v_dimension    text;

  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;

  v_tipos_type   text;
  v_tipos        text[];

  v_escenarios   jsonb;
  v_comparativa  jsonb;

  v_min          date;
  v_max          date;
  v_desde        date;
  v_hasta        date;
  v_len          integer;
  v_prev_desde   date;
  v_prev_hasta   date;
  v_trend_start  date;

  v_result       jsonb;

  EMPTY_KPIS CONSTANT jsonb := jsonb_build_object(
    'cantidad', 0, 'promedio', null, 'mediana', null, 'p90', null,
    'min', null, 'max', null, 'promedio_atraso', null, 'on_time_pct', null
  );
BEGIN
  v_esc       := (p->>'escenario')::integer;
  v_ventana   := coalesce(p->>'ventana', 'diario');
  v_dimension := coalesce(p->>'dimension', 'chofer');
  IF v_ventana   NOT IN ('diario','semanal','mensual') THEN v_ventana := 'diario'; END IF;
  IF v_dimension NOT IN ('chofer','movil','zona')      THEN v_dimension := 'chofer'; END IF;

  v_empresas_type := jsonb_typeof(p->'empresas');
  IF v_empresas_type IS NULL OR v_empresas_type = 'null' THEN
    v_empresas := NULL;
  ELSIF v_empresas_type = 'array' THEN
    IF jsonb_array_length(p->'empresas') = 0 THEN
      v_empresas := ARRAY[]::int[];
      v_empresas_empty := true;
    ELSE
      SELECT array_agg(x::int) INTO v_empresas FROM jsonb_array_elements_text(p->'empresas') AS x;
    END IF;
  ELSE
    v_empresas := NULL;
  END IF;

  v_tipos_type := jsonb_typeof(p->'tipos');
  IF v_tipos_type IS NULL OR v_tipos_type = 'null' THEN
    v_tipos := NULL;
  ELSIF v_tipos_type = 'array' THEN
    IF jsonb_array_length(p->'tipos') = 0 THEN
      v_tipos := NULL;
    ELSE
      SELECT array_agg(x) INTO v_tipos FROM jsonb_array_elements_text(p->'tipos') AS x;
    END IF;
  ELSE
    v_tipos := NULL;
  END IF;

  IF v_empresas_empty THEN
    RETURN jsonb_build_object(
      'escenario_sel', v_esc,
      'escenarios', '[]'::jsonb,
      'rango', null,
      'periodo_sel', jsonb_build_object('desde', null, 'hasta', null),
      'kpis', EMPTY_KPIS,
      'kpis_prev', EMPTY_KPIS,
      'serie', '[]'::jsonb,
      'por_tipo', '[]'::jsonb,
      'ranking', '[]'::jsonb,
      'comparativa', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.escenario), '[]'::jsonb)
    INTO v_escenarios
  FROM (
    SELECT m.escenario,
           coalesce(es.nombre, 'Escenario ' || m.escenario) AS nombre,
           min(m.fecha) AS min_fecha,
           max(m.fecha) AS max_fecha,
           count(*)     AS cantidad
    FROM metricas_cumplimiento m
    LEFT JOIN escenario_settings es ON es.escenario_id = m.escenario
    WHERE (v_empresas IS NULL OR m.empresa_fletera_id = ANY(v_empresas))
    GROUP BY m.escenario, es.nombre
  ) e;

  SELECT min(fecha), max(fecha) INTO v_min, v_max
  FROM metricas_cumplimiento
  WHERE escenario = v_esc
    AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas));

  IF v_max IS NULL THEN
    RETURN jsonb_build_object(
      'escenario_sel', v_esc,
      'escenarios', v_escenarios,
      'rango', null,
      'periodo_sel', jsonb_build_object('desde', p->>'desde', 'hasta', p->>'hasta'),
      'kpis', EMPTY_KPIS,
      'kpis_prev', EMPTY_KPIS,
      'serie', '[]'::jsonb,
      'por_tipo', '[]'::jsonb,
      'ranking', '[]'::jsonb,
      'comparativa', '[]'::jsonb
    );
  END IF;

  v_desde := NULLIF(p->>'desde', '')::date;
  v_hasta := NULLIF(p->>'hasta', '')::date;

  IF v_desde IS NULL OR v_hasta IS NULL THEN
    IF v_ventana = 'diario' THEN
      v_desde := v_max;
      v_hasta := v_max;
    ELSIF v_ventana = 'semanal' THEN
      v_desde := date_trunc('week', v_max)::date;
      v_hasta := v_desde + 6;
    ELSE
      v_desde := date_trunc('month', v_max)::date;
      v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
    END IF;
  END IF;

  IF v_desde < v_min  THEN v_desde := v_min;  END IF;
  IF v_hasta > v_max  THEN v_hasta := v_max;  END IF;
  IF v_hasta < v_desde THEN v_hasta := v_desde; END IF;

  v_len        := v_hasta - v_desde;
  v_prev_hasta := v_desde - 1;
  v_prev_desde := v_prev_hasta - v_len;

  IF v_ventana = 'diario' THEN
    v_trend_start := greatest(v_hasta - 29, v_min);
  ELSIF v_ventana = 'semanal' THEN
    v_trend_start := greatest(v_hasta - 83, v_min);
  ELSE
    v_trend_start := greatest((date_trunc('month', v_hasta) - interval '5 months')::date, v_min);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.promedio ASC NULLS LAST), '[]'::jsonb)
    INTO v_comparativa
  FROM (
    SELECT m.escenario,
           coalesce(es.nombre, 'Escenario ' || m.escenario) AS nombre,
           round(avg(m.demora_efectiva_mins), 2) AS promedio,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.demora_efectiva_mins)::numeric, 2) AS mediana,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY m.demora_efectiva_mins)::numeric, 2) AS p90,
           count(*) AS cantidad,
           round(avg(m.atraso_vs_compromiso_mins), 2) AS promedio_atraso,
           round(
             (count(*) FILTER (WHERE m.atraso_vs_compromiso_mins <= 0))::numeric
             / nullif(count(*) FILTER (WHERE m.atraso_vs_compromiso_mins IS NOT NULL), 0),
             4
           ) AS on_time_pct
    FROM metricas_cumplimiento m
    LEFT JOIN escenario_settings es ON es.escenario_id = m.escenario
    WHERE m.fecha BETWEEN v_desde AND v_hasta
      AND (v_empresas IS NULL OR m.empresa_fletera_id = ANY(v_empresas))
      AND (v_tipos    IS NULL OR m.tipo_servicio      = ANY(v_tipos))
    GROUP BY m.escenario, es.nombre
  ) c;

  WITH win AS MATERIALIZED (
    SELECT *
    FROM metricas_cumplimiento
    WHERE escenario = v_esc
      AND fecha BETWEEN least(v_trend_start, v_prev_desde) AND v_hasta
      AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas))
      AND (v_tipos    IS NULL OR tipo_servicio      = ANY(v_tipos))
  ),
  sel AS (
    SELECT * FROM win WHERE fecha BETWEEN v_desde AND v_hasta
  ),
  prev AS (
    SELECT * FROM win WHERE fecha BETWEEN v_prev_desde AND v_prev_hasta
  ),
  kpis_sel AS (
    SELECT
      count(*) AS cantidad,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS mediana,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      round(min(demora_efectiva_mins), 2) AS min,
      round(max(demora_efectiva_mins), 2) AS max,
      round(avg(atraso_vs_compromiso_mins), 2) AS promedio_atraso,
      round(
        (count(*) FILTER (WHERE atraso_vs_compromiso_mins <= 0))::numeric
        / nullif(count(*) FILTER (WHERE atraso_vs_compromiso_mins IS NOT NULL), 0),
        4
      ) AS on_time_pct
    FROM sel
  ),
  kpis_prev_calc AS (
    SELECT
      count(*) AS cantidad,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS mediana,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      round(min(demora_efectiva_mins), 2) AS min,
      round(max(demora_efectiva_mins), 2) AS max,
      round(avg(atraso_vs_compromiso_mins), 2) AS promedio_atraso,
      round(
        (count(*) FILTER (WHERE atraso_vs_compromiso_mins <= 0))::numeric
        / nullif(count(*) FILTER (WHERE atraso_vs_compromiso_mins IS NOT NULL), 0),
        4
      ) AS on_time_pct
    FROM prev
  ),
  serie_calc AS (
    SELECT
      CASE v_ventana
        WHEN 'diario'  THEN fecha
        WHEN 'semanal' THEN date_trunc('week', fecha)::date
        ELSE date_trunc('month', fecha)::date
      END AS periodo,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      count(*) AS cantidad
    FROM win
    WHERE fecha BETWEEN v_trend_start AND v_hasta
    GROUP BY 1
    ORDER BY 1
  ),
  por_tipo_calc AS (
    SELECT
      tipo_servicio,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      count(*) AS cantidad
    FROM sel
    GROUP BY tipo_servicio
    ORDER BY tipo_servicio
  ),
  ranking_calc AS (
    SELECT
      CASE v_dimension
        WHEN 'chofer' THEN coalesce(nullif(trim(chofer), ''), '(sin chofer)')
        WHEN 'movil'  THEN CASE WHEN movil IS NULL OR movil = 0 THEN '(sin móvil)' ELSE movil::text END
        ELSE               CASE WHEN zona_nro IS NULL THEN '(sin zona)' ELSE zona_nro::text END
      END AS valor,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS mediana,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      count(*) AS cantidad,
      round(avg(atraso_vs_compromiso_mins), 2) AS atraso
    FROM sel
    GROUP BY 1
    ORDER BY promedio ASC
  )
  SELECT jsonb_build_object(
    'escenario_sel', v_esc,
    'escenarios', v_escenarios,
    'rango', jsonb_build_object('min_fecha', v_min, 'max_fecha', v_max),
    'periodo_sel', jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'kpis', (SELECT to_jsonb(k) FROM kpis_sel k),
    'kpis_prev', (SELECT to_jsonb(k) FROM kpis_prev_calc k),
    'serie', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM serie_calc s), '[]'::jsonb),
    'por_tipo', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM por_tipo_calc t), '[]'::jsonb),
    'ranking', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM ranking_calc r), '[]'::jsonb),
    'comparativa', v_comparativa
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION metricas_dashboard(jsonb) IS
  'Lectura agregada POR ESCENARIO para /dashboard/metricas-cumplimiento. El atraso (promedio_atraso, on_time_pct, ranking.atraso) se mide contra fch_hora_max_ent_comp (compromiso/SLA), NO contra fch_hora_para (que es la hora de alta). Percentiles exactos. Acceso exclusivo service_role. Fail-closed si p.empresas = [].';

REVOKE EXECUTE ON FUNCTION metricas_dashboard(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_dashboard(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_dashboard(jsonb) TO service_role;


-- =====================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- =====================================================================
-- 1) Cobertura del backfill (esperado: ~100% con compromiso; el resto son
--    los pocos registros que el origen trae sin max_ent_comp):
--    SELECT count(*) AS total,
--           count(fch_hora_max_ent_comp) AS con_compromiso,
--           round(100.0*count(fch_hora_max_ent_comp)/count(*), 2) AS pct
--      FROM metricas_cumplimiento;
--
-- 2) EL NÚMERO QUE MOTIVÓ TODO ESTO — antes 0,14%, ahora debería rondar 75-80%:
--    SELECT round(100.0 * count(*) FILTER (WHERE atraso_vs_compromiso_mins <= 0)
--                 / nullif(count(atraso_vs_compromiso_mins),0), 1) AS pct_a_tiempo,
--           round(avg(atraso_vs_compromiso_mins), 1)               AS atraso_prom_min,
--           round(avg(atraso_vs_para_mins), 1)                     AS desde_alta_prom_min
--      FROM metricas_cumplimiento;
--
-- 3) Ningún hecho perdido (el backfill fue UPDATE, no DELETE) -> 168315:
--    SELECT count(*) FROM metricas_cumplimiento;
--
-- 4) La RPC ya reporta el on_time_pct correcto:
--    SELECT metricas_dashboard('{"escenario":1000}'::jsonb) -> 'kpis';
-- =====================================================================
