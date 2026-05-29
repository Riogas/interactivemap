-- ============================================================
-- Migration: arrastre de pendientes del dia anterior en moviles_dia
-- Fecha: 2026-05-29
-- Aplicar manualmente en Supabase SQL Editor
-- Requiere (aplicar antes):
--   · 2026-05-27-create-moviles-dia.sql
--   · 2026-05-27-moviles-dia-functions.sql
--   · 2026-05-28-moviles-dia-functions-fix-fchpara-date.sql
--   · 2026-05-28-moviles-dia-triggers-pedidos-services.sql
-- Idempotente: usa CREATE OR REPLACE en todas las funciones/triggers.
-- ============================================================
--
-- PROPOSITO:
--   Ampliar la definicion de "pendiente" en la vista del dia actual:
--   Solo cuando p_fecha = hoy (America/Montevideo), los conteos de
--   pedidos_pendientes y services_pendientes incluyen tambien
--   fch_para = ayer (D-1 estricto).
--
--   Afecta:
--   1. fn_moviles_dia_recompute_counts: logica dual hoy/ayer con TZ correcta.
--   2. trg_pedidos_to_moviles_dia_fn: doble disparo cuando fch_para = ayer.
--   3. trg_services_to_moviles_dia_fn: idem para services.
--
-- NOTAS DE DISEÑO:
--   · "Hoy Montevideo" se calcula como (now() AT TIME ZONE 'America/Montevideo')::date
--     en lugar de current_date (que usa el TZ de la sesion/servidor DB — puede ser UTC).
--     En la franja 21:00-24:00 UY, current_date UTC ya es el dia siguiente.
--   · fch_para en pedidos y services es de tipo DATE en produccion
--     (segun 2026-05-28-moviles-dia-triggers-pedidos-services.sql:41-43).
--     Las comparaciones fch_para = <date> son tipo-safe.
--   · El arrastre aplica SOLO a pendientes (estado_nro = 1).
--     Finalizados (estado_nro = 2) no cambian: siguen keyed por su fch_para original.
--   · tiene_op y flags NO se tocan: siguen evaluando solo la fecha propia del pedido.
--   · Filas de dias pasados en moviles_dia quedan con conteo dual "sucio" — aceptado,
--     ya que los dias pasados fuerzan la vista a "finalizados" (dashboard/page.tsx:704-717)
--     y el conteo sucio es inofensivo.
-- ============================================================


-- ============================================================
-- 1. fn_moviles_dia_recompute_counts (REEMPLAZA la version anterior)
--    Cambios respecto a la version original:
--    - Calcula v_hoy_mvd con TZ America/Montevideo (no current_date crudo).
--    - Si p_fecha = hoy, incluye fch_para = ayer en el conteo de pendientes.
--    - Resto de la funcion (tiene_op, activo, UPDATE) sin cambios.
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
  -- Si es hoy: incluir fch_para IN (hoy, ayer) para el arrastre.
  -- Si es fecha pasada: solo fch_para = ese dia (comportamiento original).
  SELECT COUNT(*)::integer INTO v_ped_pend
  FROM pedidos
  WHERE escenario  = p_escenario
    AND movil      = p_movil
    AND estado_nro = 1
    AND (
      fch_para = p_fecha
      OR (v_es_hoy AND fch_para = p_fecha - 1)
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
-- 2. trg_pedidos_to_moviles_dia_fn (REEMPLAZA la version anterior)
--    Cambios respecto a la version original:
--    - Reemplaza current_date por v_hoy (con TZ America/Montevideo).
--    - Doble disparo: si fch_para = ayer, recomputa la fila de HOY del movil.
--    - Cubre INSERT, DELETE y UPDATE (ambos lados OLD/NEW en reasignaciones).
-- ============================================================
CREATE OR REPLACE FUNCTION trg_pedidos_to_moviles_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_hoy  date;
  v_ayer date;
BEGIN
  -- Hoy segun America/Montevideo
  v_hoy  := (now() AT TIME ZONE 'America/Montevideo')::date;
  v_ayer := v_hoy - 1;

  IF TG_OP = 'INSERT' THEN
    IF NEW.movil IS NOT NULL AND NEW.movil <> 0 THEN
      IF NEW.fch_para = v_hoy THEN
        -- Pedido de hoy: recomputa fila de hoy (comportamiento original, con TZ correcto)
        PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
      ELSIF NEW.fch_para = v_ayer THEN
        -- Arrastre: pedido de ayer que cambia -> recomputa fila de HOY del movil
        PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.movil IS NOT NULL AND OLD.movil <> 0 THEN
      IF OLD.fch_para = v_hoy THEN
        PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, v_hoy);
      ELSIF OLD.fch_para = v_ayer THEN
        PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, v_hoy);
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Recomputa el OLD movil (saliente) si la fila era de hoy o de ayer
    IF OLD.movil IS NOT NULL AND OLD.movil <> 0 THEN
      IF OLD.fch_para = v_hoy OR OLD.fch_para = v_ayer THEN
        PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, v_hoy);
      END IF;
    END IF;

    -- Si el movil o escenario cambiaron, recomputa tambien el NEW destino
    -- (cierra la brecha de reasignacion A->B)
    IF (NEW.movil IS DISTINCT FROM OLD.movil
        OR NEW.escenario IS DISTINCT FROM OLD.escenario)
       AND NEW.movil IS NOT NULL
       AND NEW.movil <> 0
    THEN
      IF NEW.fch_para = v_hoy OR NEW.fch_para = v_ayer THEN
        PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_to_moviles_dia ON pedidos;
CREATE TRIGGER trg_pedidos_to_moviles_dia
  AFTER INSERT OR UPDATE OR DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_pedidos_to_moviles_dia_fn();


