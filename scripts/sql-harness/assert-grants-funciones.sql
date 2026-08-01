\set ON_ERROR_STOP on
-- =====================================================================
-- Grants de EXECUTE sobre las funciones del motor de demora
-- (Important 5 del review de la tanda PROXIMO_HUECO; actualizado por el
-- Important 4 y el Important 3 del review final de rama, b7fff6e..64045c2)
--
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto --
-- a diferencia de las tablas, donde hace falta que el proyecto agregue un
-- default privilege para que anon/authenticated tengan algo (00-stubs.sql
-- replica ese comportamiento de Supabase, ver su comentario). Con las
-- funciones no hace falta ningun stub: es el comportamiento de serie de
-- Postgres, y por eso quedaban invocables por anon/authenticated via RPC
-- aunque las tablas que leen esten blindadas.
--
-- Firma exacta de cada una (tiene que coincidir con el REVOKE/GRANT de su
-- propia migracion -- un REVOKE con la firma equivocada no revoca nada):
--   demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean)
--   demoras_cola(integer, date, timestamptz)
--   demoras_ritmo(integer, date)
--   demoras_ritmo_movil(integer, date)
--   demoras_aportes(integer, date)
--   demoras_consumo_tramos(integer, date, timestamptz)
--   demoras_calcular_run(timestamptz)
--   demoras_capacidad(integer, date)
--   demoras_acabado(numeric, numeric, integer, integer, integer, integer, integer)
--
-- demoras_ritmo_muestras gano un septimo parametro (p_hueco_min) en
-- docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql (piso del ritmo, Task 2
-- de la tanda CONSUMO_TRAMOS), que dropea la firma vieja de 6. Sin este
-- update, has_function_privilege sobre la firma vieja no reprueba el
-- assert -- directamente lo hace abortar con "function ... does not exist",
-- porque la firma ya no existe en el catalogo.
--
-- I4 (review final de rama): esta lista listaba demoras_servidores y
-- demoras_proximo_hueco, que 2026-08-01-demoras-legacy-obsoletas.sql marco
-- OBSOLETAS -- sin consumidor desde que el orquestador (v3) dejo de
-- llamarlas, reemplazadas por demoras_aportes y demoras_consumo_tramos. Se
-- sacan de aca (nada las protege menos por eso: siguen con su REVOKE propio
-- de sus tandas originales, este assert solo dejo de listarlas) y entran
-- las dos que las reemplazan.
--
-- I3 (review final de rama): demoras_ritmo, demoras_calcular_run,
-- demoras_capacidad y demoras_acabado no tenian REVOKE/GRANT en ningun
-- archivo -- la guia (DEMORA_INFORMADA.md) documentaba SOLO demoras_ritmo
-- como excepcion conocida y las otras tres ni eso. Las cuatro se cerraron
-- en esa misma tanda de fixes y entran aca: sin este assert, un futuro
-- CREATE OR REPLACE sin el bloque de grants las deja expuestas de nuevo y
-- la regresion sigue en verde -- exactamente la clase de hueco que este
-- archivo existe para cerrar.
--
-- Con esto, TODAS las funciones vivas de la familia demoras_* (las dos
-- obsoletas incluidas, protegidas por sus propias migraciones) tienen su
-- REVOKE/GRANT explicito, y este assert las cubre a todas menos las dos
-- obsoletas (fuera de alcance: no las llama nadie, y dropearlas es una
-- decision de limpieza aparte -- ver docs/sqls/2026-08-01-demoras-legacy-obsoletas.sql).
-- =====================================================================

-- ─── anon y authenticated NO pueden ejecutar ninguna de las nueve ────
DO $$
DECLARE r record; falla text := '';
BEGIN
  FOR r IN
    SELECT f.fn, g.rol
      FROM (VALUES
        ('demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean)'),
        ('demoras_cola(integer, date, timestamptz)'),
        ('demoras_ritmo(integer, date)'),
        ('demoras_ritmo_movil(integer, date)'),
        ('demoras_aportes(integer, date)'),
        ('demoras_consumo_tramos(integer, date, timestamptz)'),
        ('demoras_calcular_run(timestamptz)'),
        ('demoras_capacidad(integer, date)'),
        ('demoras_acabado(numeric, numeric, integer, integer, integer, integer, integer)')
      ) AS f(fn)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rol)
  LOOP
    IF has_function_privilege(r.rol, r.fn, 'EXECUTE') THEN
      falla := falla || format('%s puede EXECUTE %s; ', r.rol, r.fn);
    END IF;
  END LOOP;

  IF falla <> '' THEN
    RAISE EXCEPTION 'privilegios de mas (la anon key vive en el bundle del browser): %', falla;
  END IF;
  RAISE NOTICE 'ok anon y authenticated no pueden ejecutar ninguna de las 9 funciones del motor';
END $$;

-- ─── Control positivo: service_role SI puede ────────────────────────
-- Sin esto, un REVOKE demasiado ancho (o con la firma mal escrita, de
-- forma que no alcance a la funcion real) dejaria al cron y al endpoint
-- sin acceso, y el assert de arriba pasaria igual -- exactamente el mismo
-- razonamiento que el control positivo de assert-config.sql (B6).
DO $$
DECLARE r record; falta text := '';
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean)',
      'demoras_cola(integer, date, timestamptz)',
      'demoras_ritmo(integer, date)',
      'demoras_ritmo_movil(integer, date)',
      'demoras_aportes(integer, date)',
      'demoras_consumo_tramos(integer, date, timestamptz)',
      'demoras_calcular_run(timestamptz)',
      'demoras_capacidad(integer, date)',
      'demoras_acabado(numeric, numeric, integer, integer, integer, integer, integer)'
    ]) AS fn
  LOOP
    IF NOT has_function_privilege('service_role', r.fn, 'EXECUTE') THEN
      falta := falta || format('service_role NO puede EXECUTE %s; ', r.fn);
    END IF;
  END LOOP;

  IF falta <> '' THEN
    RAISE EXCEPTION 'el GRANT a service_role no se aplico: %', falta;
  END IF;
  RAISE NOTICE 'ok service_role puede ejecutar las 9 funciones del motor';
END $$;
