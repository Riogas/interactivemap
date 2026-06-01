-- ============================================================
-- Migration: fix pedidos.fch_para NULL → moviles_dia no cuenta pedidos
-- Fecha:  2026-06-01
-- Autor:  Implementer (pipeline /feature)
-- Aplicar manualmente en Supabase SQL Editor
--
-- PROBLEMA:
--   pedidos.fch_para (DATE) llega NULL desde la ingesta; sí existe
--   fch_hora_para (timestamptz) con el valor correcto.
--   fn_moviles_dia_recompute_counts filtra con:
--     WHERE fch_para = p_fecha OR fch_para = p_fecha - 1
--   NULL no matchea ninguna comparación → pedidos quedan invisibles
--   para moviles_dia.cant_pedidos / pedidos_pendientes.
--
--   Síntoma: móvil 136 tiene pedido asignado (estado_nro=1) pero
--   moviles_dia.pedidos_pendientes = 0; ficha y colapsable muestran 0/4.
--
-- SOLUCIÓN (capas de defensa):
--   1. Backfill: corregir todos los pedidos actuales con fch_para NULL.
--   2. Trigger BEFORE INSERT/UPDATE: prevenir futuros NULL en fch_para.
--   3. COALESCE en fn_moviles_dia_recompute_counts: red de seguridad.
--   4. COALESCE en fn_moviles_dia_rebuild: ídem para la selección
--      del universo de móviles (EXISTS predicates + WHERE directo).
--   5. Rebuild del día de hoy para reflejar el fix inmediatamente.
--
-- DEPENDENCIAS (deben estar aplicadas antes):
--   · 2026-05-27-create-moviles-dia.sql
--   · 2026-05-27-moviles-dia-functions.sql
--   · 2026-05-28-moviles-dia-functions-fix-fchpara-date.sql
--   · 2026-05-28-moviles-dia-triggers-pedidos-services.sql
--   · 2026-05-28-moviles-dia-rebuild-fix-services-escenario.sql
--   · 2026-05-29-moviles-dia-arrastre-dia-anterior.sql
--
-- Idempotente: usa CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
-- ============================================================

BEGIN;


-- ============================================================
-- SECCIÓN 1: Backfill de pedidos existentes con fch_para NULL
-- ============================================================
-- Propaga fch_hora_para → fch_para (DATE en zona América/Montevideo)
-- para todos los pedidos que llegaron con fch_para NULL.
-- Afecta únicamente filas donde fch_hora_para tiene valor.
DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE pedidos
  SET fch_para = (fch_hora_para AT TIME ZONE 'America/Montevideo')::date
  WHERE fch_para IS NULL
    AND fch_hora_para IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE '[fix-fch-para-null] Backfill: % fila(s) de pedidos actualizadas.', v_rows;
END;
$$;


-- ============================================================
-- SECCIÓN 2: Trigger BEFORE INSERT/UPDATE en pedidos
-- Previene futuros fch_para NULL si fch_hora_para llega con valor.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_pedidos_set_fch_para_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fch_para IS NULL AND NEW.fch_hora_para IS NOT NULL THEN
    NEW.fch_para := (NEW.fch_hora_para AT TIME ZONE 'America/Montevideo')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_set_fch_para ON pedidos;
CREATE TRIGGER trg_pedidos_set_fch_para
  BEFORE INSERT OR UPDATE OF fch_hora_para, fch_para ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_pedidos_set_fch_para_fn();


