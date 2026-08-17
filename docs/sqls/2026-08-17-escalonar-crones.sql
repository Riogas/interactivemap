-- ====================================================================
-- Escalonar los crones del laboratorio (pg_cron)
-- Fecha: 2026-08-17 | Idempotente | Aplicado via pg-meta.
-- ====================================================================
--
-- Motivo (finde 15-16/8): seis rafagas de "job startup timeout" en 48 h.
-- Los tres jobs del laboratorio corrian '* * * * *' y el motor '*/10':
-- cada minuto TRES conexiones arrancan en el MISMO segundo (y cuatro en
-- los multiplos de 10). Con cron.use_background_workers=off, pg_cron da
-- ~10 s para conectar; un apreton momentaneo del server mata a todos los
-- que estan arrancando dentro de esa ventana. Cinco rafagas fueron
-- inocuas (el minuto siguiente se recuperan solos); la de las 16:10 del
-- domingo se llevo TAMBIEN al motor: hueco de corridas de 20 minutos
-- (16:00 -> 16:20), el unico del fin de semana.
--
-- Arreglo: los tres jobs del laboratorio pasan de cron por minuto a
-- intervalos en segundos PRIMOS entre si (47 / 53 / 59). Los intervalos
-- de pg_cron no se alinean al minuto (corren "cada N segundos desde el
-- ultimo arranque") y con periodos coprimos las fases se desparraman
-- solas: la estampida sincronizada pasa a ser coincidencia rara. La
-- cadencia queda ~igual (levemente mas frecuente; los tres son baratos y
-- casi siempre no-op: la captura real de la caja negra la hace el
-- TRIGGER en la misma transaccion de la corrida, el job es solo red).
--
-- El MOTOR (demoras-calcular, '*/10 * * * *') NO se toca: la grilla de
-- corridas en :00/:10/:20... es contrato de pantallas y mediciones.
-- Riesgo residual: un apreton justo en un multiplo de 10' puede matarlo
-- igual que siempre — pero ya no arrastrado por la estampida del lab.
--
-- Requiere pg_cron >= 1.5 (sintaxis 'N seconds'); en prod hay 1.6.
-- ROLLBACK: volver los tres a '* * * * *' con cron.alter_job.
-- ====================================================================

DO $$
DECLARE
  v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'demoras-caja-negra';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '47 seconds');
  END IF;

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'demoras-variantes';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '53 seconds');
  END IF;

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'demoras-lab-reproceso';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '59 seconds');
  END IF;
END $$;

-- Verificacion (correr aparte):
-- 1) SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'demoras-%' ORDER BY jobname;
-- 2) En unos minutos, arranques desparramados y en 'succeeded':
--    SELECT j.jobname, d.status, to_char(d.start_time,'HH24:MI:SS') AS arranque
--    FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
--    WHERE d.start_time > now() - interval '5 minutes'
--      AND j.jobname IN ('demoras-caja-negra','demoras-variantes','demoras-lab-reproceso')
--    ORDER BY d.start_time;
-- 3) El espejo sigue: difs campeon = 0 en la ultima corrida y desfase de
--    captura max 0 s en demoras_corrida_meta del dia.
