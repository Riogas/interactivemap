-- ============================================================
-- Migration: triggers de estado/identidad y posición GPS para moviles_dia
-- Fecha: 2026-05-27
-- Spec: docs/superpowers/specs/2026-05-27-moviles-dia-projection-design.md
-- Plan: docs/superpowers/plans/2026-05-27-moviles-dia.md (Task 1.4)
-- Requiere:
--   · tabla moviles_dia (2026-05-27-create-moviles-dia.sql)
--   · funciones fn_moviles_dia_* (2026-05-27-moviles-dia-functions.sql)
-- ============================================================
--
-- NORMALIZACIÓN id / nro (CRÍTICA — leer antes de modificar):
--
--   · moviles.id          = TEXT  (PK interna de Supabase, opaca)
--   · moviles.nro         = INTEGER (id lógico usado por pedidos, services, UI)
--   · moviles_dia.movil_id= INTEGER (= moviles.nro, NO el id TEXT)
--   · gps_*.movil_id      = TEXT   (= moviles.id, NO nro)
--
--   Consecuencia: el trigger GPS recibe NEW.movil_id TEXT (= moviles.id).
--   Para obtener el nro y el escenario_id hace un SELECT en moviles.
--   NUNCA escribir NEW.movil_id directamente en moviles_dia.movil_id.
--
-- PUNTO DE ENGANCHE GPS (decisión documentada):
--
--   Opciones consideradas:
--     A) gps_tracking_history AFTER INSERT
--        Tabla de log append-only; cada nuevo ping GPS es un INSERT.
--        Pros: punto de ingesta único, no genera escrituras duplicadas.
--        Cons: si algún proceso hace UPDATE en gps_tracking_history se pierde.
--
--     B) gps_latest_positions AFTER INSERT OR UPDATE
--        Tabla de última posición (1 fila por móvil), mantenida por el
--        trigger existente trg_gps_latest_set_empresa_fletera
--        (2026-05-18-gps-latest-empresa-fletera.sql).
--        Pros: mismo punto que el trigger de empresa_fletera_id; gps_latest
--        ya está actualizada cuando este trigger dispara (AFTER).
--        Cons: gps_latest_positions puede actualizarse sin que haya un
--        INSERT en gps_tracking_history (e.g. correcciones manuales).
--
--   DECISIÓN: Se engancha en gps_tracking_history AFTER INSERT (Opción A),
--   que es el punto de ingesta primario (cada ping de GPS crea una fila nueva).
--   Esto evita que moviles_dia se actualice en cada UPDATE de gps_latest
--   (que puede ser frecuente por el trigger de empresa_fletera) y mantiene
--   la escritura en moviles_dia acoplada solo al flujo real de GPS.
--
--   -- TODO confirm: verificar que el proceso de ingesta GPS siempre hace
--   INSERT en gps_tracking_history (y no UPDATE ni INSERT OR REPLACE).
--   Si la ingesta usa un UPSERT en gps_latest_positions como único punto
--   de entrada (sin escribir en gps_tracking_history), preferir Opción B.
--
-- ============================================================


-- ============================================================
-- Trigger 1: moviles → moviles_dia (estado e identidad)
--
-- Actualiza la fila del DÍA EN CURSO en moviles_dia cuando cambia
-- cualquier campo de identidad u operativo en moviles.
--
-- · movil_id  = NEW.nro  (id lógico entero, NO el TEXT id de Supabase)
-- · activo    = estado_nro IS NULL OR estado_nro IN (0,1,2,4)
--               (isMovilActiveForUI — port de lib/moviles/visibility.ts)
-- · NO sobreescribe pedidos_pendientes / services_pendientes / last_gps_*
--   (esos campos los mantienen los otros paths: recompute_counts y trigger GPS).
-- ============================================================

