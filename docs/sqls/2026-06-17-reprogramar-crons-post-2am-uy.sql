-- =====================================================================
-- Reprogramación de TODOS los pg_cron jobs a la franja posterior a las 02:00 UY
--
-- MOTIVO:
--   Los jobs corrían entre 00:00 y 01:45 UY. A esa hora todavía puede haber
--   actividad operativa (servicio nocturno), y correr limpiezas + rebuild
--   mientras se escribe en las tablas puede generar inconsistencias.
--   Se mueven todos a 02:00–03:00 UY, cuando la actividad ya bajó.
--
-- ZONA HORARIA:
--   pg_cron corre en UTC. Uruguay = UTC-3 (sin DST desde 2015).
--   02:00 UY = 05:00 UTC.
--
-- NOTA sobre moviles_dia_rollover:
--   Mover el rollover a las 02:05 UY es seguro. Las filas de moviles_dia del
--   día nuevo las crean los triggers (trg_moviles_to_dia_fn / trg_gps_to_dia_fn)
--   por actividad en vivo (UPSERT). El rollover es sólo un rebuild de
--   completitud (rellena móviles sin actividad + recomputa contadores).
--
-- IDEMPOTENCIA:
--   cron.schedule() con un jobname existente ACTUALIZA el job (schedule + command)
--   conservando su jobid. Re-ejecutar este script es seguro.
--
-- APLICACIÓN: pegar en Supabase → SQL Editor y ejecutar.
-- =====================================================================

-- Nueva grilla (UTC → UY):
--   0 5 * * *  → 02:00   cleanup-gps-latest-positions
--   5 5 * * *  → 02:05   moviles_dia_rollover
--   15 5 * * * → 02:15   cleanup-gps-tracking-history
--   30 5 * * * → 02:30   cleanup-pedidos
--   45 5 * * * → 02:45   cleanup-services
--   0 6 * * *  → 03:00   cleanup-logflare

SELECT cron.schedule(
  'cleanup-gps-latest-positions',
  '0 5 * * *',                                   -- 05:00 UTC = 02:00 UY
  $$ SELECT cleanup_gps_latest_positions() $$
);

SELECT cron.schedule(
  'moviles_dia_rollover',
  '5 5 * * *',                                   -- 05:05 UTC = 02:05 UY
  $$ SELECT fn_moviles_dia_rebuild(current_date, current_date, NULL) $$
);

SELECT cron.schedule(
  'cleanup-gps-tracking-history',
  '15 5 * * *',                                  -- 05:15 UTC = 02:15 UY
  $$ SELECT * FROM public.cleanup_gps_tracking_history_auto() $$
);

SELECT cron.schedule(
  'cleanup-pedidos',
  '30 5 * * *',                                  -- 05:30 UTC = 02:30 UY
  $$ SELECT * FROM public.cleanup_pedidos_auto() $$
);

SELECT cron.schedule(
  'cleanup-services',
  '45 5 * * *',                                  -- 05:45 UTC = 02:45 UY
  $$ SELECT * FROM public.cleanup_services_auto() $$
);

SELECT cron.schedule(
  'cleanup-logflare',
  '0 6 * * *',                                   -- 06:00 UTC = 03:00 UY
  $$ SELECT * FROM public.cleanup_logflare_auto() $$
);

-- =====================================================================
-- VERIFICACIÓN — correr después de aplicar:
--   SELECT jobid, jobname, schedule, command, active
--   FROM cron.job
--   ORDER BY schedule;
-- Esperado: las 6 schedules arriba, todas con hora 5 o 6 UTC.
-- =====================================================================
