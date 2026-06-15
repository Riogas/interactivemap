-- ============================================================
-- Patch: fix services branch en fecha pasada no filtraba por escenario
-- Fecha: 2026-05-28
-- Aplicar manualmente en Supabase SQL Editor
-- ============================================================
--
-- DEPENDENCIAS:
--   · 2026-05-27-moviles-dia-functions.sql   — definición original
--   · 2026-05-28-moviles-dia-functions-fix-fchpara-date.sql — patch previo (date=date)
--
-- BUG:
--   En el CASO B (fecha pasada) de fn_moviles_dia_rebuild, el universo de
--   móviles se construía con un UNION de 3 ramas:
--     1. pedidos  — filtraba por (p_escenario IS NULL OR p.escenario = p_escenario) ✅
--     2. services — NO filtraba por escenario                                        ❌
--     3. gps      — filtraba por (p_escenario IS NULL OR m_gps.escenario_id = p_escenario) ✅
--
--   La rama de services podía incluir nros de móviles pertenecientes a otros
--   escenarios (que casualmente coinciden con nros del escenario objetivo), lo
--   que inflaba el universo reconstruido con filas incorrectas.
--
-- FIX:
--   Agregar AND (p_escenario IS NULL OR s.escenario = p_escenario) a la
--   subquery de services en el CASO B.
--   El CASO A (día en curso) queda SIN cambios: ya usaba EXISTS sobre services
--   vinculado a m.nro (de un movil previamente filtrado por escenario), por lo
--   que el problema no se manifestaba ahí.
--
-- NOTA:
--   Este archivo es un patch incremental — emite CREATE OR REPLACE solo para
--   fn_moviles_dia_rebuild.  fn_moviles_dia_recompute_counts y
--   fn_moviles_dia_recompute_counts_bulk no se modifican.
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
BEGIN
  v_fecha := p_desde;

  WHILE v_fecha <= p_hasta LOOP

    v_fecha_ymd := to_char(v_fecha, 'YYYYMMDD');
    v_fecha_ini := to_char(v_fecha, 'YYYY-MM-DD') || 'T00:00:00';
    v_fecha_fin := to_char(v_fecha, 'YYYY-MM-DD') || 'T23:59:59';

    -- ══════════════════════════════════════════════════════════════════════════
    -- CASO A: DÍA EN CURSO — fila completa
    -- (sin cambios respecto al patch 2026-05-28-moviles-dia-functions-fix-fchpara-date.sql)
    -- ══════════════════════════════════════════════════════════════════════════
    IF v_fecha = current_date THEN

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
              AND p2.fch_para  = v_fecha
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
    -- FIX: rama services ahora filtra por escenario igual que pedidos y gps.
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
          -- Pedidos del día — filtra por escenario
          SELECT p.movil AS nro
          FROM pedidos p
          WHERE p.fch_para = v_fecha
            AND p.movil IS NOT NULL
            AND p.movil <> 0
            AND (p_escenario IS NULL OR p.escenario = p_escenario)
            AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)

          UNION

          -- Services del día — FIX: agrega filtro por escenario (antes ausente)
          SELECT s.movil AS nro
          FROM services s
          WHERE s.movil IS NOT NULL
            AND s.movil <> 0
            AND (
              (s.fch_hora_para >= v_fecha_ini::timestamptz
               AND s.fch_hora_para <= v_fecha_fin::timestamptz)
              OR s.fch_para = v_fecha
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
