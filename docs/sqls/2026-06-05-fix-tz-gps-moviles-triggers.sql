-- ============================================================
-- Migration: fix timezone en triggers GPS y moviles_dia
-- Fecha:  2026-06-05
-- Autor:  Implementer (pipeline /feature)
-- Aplicar manualmente en Supabase SQL Editor
--
-- BUG CRÍTICO:
--   trg_gps_to_dia_fn y trg_moviles_to_dia_fn usaban current_date
--   (que en Supabase/Postgres devuelve la fecha UTC del servidor).
--   Después de las 21:00 Montevideo (= 00:00 UTC del día siguiente),
--   current_date pasa a ser el día siguiente en UTC mientras que en
--   Uruguay sigue siendo el día anterior.
--
--   Consecuencia:
--     · trg_gps_to_dia_fn actualiza/inserta en la fila de "mañana MVD"
--       en moviles_dia, dejando la fila de "hoy MVD" sin GPS actualizado.
--     · trg_moviles_to_dia_fn inserta identidad en la fila de "mañana MVD".
--     · El dashboard pide datos de hoy MVD → ve datos stale (0 GPS, etc.).
--
--   El mismo bug existe en fn_moviles_dia_rebuild:
--     IF v_fecha = current_date THEN
--   falla en rebuilds manuales nocturnos (21:00–23:59 UY) porque
--   current_date UTC ya es mañana, por lo que el rebuild del día actual
--   MVD entra en la rama CASO B (fecha pasada) en vez de CASO A (hoy).
--
-- SOLUCIÓN:
--   Reemplazar current_date por (now() AT TIME ZONE 'America/Montevideo')::date
--   en los tres lugares afectados.
--
-- DEPENDENCIAS (deben estar aplicadas antes):
--   · 2026-05-27-moviles-dia-triggers.sql
--   · 2026-06-01-fix-pedidos-fch-para-null.sql
--
-- Idempotente: usa CREATE OR REPLACE.
-- NO ejecutar directamente — aplicar en Supabase SQL Editor.
-- ============================================================

BEGIN;


-- ============================================================
-- FIX 1: trg_gps_to_dia_fn
-- Reemplaza current_date → v_hoy (America/Montevideo) en:
--   · WHERE fecha = current_date  (UPDATE de la fila de hoy)
--   · v_fecha AS fecha en el INSERT de fallback
-- ============================================================
CREATE OR REPLACE FUNCTION trg_gps_to_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_nro        INTEGER;
  v_escenario  INTEGER;
  v_activo     BOOLEAN;
  v_hoy        DATE;
BEGIN
  -- Fecha de hoy según America/Montevideo (no current_date UTC)
  v_hoy := (now() AT TIME ZONE 'America/Montevideo')::date;

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
    AND fecha        = v_hoy;

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
      v_hoy,
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