-- ============================================================
-- SECCIÓN 3: Red de seguridad en fn_moviles_dia_recompute_counts
-- (REEMPLAZA la versión de 2026-05-29-moviles-dia-arrastre-dia-anterior.sql)
--
-- Cambios respecto a la versión anterior:
--   - Todas las comparaciones directas fch_para = p_fecha y
--     fch_para = p_fecha - 1 en la sección de pedidos_pendientes
--     se reemplazan por COALESCE(fch_para, (fch_hora_para AT TIME ZONE
--     'America/Montevideo')::date) para tolerar fch_para NULL.
--   - La sección de services_pendientes y tiene_op NO se modifica:
--     services ya tiene fch_hora_para como criterio OR principal.
--   - El resto del body (activo, UPDATE) queda intacto.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_moviles_dia_recompute_counts(
  p_escenario integer,
  p_movil     integer,   -- moviles.nro (id logico)
  p_fecha     date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_fecha_inicio   text;
  v_fecha_fin      text;
  v_hoy_mvd        date;   -- hoy segun America/Montevideo
  v_es_hoy         boolean;
  v_ped_pend       integer;
  v_serv_pend      integer;
  v_tiene_op       boolean;
  v_activo         boolean;
BEGIN
  -- Hoy segun America/Montevideo (no current_date UTC crudo)
  v_hoy_mvd := (now() AT TIME ZONE 'America/Montevideo')::date;

  -- Literales de fecha para p_fecha (solo para casts de fch_hora_para timestamptz)
  v_fecha_inicio   := to_char(p_fecha, 'YYYY-MM-DD') || 'T00:00:00';
  v_fecha_fin      := to_char(p_fecha, 'YYYY-MM-DD') || 'T23:59:59';

  -- Bandera: esta fila es la del dia de hoy?
  v_es_hoy := (p_fecha = v_hoy_mvd);

  -- ── Pedidos pendientes ───────────────────────────────────────────────────────
  -- COALESCE defensivo: si fch_para es NULL se calcula desde fch_hora_para.
  -- Si es hoy: incluir (hoy, ayer) para el arrastre.
  -- Si es fecha pasada: solo ese dia (comportamiento original).
  SELECT COUNT(*)::integer INTO v_ped_pend
  FROM pedidos
  WHERE escenario  = p_escenario
    AND movil      = p_movil
    AND estado_nro = 1
    AND (
      COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      OR (v_es_hoy AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha - 1)
    );

  -- ── Services pendientes ──────────────────────────────────────────────────────
  -- Mantiene el OR con fch_hora_para (timestamptz) para services de hoy.
  -- Para el arrastre (v_es_hoy), agrega la rama fch_para = ayer.
  -- El arrastre de services se define SOLO por fch_para (no por fch_hora_para del dia anterior),
  -- alineado con la decision de la spec §5a.4.
  SELECT COUNT(*)::integer INTO v_serv_pend
  FROM services
  WHERE movil      = p_movil
    AND estado_nro = 1
    AND (
      (fch_hora_para >= v_fecha_inicio::timestamptz
       AND fch_hora_para <= v_fecha_fin::timestamptz)
      OR fch_para = p_fecha
      OR (v_es_hoy AND fch_para = p_fecha - 1)
    );

  -- ── tiene_op: cualquier pedido o service en la fecha (cualquier estado) ──────
  -- Sin cambios: tiene_op sigue evaluando solo la fecha propia del pedido.
  -- El movil reaparece por pedidos_pendientes > 0, no por tiene_op.
  v_tiene_op := (
    EXISTS (
      SELECT 1 FROM pedidos
      WHERE escenario  = p_escenario
        AND movil      = p_movil
        AND fch_para   = p_fecha
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
-- SECCIÓN 4: Red de seguridad en fn_moviles_dia_rebuild
-- (REEMPLAZA la versión de 2026-05-28-moviles-dia-rebuild-fix-services-escenario.sql)
--
-- Cambios respecto a la versión anterior:
--   CASO A (día en curso):
--     - EXISTS en pedidos: p2.fch_para = v_fecha →
--       COALESCE(p2.fch_para, (p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
--       (garantiza que el móvil con pedido fch_para NULL igualmente aparezca)
--   CASO B (fecha pasada):
--     - WHERE en rama pedidos: p.fch_para = v_fecha →
--       COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
--     - WHERE en rama services: s.fch_para = v_fecha →
--       COALESCE(s.fch_para, ...) = v_fecha  (ya tenía la rama fch_hora_para, solo el OR directo)
--   El resto del body queda intacto (CASO A services, GPS, ON CONFLICT, etc.).
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
    -- FIX: EXISTS de pedidos usa COALESCE(fch_para, ...) para tolerar NULL.
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
      -- recompute_counts ya incluye el COALESCE defensivo (Sección 3).
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


-- ============================================================
-- SECCIÓN 5: Rebuild del día de hoy
-- Aplica el fix retroactivamente para el día en curso.
-- fn_moviles_dia_rebuild internamente llama a fn_moviles_dia_recompute_counts
-- (ya con COALESCE) para todos los móviles del día.
-- ============================================================
SELECT fn_moviles_dia_rebuild(
  (now() AT TIME ZONE 'America/Montevideo')::date,
  (now() AT TIME ZONE 'America/Montevideo')::date,
  NULL
);


COMMIT;


-- ============================================================
-- VERIFICACIONES (ejecutar manualmente post-apply)
-- ============================================================

-- VER 1: Móvil 136 debe tener pedidos_pendientes > 0 para el día de hoy.
--        Si sigue en 0, verificar que el pedido tiene movil=136 y estado_nro=1.
SELECT escenario_id, movil_id, pedidos_pendientes
FROM moviles_dia
WHERE movil_id = 136
  AND fecha = (now() AT TIME ZONE 'America/Montevideo')::date;

-- VER 2: No deben quedar pedidos con fch_para NULL teniendo fch_hora_para.
--        Resultado esperado: COUNT = 0.
SELECT COUNT(*) AS pedidos_fch_para_null_restantes
FROM pedidos
WHERE fch_para IS NULL
  AND fch_hora_para IS NOT NULL;

-- VER 3: Verificar que el trigger existe y está activo.
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_pedidos_set_fch_para';

-- VER 4: Opcional — inspeccionar los pedidos del móvil 136 hoy.
SELECT id, escenario, movil, estado_nro, fch_para, fch_hora_para
FROM pedidos
WHERE movil = 136
  AND estado_nro = 1
ORDER BY fch_hora_para DESC
LIMIT 20;