CREATE OR REPLACE FUNCTION trg_moviles_to_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO moviles_dia AS d (
    escenario_id,
    movil_id,          -- moviles.nro (entero), NO moviles.id (text)
    fecha,
    empresa_fletera_id,
    matricula,
    descripcion,
    estado_nro,
    estado_desc,
    tamano_lote,
    activo,
    updated_at
  )
  VALUES (
    NEW.escenario_id,
    NEW.nro,           -- nro = id lógico entero; id TEXT de Supabase se ignora aquí
    current_date,
    NEW.empresa_fletera_id,
    NEW.matricula,
    NEW.descripcion,
    NEW.estado_nro,
    NEW.estado_desc,
    NEW.tamano_lote,
    (NEW.estado_nro IS NULL OR NEW.estado_nro IN (0, 1, 2, 4)),
    now()
  )
  ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
    empresa_fletera_id = EXCLUDED.empresa_fletera_id,
    matricula          = EXCLUDED.matricula,
    descripcion        = EXCLUDED.descripcion,
    estado_nro         = EXCLUDED.estado_nro,
    estado_desc        = EXCLUDED.estado_desc,
    tamano_lote        = EXCLUDED.tamano_lote,
    activo             = EXCLUDED.activo,
    updated_at         = now();
    -- pedidos_pendientes, services_pendientes, last_gps_*, oculto_operativo,
    -- inactivo_del_dia NO se tocan: los mantienen recompute_counts y el trigger GPS.

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moviles_to_dia ON moviles;
CREATE TRIGGER trg_moviles_to_dia
  AFTER INSERT OR UPDATE ON moviles
  FOR EACH ROW EXECUTE FUNCTION trg_moviles_to_dia_fn();


-- ============================================================
-- Trigger 2: gps_tracking_history → moviles_dia (posición GPS)
--
-- Al registrarse un nuevo ping GPS actualiza last_gps_* en la fila
-- del DÍA EN CURSO de moviles_dia.
--
-- NORMALIZACIÓN (ver cabecera del archivo):
--   NEW.movil_id   = TEXT (= moviles.id — el id interno de Supabase)
--   moviles_dia.movil_id = INTEGER (= moviles.nro — el id lógico)
--
--   Paso 1: buscar en moviles WHERE id = NEW.movil_id → obtener nro + escenario_id.
--   Paso 2: UPDATE la fila de hoy con los campos GPS.
--   Paso 3: si no existe la fila aún (móvil que reporta GPS antes del rollover
--           o antes del trigger 1), hacer UPSERT mínimo con identidad + GPS.
--   Paso 4: si el móvil no está en moviles, ignorar silenciosamente (RETURN NEW).
--
-- Columnas GPS: latitud, longitud, fecha_hora (timestamptz)
-- Fuente: gps_tracking_history (tabla de log append-only)
-- -- TODO confirm: verificar nombres exactos de columnas de gps_tracking_history.
--   En gps_latest_positions (2026-05-18-gps-latest-empresa-fletera.sql) se usan
--   movil_id, empresa_fletera_id; columnas de coordenadas y timestamp no están
--   referenciadas en ese archivo. Confirmar que son latitud/longitud/fecha_hora
--   (mismos nombres que en gps_latest_positions usados por fn_moviles_dia_rebuild).
-- ============================================================

CREATE OR REPLACE FUNCTION trg_gps_to_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_nro        INTEGER;
  v_escenario  INTEGER;
  v_activo     BOOLEAN;
