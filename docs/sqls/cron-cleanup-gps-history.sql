-- =====================================================================
-- 🧹 CRON: Limpiar gps_tracking_history periódicamente
-- =====================================================================
--
-- PROPÓSITO:
--   La tabla gps_tracking_history crece constantemente con cada coordenada
--   reportada por los móviles. Este job elimina registros antiguos para
--   mantener la base de datos liviana.
--
-- CONFIGURACIÓN:
--   Cambiar el valor de retention_days en la función para ajustar
--   cuántos días de historial conservar.
--
--   Cambiar la cron expression en cron.schedule para ajustar
--   cada cuánto corre la limpieza.
--
-- REQUISITO: Extensión pg_cron habilitada en Supabase
--   (Dashboard → Database → Extensions → buscar "pg_cron" → Enable)
-- =====================================================================

-- 1️⃣ Crear la función de limpieza con retención configurable
CREATE OR REPLACE FUNCTION cleanup_gps_tracking_history(retention_days INT DEFAULT 7)
RETURNS TABLE(deleted_rows BIGINT, oldest_remaining TIMESTAMPTZ) AS $$
DECLARE
    cutoff_date TIMESTAMPTZ;
    deleted_count BIGINT;
    oldest_row TIMESTAMPTZ;
BEGIN
    cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;

    -- Borrar en lotes para no bloquear la tabla
    -- (si hay millones de filas, un DELETE masivo puede ser lento)
    WITH deleted AS (
        DELETE FROM gps_tracking_history
        WHERE fecha_hora < cutoff_date
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;

    -- Obtener la fecha más antigua que quedó
    SELECT MIN(fecha_hora) INTO oldest_row FROM gps_tracking_history;

    RAISE LOG '[CRON] cleanup_gps_tracking_history: % filas eliminadas (anteriores a %). Registro más antiguo restante: %',
        deleted_count, cutoff_date, oldest_row;

    RETURN QUERY SELECT deleted_count, oldest_row;
END;
$$ LANGUAGE plpgsql;

-- 2️⃣ Programar el cron job
-- Primero eliminar si ya existe
SELECT cron.unschedule('cleanup-gps-tracking-history')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-gps-tracking-history'
);

-- Corre cada domingo a las 04:00 UTC (01:00 hora Uruguay)
-- Conserva los últimos 7 días de historial
--
-- 🔧 PARA CAMBIAR LA FRECUENCIA, modificar la cron expression:
--   '0 4 * * 0'    → cada domingo a las 04:00 UTC (SEMANAL - actual)
--   '0 4 * * *'    → todos los días a las 04:00 UTC (DIARIO)
--   '0 4 1 * *'    → el 1ro de cada mes a las 04:00 UTC (MENSUAL)
--   '0 4 */3 * *'  → cada 3 días a las 04:00 UTC
--   '0 4 * * 0,3'  → domingos y miércoles a las 04:00 UTC (2x semana)
--
-- 🔧 PARA CAMBIAR LA RETENCIÓN, modificar el parámetro de la función:
--   cleanup_gps_tracking_history(7)   → conservar 7 días (actual)
--   cleanup_gps_tracking_history(14)  → conservar 14 días
--   cleanup_gps_tracking_history(30)  → conservar 30 días
--   cleanup_gps_tracking_history(1)   → conservar solo hoy

SELECT cron.schedule(
    'cleanup-gps-tracking-history',              -- nombre del job
    '0 4 * * 0',                                 -- cron: domingos 04:00 UTC
    $$ SELECT * FROM cleanup_gps_tracking_history(7) $$  -- retener 7 días
);

-- =====================================================================
-- 📋 VERIFICACIÓN Y ADMINISTRACIÓN
-- =====================================================================
--
-- Ver jobs programados:
--   SELECT jobid, jobname, schedule, command FROM cron.job;
--
-- Ver historial de ejecuciones:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cleanup-gps-tracking-history')
--   ORDER BY start_time DESC LIMIT 10;
--
-- Ejecutar manualmente (conservar 7 días):
--   SELECT * FROM cleanup_gps_tracking_history(7);
--
-- Ejecutar manualmente (conservar 14 días):
--   SELECT * FROM cleanup_gps_tracking_history(14);
--
-- Ver cuántos registros hay por día (para decidir retención):
--   SELECT fecha_hora::date AS dia, COUNT(*) AS registros
--   FROM gps_tracking_history
--   GROUP BY dia ORDER BY dia DESC;
--
-- Ver tamaño de la tabla:
--   SELECT pg_size_pretty(pg_total_relation_size('gps_tracking_history'));
--
-- Cambiar frecuencia (ej: pasar a diario conservando 7 días):
--   SELECT cron.unschedule('cleanup-gps-tracking-history');
--   SELECT cron.schedule(
--       'cleanup-gps-tracking-history',
--       '0 4 * * *',
--       $$ SELECT * FROM cleanup_gps_tracking_history(7) $$
--   );
--
-- Desactivar el job:
--   SELECT cron.unschedule('cleanup-gps-tracking-history');
-- =====================================================================
