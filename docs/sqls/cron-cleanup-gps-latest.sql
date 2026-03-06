-- =====================================================================
-- 🧹 CRON: Limpiar gps_latest_positions cada madrugada
-- =====================================================================
-- 
-- PROPÓSITO:
--   La tabla gps_latest_positions tiene 1 fila por móvil con su ÚLTIMA
--   coordenada conocida. Si un móvil no trabaja al día siguiente, su fila
--   queda con una coordenada vieja y aparecería en el mapa erróneamente.
--
--   Este job borra todas las filas cuya fecha_hora sea anterior al día actual,
--   dejando la tabla limpia para el nuevo día operativo.
--
-- REQUISITO: Extensión pg_cron habilitada en Supabase
--   (Dashboard → Database → Extensions → buscar "pg_cron" → Enable)
--
-- EJECUCIÓN: Corre a las 03:00 AM (UTC) todos los días.
--   Ajustar la hora según la zona horaria operativa (Uruguay = UTC-3,
--   así que 03:00 UTC = 00:00 hora local Uruguay).
-- =====================================================================

-- 1️⃣ Habilitar extensión pg_cron (si no está habilitada)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2️⃣ Crear la función de limpieza
CREATE OR REPLACE FUNCTION cleanup_gps_latest_positions()
RETURNS void AS $$
DECLARE
    deleted_count INT;
BEGIN
    -- Borrar posiciones cuya fecha_hora sea anterior al inicio del día actual (UTC)
    DELETE FROM gps_latest_positions
    WHERE fecha_hora < CURRENT_DATE;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RAISE LOG '[CRON] cleanup_gps_latest_positions: % filas eliminadas (posiciones anteriores a %)',
        deleted_count, CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- 3️⃣ Programar el cron job — todos los días a las 03:00 UTC (00:00 Uruguay)
-- Primero eliminar si ya existe
SELECT cron.unschedule('cleanup-gps-latest-positions')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-gps-latest-positions'
);

SELECT cron.schedule(
    'cleanup-gps-latest-positions',          -- nombre del job
    '0 3 * * *',                             -- cron expression: 03:00 UTC diario
    $$ SELECT cleanup_gps_latest_positions() $$
);

-- =====================================================================
-- 📋 VERIFICACIÓN
-- =====================================================================
-- Ver jobs programados:
--   SELECT * FROM cron.job;
--
-- Ver historial de ejecuciones:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- Ejecutar manualmente (para probar):
--   SELECT cleanup_gps_latest_positions();
--
-- Desactivar el job:
--   SELECT cron.unschedule('cleanup-gps-latest-positions');
-- =====================================================================
