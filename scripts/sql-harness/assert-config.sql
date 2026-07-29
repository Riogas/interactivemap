\set ON_ERROR_STOP on
-- =====================================================================
-- Asserts de docs/sqls/2026-07-29-demoras-calculadas-tabla.sql
--
-- Cubre los dos agregados de la revision final:
--   B4: CHECK (hora_fin > hora_inicio) — una ventana que cruza la medianoche
--       apagaba ese tipo PARA SIEMPRE en silencio, porque el motor filtra
--       con `v_hora BETWEEN hora_inicio AND hora_fin` sobre un time.
--   B6: las dos tablas son exclusivas de service_role. Los asserts de
--       privilegios solo significan algo porque 00-stubs.sql replica los
--       default privileges de Supabase (anon/authenticated con ALL sobre las
--       tablas nuevas del schema public): sin eso, "anon no puede escribir"
--       pasaria por omision y no probaria el REVOKE.
--
-- Autocontenido: no depende de que corra antes o despues de los otros
-- asserts, y restaura las ventanas del seed al terminar.
-- =====================================================================

-- ─── B4: la ventana no puede cruzar la medianoche ─────────────────────
DO $$
DECLARE v_sqlstate text;
BEGIN
  BEGIN
    UPDATE demoras_config SET hora_inicio='20:30', hora_fin='06:00'
     WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
    RAISE EXCEPTION 'la ventana envuelta 20:30-06:00 fue ACEPTADA: falta el CHECK (hora_fin > hora_inicio) y NOCTURNO dejaria de escribir filas sin error ni log';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    RAISE NOTICE 'ok CHECK rechaza la ventana que cruza medianoche (SQLSTATE %)', v_sqlstate;
  END;
END $$;

-- hora_fin = hora_inicio tampoco: seria una ventana de un instante, que en la
-- practica es lo mismo que apagar el tipo, pero disfrazado de config valida.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_config SET hora_inicio='07:00', hora_fin='07:00'
     WHERE escenario_id=1000 AND tipo_servicio='SERVICE';
    RAISE EXCEPTION 'hora_fin = hora_inicio fue ACEPTADA (el CHECK debe ser estricto: >)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok CHECK es estricto (hora_fin > hora_inicio, no >=)';
  END;
END $$;

-- Control positivo: una ventana normal SI pasa. Sin esto, un CHECK mal
-- escrito que rechazara TODO (p.ej. `hora_fin < hora_inicio`) tambien haria
-- pasar los dos asserts de arriba.
DO $$
BEGIN
  UPDATE demoras_config SET hora_inicio='19:00', hora_fin='23:59'
   WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
  IF NOT FOUND THEN RAISE EXCEPTION 'no existe la fila NOCTURNO del escenario 1000 (falta el seed)'; END IF;
  RAISE NOTICE 'ok ventana normal 19:00-23:59 aceptada (control positivo)';
END $$;

-- El INSERT tambien queda cubierto (el CHECK es de tabla, no del UPDATE).
DO $$
BEGIN
  BEGIN
    INSERT INTO demoras_config (escenario_id, tipo_servicio, hora_inicio, hora_fin)
    VALUES (9999, 'NOCTURNO', '22:00', '05:00');
    RAISE EXCEPTION 'el INSERT con ventana envuelta fue ACEPTADO';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok CHECK tambien aplica al INSERT';
  END;
END $$;

-- ─── B6: grants — solo service_role ───────────────────────────────────
DO $$
DECLARE r record; falla text := '';
BEGIN
  FOR r IN
    SELECT t.tabla, g.rol, p.priv
      FROM (VALUES ('demoras_config'), ('demoras_calculadas')) AS t(tabla)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rol)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  LOOP
    IF has_table_privilege(r.rol, r.tabla, r.priv) THEN
      falla := falla || format('%s puede %s sobre %s; ', r.rol, r.priv, r.tabla);
    END IF;
  END LOOP;

  IF falla <> '' THEN
    RAISE EXCEPTION 'privilegios de mas (la anon key vive en el browser): %', falla;
  END IF;
  RAISE NOTICE 'ok anon y authenticated no tienen SELECT/INSERT/UPDATE/DELETE sobre demoras_config ni demoras_calculadas';
END $$;

-- Control positivo del GRANT: service_role SI tiene que poder. Sin esto, un
-- REVOKE demasiado ancho (o un GRANT que no se aplico) dejaria al cron y al
-- endpoint sin acceso y el assert de arriba pasaria igual.
DO $$
DECLARE r record; falta text := '';
BEGIN
  FOR r IN
    SELECT t.tabla, p.priv
      FROM (VALUES ('demoras_config'), ('demoras_calculadas')) AS t(tabla)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  LOOP
    IF NOT has_table_privilege('service_role', r.tabla, r.priv) THEN
      falta := falta || format('service_role NO puede %s sobre %s; ', r.priv, r.tabla);
    END IF;
  END LOOP;

  IF falta <> '' THEN
    RAISE EXCEPTION 'el GRANT a service_role no se aplico: %', falta;
  END IF;
  RAISE NOTICE 'ok service_role conserva SELECT/INSERT/UPDATE/DELETE en las dos tablas';
END $$;

-- Restaurar el seed: los otros asserts asumen las ventanas originales.
DELETE FROM demoras_config WHERE escenario_id = 9999;
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
UPDATE demoras_config SET hora_inicio='18:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='SERVICE';
