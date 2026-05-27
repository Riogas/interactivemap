-- ============================================================
-- Migration: funciones PL/pgSQL para moviles_dia
-- Fecha: 2026-05-27
-- Aplicar manualmente en Supabase SQL Editor
-- Requiere: tabla moviles_dia ya creada (2026-05-27-create-moviles-dia.sql)
-- ============================================================
--
-- PROPÓSITO:
--   Tres funciones que mantienen el read model moviles_dia:
--
--   1. fn_moviles_dia_recompute_counts(p_escenario, p_movil_nro, p_fecha)
--      → recomputa pendientes + flags para una fila puntual.
--
--   2. fn_moviles_dia_recompute_counts_bulk(p_escenario, p_fecha, p_moviles_nro[])
--      → invoca (1) para un array de nros. Usado por /api/pedidos y /api/services.
--
--   3. fn_moviles_dia_rebuild(p_desde, p_hasta [, p_escenario])
--      → UPSERT idempotente por rango de fechas.
--         Día en curso → fila COMPLETA (estado live, GPS, pendientes, flags).
--         Fechas pasadas → fila REDUCIDA (identidad + last_gps; sin pendientes).
--      Retorna la cantidad de filas tocadas en el último día procesado.
--
-- NORMALIZACIÓN id / nro (CRÍTICA):
--   · moviles.id  = TEXT (PK interna de Supabase).
--   · moviles.nro = INTEGER (id lógico usado por pedidos, services, UI y moviles_dia).
--   · gps_latest_positions.movil_id   = TEXT (= moviles.id, NO nro).
--   · gps_tracking_history.movil_id   = TEXT (= moviles.id, NO nro).
--   · pedidos.movil                   = INTEGER (= moviles.nro).
--   · services.movil                  = INTEGER (= moviles.nro).
--
--   Consecuencia: NUNCA hacer JOIN directo entre gps.movil_id (text=id)
--   y pedidos.movil / moviles_dia.movil_id (int=nro).
--   El puente siempre pasa por moviles: gps.movil_id = m.id → usar m.nro.
--
-- FECHAS:
--   pedidos.fch_para y services.fch_para se almacenan como YYYYMMDD (sin guiones).
--   Comparar siempre con to_char(fecha, 'YYYYMMDD').
--   services además tiene fch_hora_para (timestamptz); el filtro de fecha
--   captura AMBAS columnas con OR (mismo criterio que /api/services y /api/pedidos).
--
-- PENDIENTES (port de /api/moviles-extended):
--   Condición de "pendiente": estado_nro = 1 y fecha coincide.
--   Para pedidos: fch_para = YYYYMMDD.
--   Para services: (fch_hora_para BETWEEN día::timestamp y día+1::timestamp - 1s)
--                   OR fch_para = YYYYMMDD.
--   La cuenta de pedidos pendientes también excluye REG. HISTORICO
--   (estado_nro=2 AND sub_estado_nro=17) — relevante para tiene_op, no para
--   pendientes dado que estado=1 ya los excluye.
--
-- TIENE_OP (port de getMovilesConOperacionEnFecha de visibility.ts):
--   Cualquier pedido o service de ese movil/fecha, CUALQUIER estado.
--   En pedidos se excluye REG. HISTORICO (estado_nro=2 AND sub_estado_nro=17)
--   porque /api/pedidos los excluye globalmente y la UI nunca los ve.
--
-- FLAGS:
--   activo           = estado_nro IS NULL OR estado_nro IN (0,1,2,4)  [isMovilActiveForUI]
--   oculto_operativo = NOT activo AND tiene_op                        [getHiddenMovilIds]
--   inactivo_del_dia = NOT activo AND tiene_op                        [getMovilesConOperacionEnFecha]
--   Nota: oculto_operativo e inactivo_del_dia son semánticamente equivalentes
--   (mismo predicado) aunque se usan en contextos distintos de la UI.
-- ============================================================


