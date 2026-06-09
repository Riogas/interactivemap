-- ============================================================
-- Migration: fix filas ruido en moviles_dia para fechas históricas
-- Fecha:  2026-06-09
-- Autor:  Implementer (pipeline /feature)
-- Aplicar manualmente en Supabase SQL Editor
--
-- PROBLEMA:
--   moviles_dia acumula filas "ruido" para móviles que no trabajaron
--   en un día dado. Hay dos causas:
--
--   1. trg_moviles_to_dia_fn se dispara en CADA UPDATE sobre la tabla
--      moviles, incluyendo sync AS400 periódico que toca todos los
--      móviles del escenario aunque no hayan tenido pedidos/services.
--      Resultado: 226 filas para el 2026-06-08 cuando solo 101 móviles
--      trabajaron de verdad.
--
--   2. trg_gps_to_dia_fn inserta fila mínima para móviles que solo
--      emiten GPS sin tener pedidos ni services — quedan con
--      inactivo_del_dia=false, activo=false, pedidos=0, services=0.
--
--   Ambas causas producen filas "zombie" que pasan los filtros del
--   commit 35b6a7b (que removió el filtro de inactivoDelDia en histórico
--   para mostrar todos los móviles que trabajaron) y ahora inflan el
--   conteo del colapsable.
--
-- SOLUCIÓN (tres partes):
--   PARTE A: Restringir trg_moviles_to_dia para que solo dispare en
--     cambios significativos de identidad/estado del móvil. Esto previene
--     que el sync AS400 masivo genere filas en moviles_dia.
--
--   PARTE B: Restringir trg_gps_to_dia para que no cree filas nuevas en
--     moviles_dia cuando el móvil no tiene pedidos ni services ese día
--     (solo actualiza last_gps_* si la fila ya existe).
--
--   PARTE C: Cleanup retroactivo de filas ruido para fechas pasadas.
--     Elimina filas en moviles_dia donde el móvil no tuvo pedido ni
--     service en esa fecha.
--
-- CRITERIO "trabajó ese día":
--   pedido O service asignado ese día (sin contar GPS solo).
--   GPS solo sin operativa no constituye "trabajar" en el historial.
--   Este criterio es el que devuelve los 101 móviles correctos para
--   2026-06-08 (en el scope del usuario).
--
-- DEPENDENCIAS (deben estar aplicadas antes):
--   · 2026-05-27-moviles-dia-triggers.sql
--   · 2026-06-05-fix-tz-gps-moviles-triggers.sql
--
-- RESTRICCIÓN OPERATIVA:
--   HOY sigue mostrando exactamente lo mismo que ahora:
--   activo=true || inactivo_del_dia=true. Solo se filtra en fechas < hoy.
--
-- Idempotente: usa CREATE OR REPLACE / DELETE con WHERE condicional.
-- NO ejecutar directamente — aplicar en Supabase SQL Editor.
-- ============================================================


BEGIN;


-- ============================================================
-- PARTE A: trg_moviles_to_dia_fn — solo disparar en cambios significativos
--
-- Columnas significativas (cambios que justifican upsert en moviles_dia):
--   empresa_fletera_id, matricula, descripcion, estado_nro, estado_desc,
--   tamano_lote, escenario_id
--
-- Columnas NO significativas (no deben disparar el trigger):
--   updated_at, last_gps_lat, last_gps_lng, gps_*, posicion_*,
--   y cualquier campo interno de sync AS400 que no impacta la UI.
--
-- NOTA: PostgreSQL permite OF <columns> en AFTER UPDATE para restringir
-- el trigger a solo esas columnas. Esto previene que el sync AS400 (que
-- hace UPDATE sin cambiar identidad) genere filas ruido en moviles_dia.
-- ============================================================

-- La función no cambia (ya es correcta desde 2026-06-05).
-- Solo se recrea el trigger con OF <columnas significativas>.

DROP TRIGGER IF EXISTS trg_moviles_to_dia ON moviles;
CREATE TRIGGER trg_moviles_to_dia
  AFTER INSERT OR UPDATE OF
    empresa_fletera_id,
    matricula,
    descripcion,
    estado_nro,
    estado_desc,
    tamano_lote,
    escenario_id
  ON moviles
  FOR EACH ROW EXECUTE FUNCTION trg_moviles_to_dia_fn();


