\set ON_ERROR_STOP on
-- =====================================================================
-- Grants de EXECUTE sobre las cinco funciones nuevas de esta tanda
-- (Important 5, review final)
--
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto --
-- a diferencia de las tablas, donde hace falta que el proyecto agregue un
-- default privilege para que anon/authenticated tengan algo (00-stubs.sql
-- replica ese comportamiento de Supabase, ver su comentario). Con las
-- funciones no hace falta ningun stub: es el comportamiento de serie de
-- Postgres, y por eso las cinco quedaban invocables por anon/authenticated
-- via RPC aunque las tablas que leen esten blindadas.
--
-- Firma exacta de cada una (tiene que coincidir con el REVOKE/GRANT de su
-- propia migracion -- un REVOKE con la firma equivocada no revoca nada):
--   demoras_ritmo_muestras(integer, date, integer, text, integer, boolean)
--   demoras_cola(integer, date, timestamptz)
--   demoras_ritmo_movil(integer, date)
--   demoras_servidores(integer, date)
--   demoras_proximo_hueco(integer, date, timestamptz)
--
-- demoras_ritmo(integer, date) queda deliberadamente FUERA de este assert:
-- no es una funcion nueva de esta tanda (reemplaza, con firma distinta, a
-- una que ya existia desde 2026-07-29), y su exposicion a anon es una
-- condicion PREEXISTENTE a esta tanda, no algo que este wave de fixes haya
-- introducido -- queda fuera de alcance aca, igual que quedo fuera del
-- hallazgo I5 del review.
-- =====================================================================

-- ─── anon y authenticated NO pueden ejecutar ninguna de las cinco ────
DO $$
DECLARE r record; falla text := '';
BEGIN
  FOR r IN
    SELECT f.fn, g.rol
      FROM (VALUES
        ('demoras_ritmo_muestras(integer, date, integer, text, integer, boolean)'),
        ('demoras_cola(integer, date, timestamptz)'),
        ('demoras_ritmo_movil(integer, date)'),
        ('demoras_servidores(integer, date)'),
        ('demoras_proximo_hueco(integer, date, timestamptz)')
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
  RAISE NOTICE 'ok anon y authenticated no pueden ejecutar ninguna de las 5 funciones nuevas';
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
      'demoras_ritmo_muestras(integer, date, integer, text, integer, boolean)',
      'demoras_cola(integer, date, timestamptz)',
      'demoras_ritmo_movil(integer, date)',
      'demoras_servidores(integer, date)',
      'demoras_proximo_hueco(integer, date, timestamptz)'
    ]) AS fn
  LOOP
    IF NOT has_function_privilege('service_role', r.fn, 'EXECUTE') THEN
      falta := falta || format('service_role NO puede EXECUTE %s; ', r.fn);
    END IF;
  END LOOP;

  IF falta <> '' THEN
    RAISE EXCEPTION 'el GRANT a service_role no se aplico: %', falta;
  END IF;
  RAISE NOTICE 'ok service_role puede ejecutar las 5 funciones nuevas';
END $$;