-- ============================================================
-- 1. fn_moviles_dia_recompute_counts
--    Recomputa pendientes + flags para UN movil/fecha puntual.
--    p_movil es moviles.nro (INTEGER, no el id TEXT).
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
  -- Port exacto de /api/moviles-extended:
  --   estado_nro = 1, escenario = p_escenario, movil = p_movil (nro), fch_para = YYYYMMDD.
  -- TODO confirm: /api/moviles-extended hardcodea escenario=1000; aquí lo parametrizamos.
  --   Si los pedidos de un escenario pueden tener fch_para con formato distinto,
  --   revisar. Actualmente asumimos YYYYMMDD en toda la tabla.
  SELECT COUNT(*)::integer INTO v_ped_pend
  FROM pedidos
  WHERE escenario  = p_escenario
    AND movil      = p_movil
    AND estado_nro = 1
    AND fch_para   = v_fecha_ymd;

  -- ── Services pendientes ──────────────────────────────────────────────────────
  -- Port de /api/moviles-extended y /api/services:
  --   estado_nro = 1, fecha capturada por fch_hora_para (timestamptz) OR fch_para (YYYYMMDD).
  -- TODO confirm: services tiene columna escenario? La ruta /api/services la filtra
  --   opcionalmente (query param). Aquí NO filtramos por escenario en services
  --   porque la ruta /api/moviles-extended tampoco lo hace para services.
  --   Si en producción services se comparte entre escenarios, agregar filtro.
  SELECT COUNT(*)::integer INTO v_serv_pend
  FROM services
  WHERE movil      = p_movil
    AND estado_nro = 1
    AND (
      (fch_hora_para >= v_fecha_inicio::timestamptz
       AND fch_hora_para <= v_fecha_fin::timestamptz)
      OR fch_para = v_fecha_ymd
    );

  -- ── tiene_op: cualquier pedido o service en la fecha (cualquier estado) ──────
  -- Port de getMovilesConOperacionEnFecha (visibility.ts):
  --   incluye cualquier estado. En pedidos excluimos REG. HISTORICO
  --   (estado_nro=2 AND sub_estado_nro=17) porque /api/pedidos los excluye
  --   globalmente y nunca aparecen en la UI.
  v_tiene_op := (
    EXISTS (
      SELECT 1 FROM pedidos
      WHERE escenario  = p_escenario
        AND movil      = p_movil
        AND fch_para   = v_fecha_ymd
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
          OR fch_para = v_fecha_ymd
        )
    )
  );

  -- ── activo: leer de moviles (por nro, no por id TEXT) ───────────────────────
  -- isMovilActiveForUI: estadoNro IS NULL OR estadoNro IN (0,1,2,4).
  -- Normalización: moviles.nro es el id lógico entero; moviles.id es el TEXT interno.
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
-- 2. fn_moviles_dia_recompute_counts_bulk
--    Loop sobre un array de nros llamando a (1).
--    Usado por /api/pedidos y /api/services (fire-and-forget).
-- ============================================================
CREATE OR REPLACE FUNCTION fn_moviles_dia_recompute_counts_bulk(
  p_escenario integer,
  p_fecha     date,
  p_moviles   integer[]   -- array de moviles.nro
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_nro integer;
BEGIN
  FOREACH v_nro IN ARRAY p_moviles LOOP
    PERFORM fn_moviles_dia_recompute_counts(p_escenario, v_nro, p_fecha);
  END LOOP;
END;
$$;


-- ============================================================
-- 3. fn_moviles_dia_rebuild
--    Reconstruye moviles_dia para [p_desde, p_hasta].
--    Idempotente. Retorna filas tocadas en el último día.
--
--    DÍA EN CURSO (fecha = current_date):
--      Universo = moviles con mostrar_en_mapa = true
--                 UNION cualquier movil con pedido/service/GPS hoy.
--      Fila COMPLETA: identidad, estado live, tamano_lote, GPS desde
--      gps_latest_positions (1 fila por movil, siempre actualizada),
--      flags y pendientes.
--
--    FECHA PASADA:
--      Universo = moviles que ese día tuvieron pedido, service o GPS.
--      Fila REDUCIDA: identidad, last_gps_* desde gps_tracking_history
--      (último punto del día), tamano_lote=NULL, pendientes=NULL,
--      activo=false, oculto_operativo=false, inactivo_del_dia=true.
--
--    NORMALIZACIÓN GPS → nro:
--      gps_*.movil_id es TEXT = moviles.id.
--      Para obtener el nro: JOIN moviles ON m.id = gps.movil_id → usar m.nro.
--      NUNCA comparar gps.movil_id directamente con pedidos.movil.
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

      -- Universo: moviles visibles (mostrar_en_mapa = true)
      --           UNION moviles con pedido/service/GPS hoy.
      -- Este universo replica la lógica de /api/all-positions:
      --   · Base: mostrar_en_mapa = true (+ filtro de empresa si corresponde).
      --   · Ampliado por moviles con operación GPS del día (pueden no estar
      --     en mostrar_en_mapa si son recién dados de alta).
      --
      -- GPS: leemos gps_latest_positions (1 fila/movil, siempre vigente).
      --   JOIN: gps.movil_id (TEXT=id) = m.id (TEXT).
      --   Columnas: latitud, longitud, fecha_hora.
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
        -- pendientes y flags se rellenan a continuación con recompute_counts
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
          -- moviles con pedido hoy (any estado, excluyendo REG. HISTORICO)
          OR EXISTS (
            SELECT 1 FROM pedidos p2
            WHERE p2.escenario = m.escenario_id
              AND p2.movil     = m.nro
              AND p2.fch_para  = v_fecha_ymd
              AND NOT (p2.estado_nro = 2 AND p2.sub_estado_nro = 17)
          )
          -- moviles con service hoy (any estado)
          OR EXISTS (
            SELECT 1 FROM services s2
            WHERE s2.movil = m.nro
              AND (
                (s2.fch_hora_para >= v_fecha_ini::timestamptz
                 AND s2.fch_hora_para <= v_fecha_fin::timestamptz)
                OR s2.fch_para = v_fecha_ymd
              )
          )
          -- moviles con GPS hoy (join vía id TEXT → nro)
          -- gps_tracking_history.movil_id TEXT = m.id TEXT
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
      -- (activo ya está correcto desde el INSERT/UPDATE de arriba)
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

      -- Universo: moviles que esa fecha tuvieron pedido, service o GPS.
      -- Todos quedan como inactivos (activo=false), sin pendientes ni tamano_lote.
      -- last_gps_* = último punto de gps_tracking_history de ese día para el movil.
      --
      -- NORMALIZACIÓN: gps_tracking_history.movil_id es TEXT = moviles.id.
      -- Para incluir moviles con GPS: JOIN gps→moviles ON gth.movil_id = m.id,
      -- luego usar m.nro como movil_id. NUNCA comparar gth.movil_id con pedidos.movil.
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
        NULL           AS tamano_lote,         -- no aplica en fecha pasada
        NULL           AS pedidos_pendientes,  -- idem
        NULL           AS services_pendientes, -- idem
        -- Último GPS del día desde gps_tracking_history.
        -- gth.movil_id TEXT = m.id TEXT (normalización vía moviles).
        lp.latitud     AS last_gps_lat,
        lp.longitud    AS last_gps_lng,
        lp.fecha_hora  AS last_gps_datetime,
        false          AS activo,
        false          AS oculto_operativo,
        true           AS inactivo_del_dia,
        now()          AS updated_at
      FROM (
        -- Universo de nros con actividad ese día
        -- Fuentes distintas: pedidos (int=nro), services (int=nro), GPS (text=id→nro via moviles).
        -- NUNCA mezclar gps.movil_id con pedidos.movil directamente.
        SELECT DISTINCT u.nro
        FROM (
          -- Moviles referenciados en pedidos ese día
          SELECT p.movil AS nro
          FROM pedidos p
          WHERE p.fch_para = v_fecha_ymd
            AND p.movil IS NOT NULL
            AND p.movil <> 0
            AND (p_escenario IS NULL OR p.escenario = p_escenario)
            AND NOT (p.estado_nro = 2 AND p.sub_estado_nro = 17)  -- excluir REG. HISTORICO

          UNION

          -- Moviles referenciados en services ese día
          SELECT s.movil AS nro
          FROM services s
          WHERE s.movil IS NOT NULL
            AND s.movil <> 0
            AND (
              (s.fch_hora_para >= v_fecha_ini::timestamptz
               AND s.fch_hora_para <= v_fecha_fin::timestamptz)
              OR s.fch_para = v_fecha_ymd
            )

          UNION

          -- Moviles con GPS ese día — normalizar TEXT id → int nro via moviles
          -- gth.movil_id TEXT = m.id TEXT; usamos m.nro para el universo de nros.
          SELECT m_gps.nro
          FROM gps_tracking_history gth
          JOIN moviles m_gps ON m_gps.id = gth.movil_id   -- TEXT=TEXT (id→nro)
          WHERE gth.fecha_hora >= v_fecha::timestamp
            AND gth.fecha_hora <  (v_fecha::timestamp + interval '1 day')
            AND (p_escenario IS NULL OR m_gps.escenario_id = p_escenario)
        ) u
      ) ref
      JOIN moviles m ON m.nro = ref.nro   -- int=int
        AND (p_escenario IS NULL OR m.escenario_id = p_escenario)
      -- Último punto GPS de ese día para el movil
      -- gth.movil_id TEXT = m.id TEXT; m.id es el TEXT pk de moviles.
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

  -- Retorna el ROW_COUNT del último día procesado.
  -- Para conocer el total acumulado, el caller debe sumar por día.
  -- TODO confirm: ¿se prefiere retornar el total acumulado en vez del último día?
  RETURN v_rows;
END;
$$;