-- ============================================================
-- PARTE B: trg_gps_to_dia_fn — no crear fila nueva si el móvil
-- no tiene pedidos ni services ese día
--
-- El UPDATE de last_gps_* sigue funcionando para filas que ya existen.
-- El INSERT de fallback (cuando la fila no existe) se restringe a
-- móviles que ya tienen al menos 1 pedido o service en esa fecha.
-- Así, GPS solo no genera filas ruido.
--
-- LÓGICA:
--   UPDATE ... WHERE fecha = v_hoy → sin cambio (igual que antes)
--   IF NOT FOUND:
--     verificar si el móvil tiene pedido o service hoy
--     SI tiene → INSERT mínimo (igual que antes)
--     SI no tiene → RETURN NEW sin insertar (nuevo: evita fila ruido)
-- ============================================================

CREATE OR REPLACE FUNCTION trg_gps_to_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_nro        INTEGER;
  v_escenario  INTEGER;
  v_activo     BOOLEAN;
  v_hoy        DATE;
  v_tiene_op   BOOLEAN;
  v_fecha_ini  TEXT;
  v_fecha_fin  TEXT;
BEGIN
  -- Fecha de hoy según America/Montevideo (no current_date UTC)
  v_hoy := (now() AT TIME ZONE 'America/Montevideo')::date;

  -- Traducir movil_id TEXT (= moviles.id) → nro INTEGER + escenario_id
  SELECT nro, escenario_id,
         (estado_nro IS NULL OR estado_nro IN (0, 1, 2, 4))
  INTO   v_nro, v_escenario, v_activo
  FROM   moviles
  WHERE  id = NEW.movil_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Actualizar last_gps_* en la fila de hoy (si existe)
  UPDATE moviles_dia SET
    last_gps_lat      = NEW.latitud,
    last_gps_lng      = NEW.longitud,
    last_gps_datetime = NEW.fecha_hora,
    updated_at        = now()
  WHERE escenario_id = v_escenario
    AND movil_id     = v_nro
    AND fecha        = v_hoy;

  IF NOT FOUND THEN
    -- La fila de hoy no existe aún.
    -- NUEVO: solo insertar si el móvil tiene pedido o service hoy.
    -- Esto evita filas ruido para móviles que solo emiten GPS.
    v_fecha_ini := to_char(v_hoy, 'YYYY-MM-DD') || 'T00:00:00';
    v_fecha_fin := to_char(v_hoy, 'YYYY-MM-DD') || 'T23:59:59';

    SELECT (
      EXISTS (
        SELECT 1 FROM pedidos p
        WHERE p.movil = v_nro
          AND p.escenario = v_escenario
          AND COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_hoy
          AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)
        LIMIT 1
      )
      OR
      EXISTS (
        SELECT 1 FROM services s
        WHERE s.movil = v_nro
          AND (
            (s.fch_hora_para >= v_fecha_ini::timestamptz
             AND s.fch_hora_para <= v_fecha_fin::timestamptz)
            OR COALESCE(s.fch_para, (s.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_hoy
          )
        LIMIT 1
      )
    ) INTO v_tiene_op;

    IF NOT v_tiene_op THEN
      -- Móvil con GPS pero sin pedidos ni services hoy: no crear fila ruido.
      RETURN NEW;
    END IF;

    -- Tiene operativa: insertar fila mínima con identidad + GPS.
    INSERT INTO moviles_dia AS d (
      escenario_id,
      movil_id,
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
      m.nro,
      v_hoy,
      m.empresa_fletera_id,
      m.matricula,
      m.descripcion,
      m.estado_nro,
      m.estado_desc,
      m.tamano_lote,
      NEW.latitud,
      NEW.longitud,
      NEW.fecha_hora,
      v_activo,
      now()
    FROM moviles m
    WHERE m.id = NEW.movil_id
    ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
      last_gps_lat      = EXCLUDED.last_gps_lat,
      last_gps_lng      = EXCLUDED.last_gps_lng,
      last_gps_datetime = EXCLUDED.last_gps_datetime,
      updated_at        = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gps_to_dia ON gps_tracking_history;
CREATE TRIGGER trg_gps_to_dia
  AFTER INSERT ON gps_tracking_history
  FOR EACH ROW EXECUTE FUNCTION trg_gps_to_dia_fn();


-- ============================================================
-- PARTE C: Cleanup retroactivo de filas ruido en fechas pasadas
--
-- Elimina filas de moviles_dia donde el móvil no tuvo pedido ni
-- service en esa fecha (criterio: trabajó = pedido OR service).
--
-- IMPORTANTE: Solo afecta fechas < hoy (fechas históricas).
-- HOY no se toca: sus filas se rigen por activo/inactivo_del_dia
-- que son campos de realtime correctamente mantenidos.
--
-- Alcance: escenario_id = 1000 (el del usuario que reportó el bug).
-- Para limpiar otros escenarios, cambiar o remover el filtro.
--
-- Si se quiere limpiar un rango específico de fechas, ajustar el WHERE.
--
-- VERIFICACIÓN PREVIA (ejecutar antes del DELETE para ver cuántas filas
-- se eliminarán):
--
--   SELECT COUNT(*) FROM moviles_dia md
--   WHERE md.fecha < (now() AT TIME ZONE 'America/Montevideo')::date
--     AND md.escenario_id = 1000
--     AND NOT EXISTS (
--       SELECT 1 FROM pedidos p
--       WHERE p.movil = md.movil_id
--         AND p.escenario = md.escenario_id
--         AND COALESCE(p.fch_para,
--               (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = md.fecha
--         AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)
--       LIMIT 1
--     )
--     AND NOT EXISTS (
--       SELECT 1 FROM services s
--       WHERE s.movil = md.movil_id
--         AND (
--           (s.fch_hora_para >= (md.fecha::text || 'T00:00:00')::timestamptz
--            AND s.fch_hora_para <= (md.fecha::text || 'T23:59:59')::timestamptz)
--           OR COALESCE(s.fch_para,
--                (s.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = md.fecha
--         )
--       LIMIT 1
--     );
--
-- ============================================================

DELETE FROM moviles_dia md
WHERE md.fecha < (now() AT TIME ZONE 'America/Montevideo')::date
  AND md.escenario_id = 1000
  AND NOT EXISTS (
    SELECT 1 FROM pedidos p
    WHERE p.movil = md.movil_id
      AND p.escenario = md.escenario_id
      AND COALESCE(
        p.fch_para,
        (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date
      ) = md.fecha
      AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM services s
    WHERE s.movil = md.movil_id
      AND (
        (s.fch_hora_para >= (md.fecha::text || 'T00:00:00')::timestamptz
         AND s.fch_hora_para <= (md.fecha::text || 'T23:59:59')::timestamptz)
        OR COALESCE(
          s.fch_para,
          (s.fch_hora_para AT TIME ZONE 'America/Montevideo')::date
        ) = md.fecha
      )
    LIMIT 1
  );


COMMIT;


-- ============================================================
-- VERIFICACIONES post-apply:
-- ============================================================

-- VER1: confirmar que el 2026-06-08 ahora muestra ~101 (no 226)
-- SELECT COUNT(*) FROM moviles_dia
-- WHERE fecha = '2026-06-08' AND escenario_id = 1000;
-- Esperado: ~101

-- VER2: confirmar que el trigger solo dispara en columnas significativas
-- UPDATE moviles SET updated_at = now() WHERE nro = <un_nro> AND escenario_id = 1000;
-- (este update no toca columnas del trigger → no debe crear fila en moviles_dia para hoy)
-- SELECT COUNT(*) FROM moviles_dia WHERE fecha = current_date AND escenario_id = 1000;
-- (verificar que el count no subió)

-- VER3: confirmar que hoy sigue funcionando
-- SELECT COUNT(*) FROM moviles_dia
-- WHERE fecha = (now() AT TIME ZONE 'America/Montevideo')::date
--   AND escenario_id = 1000;
-- Esperado: mismo número que antes (activos + inactivos del día con operativa)

-- VER4: confirmar que el ejemplo de fila ruido del usuario fue eliminado
-- SELECT * FROM moviles_dia WHERE movil_id = 495 AND fecha = '2026-06-08' AND escenario_id = 1000;
-- Esperado: 0 filas (si el móvil 495 no tuvo pedidos ni services el 2026-06-08)