BEGIN
  -- Traducir movil_id TEXT (= moviles.id) → nro INTEGER + escenario_id
  -- Si el móvil no existe en la tabla moviles, no hay fila que actualizar.
  SELECT nro, escenario_id,
         (estado_nro IS NULL OR estado_nro IN (0, 1, 2, 4))
  INTO   v_nro, v_escenario, v_activo
  FROM   moviles
  WHERE  id = NEW.movil_id;   -- TEXT = TEXT (id interno, no nro)

  IF NOT FOUND THEN
    -- Móvil desconocido: ignorar para no generar ruido en moviles_dia.
    RETURN NEW;
  END IF;

  -- Actualizar last_gps_* en la fila de hoy (si existe)
  UPDATE moviles_dia SET
    last_gps_lat      = NEW.latitud,     -- TODO confirm: columna latitud en gps_tracking_history
    last_gps_lng      = NEW.longitud,    -- TODO confirm: columna longitud
    last_gps_datetime = NEW.fecha_hora,  -- TODO confirm: columna fecha_hora (timestamptz)
    updated_at        = now()
  WHERE escenario_id = v_escenario
    AND movil_id     = v_nro            -- INTEGER (nro), NO el TEXT id
    AND fecha        = current_date;

  IF NOT FOUND THEN
    -- La fila de hoy no existe aún (rollover recién, o móvil que no tiene
    -- entrada en moviles_dia porque trg_moviles_to_dia no se disparó todavía).
    -- Insertar una fila mínima con identidad + GPS; los demás campos
    -- (pedidos_pendientes, services_pendientes, oculto_operativo, etc.)
    -- quedan en sus DEFAULT hasta que recompute_counts o fn_moviles_dia_rebuild
    -- los calcule.
    INSERT INTO moviles_dia AS d (
      escenario_id,
      movil_id,           -- nro (entero)
      fecha,
      empresa_fletera_id,
      matricula,
      descripcion,
      estado_nro,
      estado_desc,
      tamano_lote,
      last_gps_lat,
      last_gps_lng,
      last_gps_datetime,
      activo,
      updated_at
    )
    SELECT
      m.escenario_id,
      m.nro,              -- nro (entero), no m.id
      current_date,
      m.empresa_fletera_id,
      m.matricula,
      m.descripcion,
      m.estado_nro,
      m.estado_desc,
      m.tamano_lote,
      NEW.latitud,        -- TODO confirm: nombre columna
      NEW.longitud,       -- TODO confirm: nombre columna
      NEW.fecha_hora,     -- TODO confirm: nombre columna
      v_activo,
      now()
    FROM moviles m
    WHERE m.id = NEW.movil_id  -- TEXT = TEXT (id, no nro)
    ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
      last_gps_lat      = EXCLUDED.last_gps_lat,
      last_gps_lng      = EXCLUDED.last_gps_lng,
      last_gps_datetime = EXCLUDED.last_gps_datetime,
      updated_at        = now();
  END IF;

  RETURN NEW;
END;
$$;

-- -- TODO confirm: si se decide enganchar en gps_latest_positions en lugar de
-- gps_tracking_history, cambiar la tabla y el evento a:
--   AFTER INSERT OR UPDATE ON gps_latest_positions
-- y ajustar los nombres de columna si difieren.
DROP TRIGGER IF EXISTS trg_gps_to_dia ON gps_tracking_history;
CREATE TRIGGER trg_gps_to_dia
  AFTER INSERT ON gps_tracking_history
  FOR EACH ROW EXECUTE FUNCTION trg_gps_to_dia_fn();


-- ─── Verificación (ejecutar manualmente post-apply) ───────────────────────────
--
-- 1) Trigger sobre moviles:
--    UPDATE moviles SET estado_nro = estado_nro WHERE nro = <un_nro> AND escenario_id = <escenario>;
--    SELECT estado_nro, activo, updated_at FROM moviles_dia
--      WHERE movil_id = <un_nro> AND escenario_id = <escenario> AND fecha = current_date;
--    Esperado: fila actualizada con activo y updated_at recientes.
--
-- 2) Trigger sobre gps_tracking_history:
--    INSERT INTO gps_tracking_history (movil_id, latitud, longitud, fecha_hora)
--      VALUES ('<un_id_text>', -34.9, -56.1, now());
--    SELECT last_gps_lat, last_gps_lng, last_gps_datetime FROM moviles_dia
--      WHERE movil_id = (SELECT nro FROM moviles WHERE id = '<un_id_text>')
--        AND fecha = current_date;
--    Esperado: coordenadas y timestamp actualizados.
--
-- 3) Confirmar que pedidos_pendientes / services_pendientes no se tocaron
--    en ninguno de los dos triggers (deben conservar el valor previo).
