-- =====================================================================
-- BACKFILL NOCTURNO DEL DESFASAJE — job one-shot auto-desprogramable
-- Fecha: 2026-08-03 | Idempotente | Requiere: 2026-08-03-desfasaje-demoras
-- (pasos 1-4 = DDL + run v4 + RPC, ya aplicados) y sus pasos 5a-5d ya
-- corridos (solo tocan hechos, sin efectos de realtime).
--
-- POR QUÉ ASÍ: los pasos pesados que faltan (5e: crear hechos de
-- 2026-03-23..primer-hecho vía el run, que además espeja pedidos; 5f:
-- espejo masivo de jun..ago) escriben cientos de miles de filas de
-- `pedidos` — tabla con triggers y publicación realtime. Correrlos de día
-- inunda a los clientes conectados, y correrlos en UNA transacción desde
-- el SQL Editor revienta su timeout (pasó el 2026-08-03). Este job corre
-- vía pg_cron CADA MINUTO entre 01:00 y 05:59 UY, hace UN chunk por
-- invocación (transacciones chicas, bursts chicos, sin timeout de
-- Studio) y AL TERMINAR SE DESPROGRAMA SOLO.
--
-- Monitoreo:
--   SELECT * FROM metricas_desfasaje_backfill_estado ORDER BY done_at;
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--    WHERE command LIKE '%desfasaje_backfill%'
--    ORDER BY start_time DESC LIMIT 10;
-- Al completar: la fila paso='completo' existe y el job ya no está en
-- cron.job. Re-pegar este archivo NO repite trabajo (el estado manda);
-- para forzar un re-backfill: borrar las filas de estado.
-- =====================================================================

CREATE TABLE IF NOT EXISTS metricas_desfasaje_backfill_estado (
  paso    text PRIMARY KEY,
  detalle text,
  done_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON metricas_desfasaje_backfill_estado FROM anon, authenticated;
GRANT  ALL ON metricas_desfasaje_backfill_estado TO service_role;

CREATE OR REPLACE FUNCTION metricas_desfasaje_backfill_step()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  -- El origen llega a fines de marzo (services 2026-03-26, pedidos antes
  -- de abril): 2026-03-23 (lunes) cubre todo lo que hay.
  v_ini    constant date := DATE '2026-03-23';
  r        record;
  v_n      bigint;
  v_cursor date;
  v_desde  date;
  v_hasta  date;
BEGIN
  -- Candado: si el chunk anterior sigue corriendo (>1 min), esta
  -- invocación sale sin pisar nada.
  IF NOT pg_try_advisory_xact_lock(hashtext('metricas_desfasaje_backfill')) THEN
    RETURN 'ocupado: corrida anterior todavia en curso';
  END IF;

  -- ── 5e: hechos de la pre-historia, UNA SEMANA por invocación ─────────
  -- De la fecha más nueva hacia atrás. El run v4 hace el espejo de esa
  -- semana adentro, así que acá no hay 5f para estos rangos. El cursor
  -- vive en el estado: si una semana no tiene origen (0 hechos) igual
  -- avanza — sin cursor, min(fecha) no bajaría y esto loopearía.
  SELECT nullif(e.detalle, '')::date INTO v_cursor
    FROM metricas_desfasaje_backfill_estado e WHERE e.paso = '5e-cursor';
  IF v_cursor IS NULL THEN
    SELECT coalesce(min(fecha), v_ini) INTO v_cursor FROM metricas_cumplimiento;
    INSERT INTO metricas_desfasaje_backfill_estado (paso, detalle)
    VALUES ('5e-cursor', v_cursor::text)
    ON CONFLICT (paso) DO UPDATE SET detalle = EXCLUDED.detalle, done_at = now();
  END IF;

  IF v_cursor > v_ini THEN
    v_hasta := v_cursor - 1;
    v_desde := greatest(v_ini, v_cursor - 7);
    v_n := metricas_cumplimiento_run(v_desde, v_hasta);
    UPDATE metricas_desfasaje_backfill_estado
       SET detalle = v_desde::text, done_at = now()
     WHERE paso = '5e-cursor';
    RETURN format('5e %s..%s -> %s hechos', v_desde, v_hasta, v_n);
  END IF;

  -- ── 5f: espejo de los hechos que YA existían antes del backfill ──────
  -- (jun..ago; las semanas de 5e ya quedaron espejadas por el run).
  -- UN MES por invocación. Mismo cuerpo que el paso 5f de la migración,
  -- acotado por fecha.
  FOR r IN
    SELECT * FROM (VALUES
      ('5f-2026-06', DATE '2026-06-01', DATE '2026-06-30'),
      ('5f-2026-07', DATE '2026-07-01', DATE '2026-07-31'),
      ('5f-2026-08', DATE '2026-08-01', DATE '2026-08-31')
    ) AS t(paso, d1, d2)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM metricas_desfasaje_backfill_estado e WHERE e.paso = r.paso) THEN
      UPDATE pedidos p
         SET desfasaje_informado_mins    = m.desfasaje_informado_mins,
             demora_proyectada_calc_mins = m.demora_proyectada_calc_mins,
             corrida_calc_at             = m.corrida_calc_at,
             desfasaje_calc_mins         = m.desfasaje_calc_mins
        FROM metricas_cumplimiento m
       WHERE m.origen = 'PEDIDO'
         AND m.fecha BETWEEN r.d1 AND r.d2
         AND (m.desfasaje_informado_mins IS NOT NULL OR m.desfasaje_calc_mins IS NOT NULL)
         AND p.id        = m.pedido_id
         AND p.escenario = m.escenario
         AND (   p.desfasaje_informado_mins    IS DISTINCT FROM m.desfasaje_informado_mins
              OR p.demora_proyectada_calc_mins IS DISTINCT FROM m.demora_proyectada_calc_mins
              OR p.corrida_calc_at             IS DISTINCT FROM m.corrida_calc_at
              OR p.desfasaje_calc_mins         IS DISTINCT FROM m.desfasaje_calc_mins);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      INSERT INTO metricas_desfasaje_backfill_estado (paso, detalle)
      VALUES (r.paso, v_n || ' pedidos espejados');
      RETURN format('%s -> %s pedidos espejados', r.paso, v_n);
    END IF;
  END LOOP;

  -- ── Listo: desprogramarse y dejar constancia ─────────────────────────
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('desfasaje-backfill');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- ya estaba desprogramado
    END;
  END IF;
  INSERT INTO metricas_desfasaje_backfill_estado (paso, detalle)
  VALUES ('completo', 'backfill terminado')
  ON CONFLICT (paso) DO UPDATE SET done_at = now();
  RETURN 'COMPLETO';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION metricas_desfasaje_backfill_step() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_desfasaje_backfill_step() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_desfasaje_backfill_step() TO service_role;

-- ── Programar el one-shot: cada minuto de 04:00-08:59 UTC = 01:00-05:59
-- UY. ~14 invocaciones útiles (10 semanas de 5e + 3 meses de 5f + el
-- COMPLETO que desprograma); el resto de la ventana no llega a usarse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('desfasaje-backfill');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule('desfasaje-backfill', '* 4-8 * * *',
                          'SELECT metricas_desfasaje_backfill_step()');
    RAISE NOTICE 'desfasaje-backfill programado: esta madrugada 01:00-05:59 UY, un chunk por minuto, se desprograma solo al terminar';
  ELSE
    RAISE NOTICE 'sin pg_cron (harness): correr SELECT metricas_desfasaje_backfill_step() en loop hasta COMPLETO';
  END IF;
END $$;
