-- =====================================================================
-- Cron del motor de demora + retencion
-- Fecha: 2026-07-29 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- El cron dispara cada 10 minutos LAS 24 HORAS a proposito: la ventana
-- 07:00-23:30 la evalua demoras_calcular_run internamente. Ver el header
-- de esa funcion para el motivo (UTC vs Montevideo).
-- =====================================================================
SELECT cron.unschedule('demoras-calcular')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demoras-calcular');
SELECT cron.schedule('demoras-calcular', '*/10 * * * *',
  $cron$ SELECT demoras_calcular_run(); $cron$);

-- Retencion: 180 dias de detalle. ~25.000 filas/dia -> ~4,5M en regimen.
-- Se eligio 180 y no 30 para poder comparar contra el AS400 sobre media
-- temporada, no sobre un mes suelto.
SELECT cron.unschedule('demoras-purga')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demoras-purga');
SELECT cron.schedule('demoras-purga', '43 4 * * *',
  $cron$ DELETE FROM demoras_calculadas WHERE corrida_at < now() - interval '180 days'; $cron$);

-- ─── Verificacion ────────────────────────────────────────────────────
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
-- SELECT count(*), min(corrida_at), max(corrida_at) FROM demoras_calculadas;

-- ─── Diagnostico: que el cron siga corriendo con exito, no solo programado ──
-- Un job en cron.job con active=true puede estar fallando en silencio cada
-- 10 minutos (los cuerpos plpgsql no se validan al crearse, solo al
-- ejecutar). Estas queries son la forma de notarlo:
--
-- SELECT runid, status, start_time, end_time, return_message
--   FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-calcular')
--  ORDER BY start_time DESC LIMIT 20;
--
-- SELECT runid, status, start_time, end_time, return_message
--   FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-purga')
--  ORDER BY start_time DESC LIMIT 10;
--
-- -- La retencion de 180 dias esta funcionando si la fila mas vieja no la supera:
-- SELECT min(corrida_at) AS mas_vieja, now() - min(corrida_at) AS antiguedad
--   FROM demoras_calculadas;
