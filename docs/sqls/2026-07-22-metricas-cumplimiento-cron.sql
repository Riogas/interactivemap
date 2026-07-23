-- =====================================================================
-- Cron nocturno del job de métricas (pg_cron + pg_net)
-- Fecha: 2026-07-22
-- Corre 03:15 UTC = 00:15 UY (ANTES de las limpiezas cleanup-pedidos/services
-- 02:30/02:45 UY → procesa el día recién cerrado antes de que se purgue el origen).
--
-- REQUISITOS (habilitar en Dashboard → Database → Extensions):
--   - pg_cron   (scheduler)
--   - pg_net    (net.http_post)  ← NO usado antes en este repo, ver doc.
--
-- ⚠️ SEGURIDAD: reemplazar <APP_BASE_URL> y <METRICAS_CRON_TOKEN> al aplicar.
--    NO commitear el token real. Aplicar este bloque manualmente en el
--    SQL Editor con los valores reales; el archivo versionado lleva placeholders.
-- =====================================================================

SELECT cron.schedule(
  'metricas-cumplimiento-run',
  '15 3 * * *',                                 -- 03:15 UTC = 00:15 UY
  $$
  SELECT net.http_post(
    url     := '<APP_BASE_URL>/api/metricas/cumplimiento/run',
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-metricas-token','<METRICAS_CRON_TOKEN>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000              -- 5 min
  );
  $$
);

-- ─── Verificación / administración ────────────────────────────────────
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'metricas-cumplimiento-run';
-- SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='metricas-cumplimiento-run')
--   ORDER BY start_time DESC LIMIT 10;
-- Ver respuesta del POST: SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Desactivar: SELECT cron.unschedule('metricas-cumplimiento-run');
--
-- ─── Alternativa (si pg_net no alcanza la URL de la app) ──────────────
-- Ej: app interna / Supabase self-hosted en otra red. Usar cron de sistema
-- (crontab) en el VPS de la app:
--   15 0 * * * curl -s -X POST -H "x-metricas-token: <METRICAS_CRON_TOKEN>" \
--     <APP_BASE_URL>/api/metricas/cumplimiento/run >> /var/log/metricas-cumplimiento.log 2>&1
-- La lógica del endpoint es idéntica; solo cambia el disparador.
