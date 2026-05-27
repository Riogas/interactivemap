-- =====================================================================
-- CRON: Rollover diario de moviles_dia
-- =====================================================================
--
-- PROPÓSITO:
--   Los triggers de estado (trg_moviles_to_dia) y posición (trg_gps_to_dia)
--   solo escriben filas de current_date. Al pasar la medianoche, las filas
--   del día anterior quedan "congeladas" automáticamente.
--
--   Sin embargo, el primer móvil que dispara un trigger crea SU fila en el
--   nuevo día, pero el resto no aparece hasta que también tenga un evento.
--   Esto significa que al inicio de la jornada moviles_dia puede estar
--   incompleta (faltan los móviles que aún no reportaron).
--
--   Este job garantiza que el nuevo día arranque con TODOS los móviles
--   visibles (mostrar_en_mapa = true) ya presentes en moviles_dia, sin
--   esperar a que cada uno dispare su primer evento.
--
-- MECANISMO:
--   Llama a fn_moviles_dia_rebuild(current_date, current_date) poco después
--   de la medianoche hora Uruguay. La función es idempotente: si alguna fila
--   ya existe (creada por un trigger tempranero) la actualiza sin duplicar.
--
-- ZONA HORARIA:
--   pg_cron corre en UTC. Uruguay = UTC-3 (sin DST desde 2015).
--   03:05 UTC = 00:05 hora Montevideo.
--   Este offset coincide con la convención ya usada en:
--     · cron-cleanup-gps-latest.sql    → '0 3 * * *'  (03:00 UTC = 00:00 UY)
--     · cron-cleanup-gps-history.sql   → '0 4 * * 0'  (04:00 UTC = 01:00 UY)
--   Se elige 03:05 (5 minutos después de la limpieza de gps_latest_positions)
--   para evitar contención simultánea y asegurar que gps_latest_positions
--   esté limpia antes del rebuild.
--
-- REQUISITO: Extensión pg_cron habilitada en Supabase
--   (Dashboard → Database → Extensions → buscar "pg_cron" → Enable)
--   La extensión ya está en uso en este proyecto (ver cron-cleanup-gps-*.sql).
-- =====================================================================

-- 1️⃣ Habilitar extensión pg_cron (si no está habilitada; ya debería estarlo)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2️⃣ Programar el rollover diario
-- Primero eliminar si ya existe (idempotente)
SELECT cron.unschedule('moviles_dia_rollover')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'moviles_dia_rollover'
);

-- Corre todos los días a las 03:05 UTC (00:05 hora Uruguay).
-- Reconstruye moviles_dia para el día actual en todos los escenarios
-- (p_escenario = NULL → todos).
SELECT cron.schedule(
    'moviles_dia_rollover',                                    -- nombre del job
    '5 3 * * *',                                               -- 03:05 UTC = 00:05 UY
    $$ SELECT fn_moviles_dia_rebuild(current_date, current_date, NULL) $$
);

-- =====================================================================
-- 📋 VERIFICACIÓN Y ADMINISTRACIÓN
-- =====================================================================
--
-- Ver jobs programados (incluyendo este):
--   SELECT jobid, jobname, schedule, command, active
--   FROM cron.job
--   ORDER BY jobname;
--
-- Ver historial de ejecuciones del rollover:
--   SELECT runid, status, start_time, end_time, return_message
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'moviles_dia_rollover')
--   ORDER BY start_time DESC
--   LIMIT 10;
--
-- Ejecutar el rollover manualmente (para probar o recuperar):
--   SELECT fn_moviles_dia_rebuild(current_date, current_date, NULL);
--
-- Verificar que el rollover pobló todos los móviles visibles:
--   SELECT
--     (SELECT count(*) FROM moviles_dia WHERE fecha = current_date) AS en_moviles_dia,
--     (SELECT count(*) FROM moviles WHERE mostrar_en_mapa = true)   AS visibles_en_moviles;
--   -- Esperado: en_moviles_dia >= visibles_en_moviles
--   -- (puede haber más si hay móviles con operación/GPS pero sin mostrar_en_mapa).
--
-- Desactivar temporalmente el job:
--   UPDATE cron.job SET active = false WHERE jobname = 'moviles_dia_rollover';
--
-- Reactivar:
--   UPDATE cron.job SET active = true WHERE jobname = 'moviles_dia_rollover';
--
-- Eliminar el job:
--   SELECT cron.unschedule('moviles_dia_rollover');
--
-- Cambiar la hora (ej: correr a las 04:00 UTC = 01:00 UY):
--   SELECT cron.unschedule('moviles_dia_rollover');
--   SELECT cron.schedule(
--       'moviles_dia_rollover',
--       '0 4 * * *',
--       $$ SELECT fn_moviles_dia_rebuild(current_date, current_date, NULL) $$
--   );
-- =====================================================================
