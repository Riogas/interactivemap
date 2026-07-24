-- =====================================================================
-- Métricas de cumplimiento — versión SQL PURA (sin endpoint / sin HTTP)
-- Fecha: 2026-07-24 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Ahora el chofer sale de pedidos/services.fletero (mismo dato que daba el
-- endpoint externo getSessionData), así que TODO el cálculo se puede hacer
-- adentro de Postgres. Esta migración crea la función metricas_cumplimiento_run
-- y reprograma el cron para que la llame directo — se retira el net.http_post.
--
-- Reglas replicadas de lib/metricas/*.ts:
--  - Cumplido genuino: estado_nro=2 AND sub_estado_nro=3 AND no cancelado
--    AND fch_hora_finalizacion NOT NULL.
--  - tipo_servicio: SERVICE (origen services); si no, URGENTE/NOCTURNO (match
--    exacto) / ESPECIAL (empieza con 'ESPECIAL') / OTROS.
--  - demora: CAMPO (fin - fch_hora_asignado) si existe; si no, DERIVADO
--    (= demora_movil_desde_asignacion_mins). Se excluye si no hay ninguno de
--    los dos, o si la demora bruta es negativa.
--  - demora_efectiva: regla de agendados. Si asignado(+implícito) + 60min < para
--    → reloj=PARA, efectiva = max(0, fin - para); si no → reloj=ASIGNADO,
--    efectiva = demora bruta.
--  - atraso_vs_para: fin - para (con signo), null si no hay para.
--  - fecha: día de fch_hora_finalizacion en America/Montevideo.
--  - chofer: fletero (trim; '' → null).
-- =====================================================================

CREATE OR REPLACE FUNCTION metricas_cumplimiento_run(p_desde date, p_hasta date)
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_insertados bigint;
BEGIN
  -- Purga del rango de fecha a recomputar (así los que dejaron de calificar
  -- —p.ej. cambiaron de sub_estado— desaparecen). El DELETE + INSERT corre en
  -- la misma transacción de la función: es atómico.
  DELETE FROM metricas_cumplimiento WHERE fecha BETWEEN p_desde AND p_hasta;

  WITH src AS (
    SELECT 'PEDIDO'::text AS origen, id AS pedido_id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           demora_movil_desde_asignacion_mins
    FROM pedidos
    WHERE estado_nro = 2 AND sub_estado_nro = 3
      AND coalesce(orden_cancelacion, 'N') <> 'S'
      AND escenario IS NOT NULL
      AND fch_hora_finalizacion IS NOT NULL
      AND (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT 'SERVICE', id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           demora_movil_desde_asignacion_mins
    FROM services
    WHERE estado_nro = 2 AND sub_estado_nro = 3
      AND coalesce(orden_cancelacion, 'N') <> 'S'
      AND escenario IS NOT NULL
      AND fch_hora_finalizacion IS NOT NULL
      AND (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
  ),
  calc AS (
    SELECT
      origen, pedido_id, escenario,
      (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date AS fecha,
      CASE
        WHEN origen = 'SERVICE'                                 THEN 'SERVICE'
        WHEN upper(trim(servicio_nombre)) = 'URGENTE'           THEN 'URGENTE'
        WHEN upper(trim(servicio_nombre)) = 'NOCTURNO'          THEN 'NOCTURNO'
        WHEN upper(trim(servicio_nombre)) LIKE 'ESPECIAL%'      THEN 'ESPECIAL'
        ELSE 'OTROS'
      END AS tipo_servicio,
      servicio_nombre, movil, zona_nro, empresa_fletera_id,
      nullif(trim(fletero), '') AS chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
      CASE
        WHEN fch_hora_asignado IS NOT NULL                          THEN 'CAMPO'
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL         THEN 'DERIVADO'
        ELSE NULL
      END AS asignado_source,
      -- demora bruta (minutos)
      CASE
        WHEN fch_hora_asignado IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_asignado)) / 60.0
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL
          THEN demora_movil_desde_asignacion_mins::numeric
        ELSE NULL
      END AS demora_bruta,
      -- asignado efectivo: real (CAMPO) o reconstruido (DERIVADO = fin - demora)
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
      (asignado_efectivo IS NOT NULL AND fch_hora_para IS NOT NULL
        AND asignado_efectivo + interval '60 minute' < fch_hora_para) AS es_agendado,
      CASE WHEN fch_hora_para IS NOT NULL
        THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_para)) / 60.0
        ELSE NULL END AS atraso_bruto
    FROM calc
  ),
  ins AS (
    INSERT INTO metricas_cumplimiento (
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
      demora_mins, demora_efectiva_mins, atraso_vs_para_mins, reloj_inicio, asignado_source
    )
    SELECT
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      CASE WHEN asignado_source = 'CAMPO' THEN fch_hora_asignado ELSE NULL END,
      fch_hora_finalizacion, fch_hora_para,
      round(demora_bruta, 2),
      round(CASE WHEN es_agendado THEN greatest(0, atraso_bruto) ELSE demora_bruta END, 2),
      round(atraso_bruto, 2),
      CASE WHEN es_agendado THEN 'PARA' ELSE 'ASIGNADO' END,
      asignado_source
    FROM eff
    WHERE asignado_source IS NOT NULL   -- excluye sin_asignado_calculable
      AND demora_bruta >= 0             -- excluye demora_negativa
    ON CONFLICT (origen, pedido_id, escenario) DO UPDATE SET
      fecha                 = EXCLUDED.fecha,
      tipo_servicio         = EXCLUDED.tipo_servicio,
      servicio_nombre       = EXCLUDED.servicio_nombre,
      movil                 = EXCLUDED.movil,
      zona_nro              = EXCLUDED.zona_nro,
      empresa_fletera_id    = EXCLUDED.empresa_fletera_id,
      chofer                = EXCLUDED.chofer,
      fch_hora_asignado     = EXCLUDED.fch_hora_asignado,
      fch_hora_finalizacion = EXCLUDED.fch_hora_finalizacion,
      fch_hora_para         = EXCLUDED.fch_hora_para,
      demora_mins           = EXCLUDED.demora_mins,
      demora_efectiva_mins  = EXCLUDED.demora_efectiva_mins,
      atraso_vs_para_mins   = EXCLUDED.atraso_vs_para_mins,
      reloj_inicio          = EXCLUDED.reloj_inicio,
      asignado_source       = EXCLUDED.asignado_source
    RETURNING 1
  )
  SELECT count(*) INTO v_insertados FROM ins;

  RETURN v_insertados;
END;
$fn$;

COMMENT ON FUNCTION metricas_cumplimiento_run(date, date) IS
  'Recomputa metricas_cumplimiento para el rango [p_desde, p_hasta] (fecha en America/Montevideo). Chofer sale de fletero. Reemplaza al endpoint POST /api/metricas/cumplimiento/run. Devuelve la cantidad de hechos escritos.';

-- =====================================================================
-- Reprogramar el cron: llamar la función directo (adiós net.http_post).
-- Rango por defecto = día cerrado anterior + 3 días de reproceso (igual que
-- el defaultRunRange del código: [hoy-3, hoy-1] en Montevideo).
-- 03:15 UTC = 00:15 UY.
-- =====================================================================
SELECT cron.unschedule('metricas-cumplimiento-run')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'metricas-cumplimiento-run');

SELECT cron.schedule(
  'metricas-cumplimiento-run',
  '15 3 * * *',
  $cron$
  SELECT metricas_cumplimiento_run(
    ((now() AT TIME ZONE 'America/Montevideo')::date - 3),
    ((now() AT TIME ZONE 'America/Montevideo')::date - 1)
  );
  $cron$
);

-- ─── Backfill (una vez, instantáneo, todo interno) ────────────────────
--   SELECT metricas_cumplimiento_run('2026-06-24','2026-07-23');
--
-- ─── Verificación ─────────────────────────────────────────────────────
--   SELECT tipo_servicio, count(*), round(avg(demora_efectiva_mins),1)
--   FROM metricas_cumplimiento GROUP BY tipo_servicio ORDER BY 1;
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname='metricas-cumplimiento-run';
