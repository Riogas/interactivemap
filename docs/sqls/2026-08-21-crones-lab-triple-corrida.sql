-- ====================================================================
-- Los cuatro crones del laboratorio corrian TRES VECES cada noche
-- Fecha: 2026-08-21
-- ====================================================================
-- SINTOMA VISIBLE: el job `demoras-lab-optimizador-noct` (04:30) fallo con
--     ERROR: pldbgapi2 statement call stack is broken
--     CONTEXT: PL/pgSQL function demoras_simular_dia(...) line 16
-- a los 4,5 s de arrancar. La noche anterior habia corrido perfecto.
--
-- CAUSA RAIZ (medida, no deducida): los cuatro jobs de la madrugada estan
-- escritos como
--     SELECT demoras_variantes_optimizar(escenario_id, 7, 25) FROM demoras_modelo
-- Eso se escribio cuando demoras_modelo tenia UNA fila por escenario. Desde la
-- migracion del 18/8 (parametria por escenario Y tipo de servicio) tiene TRES
-- -- URGENTE, NOCTURNO y SERVICE -- todas con el mismo escenario_id, asi que
-- cada job pasa a ejecutar la MISMA busqueda tres veces.
--
-- La duracion lo confirma sin lugar a dudas (cron.job_run_details):
--     evaluador    12-18/8: 5,5 a 6,6 s  (1 row)  ->  19-21/8: 17,6 a 19,0 s (3 rows)
--     optimizador  12-18/8:  583 a 615 s (1 row)  ->  19-21/8: 1775 a 1802 s (3 rows)
-- Exactamente 3x, y el escalon cae justo en el dia de aquella migracion.
--
-- Y de ahi sale la falla del nocturno: el optimizador de urgente arranca 04:00
-- y el de nocturno 04:30. Con una sola corrida el primero terminaba 04:10 y
-- sobraban 20 minutos. Con la corrida triple pasa a durar ~30 min y queda al
-- borde: el 20/8 termino 04:29:34 (25 s de margen, el nocturno anduvo) y el
-- 21/8 termino 04:30:01, DOS SEGUNDOS DESPUES de que arrancara el nocturno --
-- y el nocturno murio a los 4,5 s. Un solapamiento de 2 s alcanza porque los
-- dos entran a la vez a demoras_simular_dia y el plugin de depuracion de
-- PL/pgSQL (pldbgapi2) pierde el hilo de la pila.
-- (La relacion solapamiento -> fallo es UNA observacion, no una demostracion.
-- El arreglo se justifica igual por si solo: correr tres veces la misma
-- busqueda es puro desperdicio, y dos jobs de 30 minutos separados por 30
-- minutos es un error de diseno con o sin plugin de por medio.)
--
-- ARREGLO: que cada job itere ESCENARIOS, no filas de parametria.
-- Con `SELECT DISTINCT escenario_id` vuelve a ser una llamada por escenario,
-- sigue andando si manana hay mas de un escenario, y el optimizador vuelve a
-- ~10 minutos -- con lo que el solapamiento desaparece solo y no hace falta
-- tocar ningun horario.
--
-- VERIFICADO ANTES DE APLICAR (dry run revertido a proposito): se corrio
--     PERFORM demoras_variantes_evaluar(date '2026-08-20', escenario_id)
--        FROM (SELECT DISTINCT escenario_id FROM demoras_modelo) m;
-- -> ROW_COUNT = 1 (antes 3) y la comparacion EXCEPT ALL contra las 78 filas
-- ya guardadas del 20/8 dio CERO diferencias en todas las columnas de datos
-- (la unica que cambia es calculado_at, que es la marca de hora de la corrida).
-- ====================================================================

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'demoras-lab-evaluador'),
  command => $cmd$SELECT demoras_variantes_evaluar((now() AT TIME ZONE 'America/Montevideo')::date - 1, escenario_id) FROM (SELECT DISTINCT escenario_id FROM demoras_modelo) m$cmd$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'demoras-lab-evaluador-noct'),
  command => $cmd$SELECT demoras_variantes_evaluar((now() AT TIME ZONE 'America/Montevideo')::date - 1, escenario_id, 'NOCTURNO') FROM (SELECT DISTINCT escenario_id FROM demoras_modelo) m$cmd$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'demoras-lab-optimizador'),
  command => $cmd$SELECT demoras_variantes_optimizar(escenario_id, 7, 25) FROM (SELECT DISTINCT escenario_id FROM demoras_modelo) m$cmd$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'demoras-lab-optimizador-noct'),
  command => $cmd$SELECT demoras_variantes_optimizar(escenario_id, 7, 25, 'NOCTURNO') FROM (SELECT DISTINCT escenario_id FROM demoras_modelo) m$cmd$
);
