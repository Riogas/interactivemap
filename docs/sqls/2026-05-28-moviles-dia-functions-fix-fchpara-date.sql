-- ============================================================
-- Patch: fix operator does not exist: date = text
-- Fecha: 2026-05-28
-- Aplicar manualmente en Supabase SQL Editor
-- ============================================================
--
-- BUG:
--   pedidos.fch_para y services.fch_para son columnas de tipo DATE en producción
--   (confirmado vía information_schema.columns), NO text.
--   Las funciones originales (2026-05-27-moviles-dia-functions.sql) comparaban
--   fch_para = v_fecha_ymd donde v_fecha_ymd es TEXT en formato YYYYMMDD.
--   Postgres lanza: operator does not exist: date = text
--   Esto rompía completamente fn_moviles_dia_rebuild y fn_moviles_dia_recompute_counts,
--   dejando moviles_dia vacío y cascadeando errores en la UI.
--
-- FIX:
--   Reemplazar cada "fch_para = v_fecha_ymd" (date = text) por una comparación
--   date = date:
--     · En fn_moviles_dia_recompute_counts: fch_para = p_fecha  (parámetro date)
--     · En fn_moviles_dia_rebuild:          fch_para = v_fecha  (variable date del loop)
--   La variable v_fecha_ymd se mantiene declarada y asignada en ambas funciones
--   porque sigue siendo necesaria para construir los literales de texto usados en
--   los casts de fch_hora_para (timestamptz). No genera ningún error que permanezca.
--
-- NOTA:
--   Este archivo es un patch — emite CREATE OR REPLACE para las dos funciones
--   afectadas, sobreescribiendo sus definiciones anteriores. El archivo original
--   (2026-05-27-moviles-dia-functions.sql) se conserva sin modificación como
--   registro histórico.
--   fn_moviles_dia_recompute_counts_bulk NO se toca: no tiene referencias a fch_para.
-- ============================================================


-- ============================================================
-- 1. fn_moviles_dia_recompute_counts  (PATCH)
--    Cambios respecto al original:
--      · fch_para = v_fecha_ymd  →  fch_para = p_fecha  (date = date)
--      Afecta 4 ocurrencias: pedidos pendientes, services pendientes,
--      tiene_op pedidos, tiene_op services.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_moviles_dia_recompute_counts(
  p_escenario integer,
  p_movil     integer,   -- moviles.nro (id lógico)
  p_fecha     date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_fecha_ymd     text;
  v_fecha_inicio  text;
  v_fecha_fin     text;
  v_ped_pend      integer;
  v_serv_pend     integer;
  v_tiene_op      boolean;
  v_activo        boolean;
BEGIN
  -- Precalcular literales de fecha una sola vez
  v_fecha_ymd    := to_char(p_fecha, 'YYYYMMDD');
  v_fecha_inicio := to_char(p_fecha, 'YYYY-MM-DD') || 'T00:00:00';
  v_fecha_fin    := to_char(p_fecha, 'YYYY-MM-DD') || 'T23:59:59';

  -- ── Pedidos pendientes ───────────────────────────────────────────────────────
  -- FIX: fch_para = p_fecha (date = date), antes era fch_para = v_fecha_ymd (date = text).
  SELECT COUNT(*)::integer INTO v_ped_pend
  FROM pedidos
  WHERE escenario  = p_escenario
    AND movil      = p_movil
    AND estado_nro = 1
    AND fch_para   = p_fecha;

  -- ── Services pendientes ──────────────────────────────────────────────────────
  -- FIX: fch_para = p_fecha (date = date), antes era fch_para = v_fecha_ymd (date = text).
  SELECT COUNT(*)::integer INTO v_serv_pend
  FROM services
  WHERE movil      = p_movil
    AND estado_nro = 1
    AND (
      (fch_hora_para >= v_fecha_inicio::timestamptz
       AND fch_hora_para <= v_fecha_fin::timestamptz)
      OR fch_para = p_fecha
    );

  -- ── tiene_op: cualquier pedido o service en la fecha (cualquier estado) ──────
  -- FIX: fch_para = p_fecha (date = date) en ambos EXISTS, antes era v_fecha_ymd.
  v_tiene_op := (
    EXISTS (
      SELECT 1 FROM pedidos
      WHERE escenario  = p_escenario
        AND movil      = p_movil
        AND fch_para   = p_fecha
        -- Excluir REG. HISTORICO (igual que /api/pedidos)
        AND NOT (estado_nro = 2 AND sub_estado_nro = 17)
    )
    OR
    EXISTS (
      SELECT 1 FROM services
      WHERE movil = p_movil
        AND (
          (fch_hora_para >= v_fecha_inicio::timestamptz
           AND fch_hora_para <= v_fecha_fin::timestamptz)
          OR fch_para = p_fecha
        )
    )
  );

  -- ── activo: leer de moviles (por nro, no por id TEXT) ───────────────────────
  SELECT (estado_nro IS NULL OR estado_nro IN (0, 1, 2, 4))
  INTO v_activo
  FROM moviles
  WHERE nro = p_movil;

  -- Si el móvil no existe en la tabla moviles, tratarlo como inactivo.
  IF v_activo IS NULL THEN
    v_activo := false;
  END IF;

  -- ── UPDATE de la fila en moviles_dia ────────────────────────────────────────
  UPDATE moviles_dia SET
    pedidos_pendientes  = v_ped_pend,
    services_pendientes = v_serv_pend,
    activo              = v_activo,
    oculto_operativo    = (NOT v_activo) AND v_tiene_op,
    inactivo_del_dia    = (NOT v_activo) AND v_tiene_op,
    updated_at          = now()
  WHERE escenario_id = p_escenario
    AND movil_id     = p_movil
    AND fecha        = p_fecha;
END;
$$;


-- ============================================================
-- 3. fn_moviles_dia_rebuild  (PATCH)
--    Cambios respecto al original:
--      · fch_para = v_fecha_ymd  →  fch_para = v_fecha  (date = date)
--      Afecta 4 ocurrencias:
--        CASO A (día en curso): pedidos universe, services universe.
--        CASO B (fecha pasada): pedidos universe, services universe.
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
          -- FIX: fch_para = v_fecha (date = date), antes era v_fecha_ymd (date = text).
          OR EXISTS (
            SELECT 1 FROM pedidos p2
            WHERE p2.escenario = m.escenario_id
              AND p2.movil     = m.nro
              AND p2.fch_para  = v_fecha
              AND NOT (p2.estado_nro = 2 AND p2.sub_estado_nro = 17)
          )
          -- FIX: fch_para = v_fecha (date = date), antes era v_fecha_ymd (date = text).
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
          -- FIX: fch_para = v_fecha (date = date), antes era v_fecha_ymd (date = text).
          SELECT p.movil AS nro
          FROM pedidos p
          WHERE p.fch_para = v_fecha
            AND p.movil IS NOT NULL
            AND p.movil <> 0
            AND (p_escenario IS NULL OR p.escenario = p_escenario)
            AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)

          UNION

          -- FIX: fch_para = v_fecha (date = date), antes era v_fecha_ymd (date = text).
          SELECT s.movil AS nro
          FROM services s
          WHERE s.movil IS NOT NULL
            AND s.movil <> 0
            AND (
              (s.fch_hora_para >= v_fecha_ini::timestamptz
               AND s.fch_hora_para <= v_fecha_fin::timestamptz)
              OR s.fch_para = v_fecha
            )

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