-- ============================================================
-- FIX 2: trg_moviles_to_dia_fn
-- Reemplaza current_date → v_hoy (America/Montevideo) en el
-- INSERT ... VALUES (..., current_date, ...) del UPSERT de identidad.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_moviles_to_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_hoy DATE;
BEGIN
  -- Fecha de hoy según America/Montevideo (no current_date UTC)
  v_hoy := (now() AT TIME ZONE 'America/Montevideo')::date;

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
    v_hoy,
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
-- FIX 3: fn_moviles_dia_rebuild
-- (REEMPLAZA la versión de 2026-06-01-fix-pedidos-fch-para-null.sql)
--
-- Cambio respecto a la versión anterior:
--   - Agrega v_hoy_mvd DATE al DECLARE.
--   - Inicializa v_hoy_mvd := (now() AT TIME ZONE 'America/Montevideo')::date
--     al inicio del BEGIN, antes de entrar al WHILE.
--   - Cambia IF v_fecha = current_date THEN
--     por   IF v_fecha = v_hoy_mvd THEN
--   Todo lo demás (CASO A, CASO B, COALESCE en pedidos/services, GPS,
--   ON CONFLICT, recompute_counts) queda intacto.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_moviles_dia_rebuild(
  p_desde     date,
  p_hasta     date,
  p_escenario integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_fecha      date;
  v_fecha_ymd  text;
  v_fecha_ini  text;
  v_fecha_fin  text;
  v_rows       integer := 0;
  v_hoy_mvd    date;   -- hoy según America/Montevideo (no current_date UTC)
BEGIN
  -- Capturar hoy MVD una vez al inicio para todo el loop
  v_hoy_mvd := (now() AT TIME ZONE 'America/Montevideo')::date;

  v_fecha := p_desde;

  WHILE v_fecha <= p_hasta LOOP

    v_fecha_ymd := to_char(v_fecha, 'YYYYMMDD');
    v_fecha_ini := to_char(v_fecha, 'YYYY-MM-DD') || 'T00:00:00';
    v_fecha_fin := to_char(v_fecha, 'YYYY-MM-DD') || 'T23:59:59';

    -- ══════════════════════════════════════════════════════════════════════════
    -- CASO A: DÍA EN CURSO — fila completa
    -- FIX: usa v_hoy_mvd en vez de current_date (UTC) para la comparación.
    -- FIX: EXISTS de pedidos usa COALESCE(fch_para, ...) para tolerar NULL.
    -- ══════════════════════════════════════════════════════════════════════════
    IF v_fecha = v_hoy_mvd THEN

      INSERT INTO moviles_dia AS d (
        escenario_id, movil_id, fecha,
        empresa_fletera_id, matricula, descripcion,
        estado_nro, estado_desc, tamano_lote,
        last_gps_lat, last_gps_lng, last_gps_datetime,
        activo,
        oculto_operativo, inactivo_del_dia,
        pedidos_pendientes, services_pendientes,
        updated_at
      )
      SELECT
        m.escenario_id,
        m.nro          AS movil_id,   -- nro (int), NO m.id (text)
        v_fecha        AS fecha,
        m.empresa_fletera_id,
        m.matricula,
        m.descripcion,
        m.estado_nro,
        m.estado_desc,
        m.tamano_lote,
        g.latitud      AS last_gps_lat,
        g.longitud     AS last_gps_lng,
        g.fecha_hora   AS last_gps_datetime,
        (m.estado_nro IS NULL OR m.estado_nro IN (0, 1, 2, 4)) AS activo,
        false          AS oculto_operativo,
        false          AS inactivo_del_dia,
        NULL           AS pedidos_pendientes,
        NULL           AS services_pendientes,
        now()          AS updated_at
      FROM moviles m
      LEFT JOIN gps_latest_positions g
             ON g.movil_id = m.id          -- TEXT = TEXT (id, no nro)
      WHERE (p_escenario IS NULL OR m.escenario_id = p_escenario)
        AND (
          -- moviles visibles en mapa
          m.mostrar_en_mapa = true
          OR EXISTS (
            SELECT 1 FROM pedidos p2
            WHERE p2.escenario = m.escenario_id
              AND p2.movil     = m.nro
              -- COALESCE defensivo: tolera fch_para NULL derivando de fch_hora_para
              AND COALESCE(p2.fch_para, (p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
              AND NOT (p2.estado_nro = 2 AND p2.sub_estado_nro = 17)
          )
          OR EXISTS (
            SELECT 1 FROM services s2
            WHERE s2.movil = m.nro
              AND (
                (s2.fch_hora_para >= v_fecha_ini::timestamptz
                 AND s2.fch_hora_para <= v_fecha_fin::timestamptz)
                OR s2.fch_para = v_fecha
              )
          )
          -- moviles con GPS hoy (join vía id TEXT → nro)
          OR EXISTS (
            SELECT 1 FROM gps_tracking_history gth
            WHERE gth.movil_id = m.id            -- TEXT=TEXT (id, no nro)
              AND gth.fecha_hora >= v_fecha::timestamp
              AND gth.fecha_hora <  (v_fecha::timestamp + interval '1 day')
          )
        )
      ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
        empresa_fletera_id  = EXCLUDED.empresa_fletera_id,
        matricula           = EXCLUDED.matricula,
        descripcion         = EXCLUDED.descripcion,
        estado_nro          = EXCLUDED.estado_nro,
        estado_desc         = EXCLUDED.estado_desc,
        tamano_lote         = EXCLUDED.tamano_lote,
        last_gps_lat        = EXCLUDED.last_gps_lat,
        last_gps_lng        = EXCLUDED.last_gps_lng,
        last_gps_datetime   = EXCLUDED.last_gps_datetime,
        activo              = EXCLUDED.activo,
        updated_at          = now();
        -- oculto_operativo, inactivo_del_dia, pedidos_pendientes, services_pendientes
        -- se calculan abajo con recompute_counts; no los pisamos en el DO UPDATE
        -- para no deshacer un recompute reciente.

      -- Recomputar pendientes + flags para todos los moviles del día
      -- recompute_counts ya incluye el COALESCE defensivo.
      PERFORM fn_moviles_dia_recompute_counts(
        escenario_id::integer,
        movil_id::integer,
        v_fecha
      )
      FROM moviles_dia
      WHERE fecha = v_fecha
        AND (p_escenario IS NULL OR escenario_id = p_escenario);

    -- ══════════════════════════════════════════════════════════════════════════
    -- CASO B: FECHA PASADA — fila reducida
    -- FIX: rama pedidos y rama services usan COALESCE(fch_para, ...) = v_fecha
    --      para incluir pedidos/services con fch_para NULL en el universo.
    -- ══════════════════════════════════════════════════════════════════════════
    ELSE

      INSERT INTO moviles_dia AS d (
        escenario_id, movil_id, fecha,
        empresa_fletera_id, matricula, descripcion,
        estado_nro, estado_desc,
        tamano_lote, pedidos_pendientes, services_pendientes,
        last_gps_lat, last_gps_lng, last_gps_datetime,
        activo, oculto_operativo, inactivo_del_dia,
        updated_at
      )
      SELECT
        m.escenario_id,
        m.nro          AS movil_id,   -- nro (int)
        v_fecha        AS fecha,
        m.empresa_fletera_id,
        m.matricula,
        m.descripcion,
        m.estado_nro,
        m.estado_desc,
        NULL           AS tamano_lote,
        NULL           AS pedidos_pendientes,
        NULL           AS services_pendientes,
        lp.latitud     AS last_gps_lat,
        lp.longitud    AS last_gps_lng,
        lp.fecha_hora  AS last_gps_datetime,
        false          AS activo,
        false          AS oculto_operativo,
        true           AS inactivo_del_dia,
        now()          AS updated_at
      FROM (
        SELECT DISTINCT u.nro
        FROM (
          -- Pedidos del día — COALESCE defensivo para fch_para NULL
          SELECT p.movil AS nro
          FROM pedidos p
          WHERE COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
            AND p.movil IS NOT NULL
            AND p.movil <> 0
            AND (p_escenario IS NULL OR p.escenario = p_escenario)
            AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)

          UNION

          -- Services del día — mantiene rama fch_hora_para + COALESCE en fch_para OR
          SELECT s.movil AS nro
          FROM services s
          WHERE s.movil IS NOT NULL
            AND s.movil <> 0
            AND (
              (s.fch_hora_para >= v_fecha_ini::timestamptz
               AND s.fch_hora_para <= v_fecha_fin::timestamptz)
              OR COALESCE(s.fch_para, (s.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
            )
            AND (p_escenario IS NULL OR s.escenario = p_escenario)

          UNION

          -- Moviles con GPS ese día — normalizar TEXT id → int nro via moviles
          SELECT m_gps.nro
          FROM gps_tracking_history gth
          JOIN moviles m_gps ON m_gps.id = gth.movil_id   -- TEXT=TEXT (id→nro)
          WHERE gth.fecha_hora >= v_fecha::timestamp
            AND gth.fecha_hora <  (v_fecha::timestamp + interval '1 day')
            AND (p_escenario IS NULL OR m_gps.escenario_id = p_escenario)
        ) u
      ) ref
      JOIN moviles m ON m.nro = ref.nro
        AND (p_escenario IS NULL OR m.escenario_id = p_escenario)
      LEFT JOIN LATERAL (
        SELECT gth2.latitud, gth2.longitud, gth2.fecha_hora
        FROM gps_tracking_history gth2
        WHERE gth2.movil_id = m.id        -- TEXT=TEXT (id, no nro)
          AND gth2.fecha_hora >= v_fecha::timestamp
          AND gth2.fecha_hora <  (v_fecha::timestamp + interval '1 day')
        ORDER BY gth2.fecha_hora DESC
        LIMIT 1
      ) lp ON true

      ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
        empresa_fletera_id  = EXCLUDED.empresa_fletera_id,
        matricula           = EXCLUDED.matricula,
        descripcion         = EXCLUDED.descripcion,
        estado_nro          = EXCLUDED.estado_nro,
        estado_desc         = EXCLUDED.estado_desc,
        tamano_lote         = NULL,
        pedidos_pendientes  = NULL,
        services_pendientes = NULL,
        last_gps_lat        = EXCLUDED.last_gps_lat,
        last_gps_lng        = EXCLUDED.last_gps_lng,
        last_gps_datetime   = EXCLUDED.last_gps_datetime,
        activo              = false,
        oculto_operativo    = false,
        inactivo_del_dia    = true,
        updated_at          = now();

    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_fecha := v_fecha + 1;

  END LOOP;

  RETURN v_rows;
END;
$$;


COMMIT;


-- ============================================================
-- VERIFICACIONES post-apply:
-- ============================================================

-- VER1: divergencia de fechas (debería retornar true entre 21:00-23:59 UY)
-- SELECT current_date AS utc, (now() AT TIME ZONE 'America/Montevideo')::date AS mvd,
--        current_date != (now() AT TIME ZONE 'America/Montevideo')::date AS divergen;
--
-- VER2: actividad reciente de GPS en moviles_dia (debería estar en hoy MVD)
-- SELECT movil_id, fecha, last_gps_datetime, updated_at
-- FROM moviles_dia
-- WHERE fecha = (now() AT TIME ZONE 'America/Montevideo')::date
-- ORDER BY updated_at DESC LIMIT 10;
--
-- VER3: confirmar que no hay GPS recientes escribiendo en fechas equivocadas
-- SELECT fecha, COUNT(*), MAX(updated_at)
-- FROM moviles_dia
-- WHERE updated_at > now() - interval '10 minutes'
-- GROUP BY fecha;