-- ============================================================
-- 3. trg_services_to_moviles_dia_fn (REEMPLAZA la version anterior)
--    Cambios respecto a la version original:
--    - Reemplaza current_date por v_hoy (con TZ America/Montevideo).
--    - Doble disparo: si fch_para = ayer (o fch_hora_para::date = ayer),
--      recomputa la fila de HOY del movil.
--    - Mantiene el criterio OR fch_hora_para para determinar si es "hoy/ayer".
-- ============================================================
CREATE OR REPLACE FUNCTION trg_services_to_moviles_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_hoy  date;
  v_ayer date;
BEGIN
  v_hoy  := (now() AT TIME ZONE 'America/Montevideo')::date;
  v_ayer := v_hoy - 1;

  IF TG_OP = 'INSERT' THEN
    IF NEW.movil IS NOT NULL AND NEW.movil <> 0 THEN
      IF NEW.fch_para = v_hoy
         OR (NEW.fch_hora_para IS NOT NULL AND NEW.fch_hora_para::date = v_hoy)
      THEN
        PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
      ELSIF NEW.fch_para = v_ayer
         OR (NEW.fch_hora_para IS NOT NULL AND NEW.fch_hora_para::date = v_ayer)
      THEN
        -- Arrastre: service de ayer -> recomputa fila de HOY
        PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.movil IS NOT NULL AND OLD.movil <> 0 THEN
      IF OLD.fch_para = v_hoy
         OR (OLD.fch_hora_para IS NOT NULL AND OLD.fch_hora_para::date = v_hoy)
         OR OLD.fch_para = v_ayer
         OR (OLD.fch_hora_para IS NOT NULL AND OLD.fch_hora_para::date = v_ayer)
      THEN
        PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, v_hoy);
      END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Recomputa el OLD movil si era de hoy o de ayer
    IF OLD.movil IS NOT NULL AND OLD.movil <> 0 THEN
      IF OLD.fch_para = v_hoy
         OR (OLD.fch_hora_para IS NOT NULL AND OLD.fch_hora_para::date = v_hoy)
         OR OLD.fch_para = v_ayer
         OR (OLD.fch_hora_para IS NOT NULL AND OLD.fch_hora_para::date = v_ayer)
      THEN
        PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, v_hoy);
      END IF;
    END IF;

    -- Si el movil o escenario cambiaron, recomputa el NEW destino
    IF (NEW.movil IS DISTINCT FROM OLD.movil
        OR NEW.escenario IS DISTINCT FROM OLD.escenario)
       AND NEW.movil IS NOT NULL
       AND NEW.movil <> 0
    THEN
      IF NEW.fch_para = v_hoy
         OR (NEW.fch_hora_para IS NOT NULL AND NEW.fch_hora_para::date = v_hoy)
         OR NEW.fch_para = v_ayer
         OR (NEW.fch_hora_para IS NOT NULL AND NEW.fch_hora_para::date = v_ayer)
      THEN
        PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_services_to_moviles_dia ON services;
CREATE TRIGGER trg_services_to_moviles_dia
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION trg_services_to_moviles_dia_fn();


-- ─── Bloque de verificacion (ejecutar manualmente post-apply) ────────────────
--
-- PRE-CONDICION: moviles_dia debe tener una fila para hoy con el movil de prueba.
-- Si no existe, correr primero:
--   SELECT fn_moviles_dia_rebuild(current_date, current_date);
--
-- TEST 1 — Recompute incluye arrastre de ayer:
--
--   -- Anotar valor actual
--   SELECT pedidos_pendientes FROM moviles_dia
--     WHERE movil_id = <movil_nro> AND escenario_id = <escenario>
--       AND fecha = (now() AT TIME ZONE 'America/Montevideo')::date;
--
--   -- Insertar un pedido de ayer (estado=1) para ese movil
--   INSERT INTO pedidos (escenario, movil, estado_nro, fch_para, ...)
--     VALUES (<escenario>, <movil_nro>, 1, (now() AT TIME ZONE 'America/Montevideo')::date - 1, ...);
--
--   -- Verificar que pedidos_pendientes de HOY incremento (trigger doble disparo)
--   SELECT pedidos_pendientes FROM moviles_dia
--     WHERE movil_id = <movil_nro> AND escenario_id = <escenario>
--       AND fecha = (now() AT TIME ZONE 'America/Montevideo')::date;
--
-- TEST 2 — Recompute manual con fecha pasada NO incluye arrastre:
--
--   SELECT fn_moviles_dia_recompute_counts(<escenario>, <movil_nro>, current_date - 7);
--   -- El conteo debe reflejar solo los pedidos de ese dia pasado exacto.
--
-- TEST 3 — Finalizar el pedido de ayer lo saca de pendientes de HOY:
--
--   UPDATE pedidos SET estado_nro = 2
--     WHERE movil = <movil_nro> AND escenario = <escenario>
--       AND fch_para = (now() AT TIME ZONE 'America/Montevideo')::date - 1
--       AND estado_nro = 1
--     LIMIT 1;
--
--   -- pedidos_pendientes de HOY debe decrementar
--   SELECT pedidos_pendientes FROM moviles_dia
--     WHERE movil_id = <movil_nro> AND escenario_id = <escenario>
--       AND fecha = (now() AT TIME ZONE 'America/Montevideo')::date;
--
-- TEST 4 — Verificacion de TZ en franja nocturna (21:00-24:00 UY):
--   SHOW timezone;  -- Verificar el TZ de la sesion DB
--   SELECT (now() AT TIME ZONE 'America/Montevideo')::date AS hoy_mvd, current_date AS current_date_db;
--   -- Si current_date_db != hoy_mvd entre 21:00-24:00 UY, la conversion explicita es critica.
-- ─────────────────────────────────────────────────────────────────────────────
