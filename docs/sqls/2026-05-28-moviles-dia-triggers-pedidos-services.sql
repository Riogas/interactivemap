-- ============================================================
-- Migration: triggers en pedidos y services para recompute en vivo de moviles_dia
-- Fecha: 2026-05-28
-- Aplicar manualmente en Supabase SQL Editor
-- Requiere (aplicar antes):
--   · 2026-05-27-create-moviles-dia.sql
--   · 2026-05-27-moviles-dia-functions.sql
--   · 2026-05-28-moviles-dia-functions-fix-fchpara-date.sql  ← CRÍTICO: fch_para es date, no text
-- ============================================================
--
-- PROPÓSITO:
--   Cerrar dos brechas de consistencia en moviles_dia.pedidos_pendientes
--   y moviles_dia.services_pendientes:
--
--   1. REASIGNACIÓN A→B: cuando un pedido/service pasa del móvil A al móvil B,
--      la capa de aplicación (/api/pedidos, /api/services) solo incluye B en la
--      respuesta al cliente. El conteo de A quedaba desactualizado hasta el próximo
--      polling. Estos triggers recomputan AMBOS móviles en la misma transacción.
--
--   2. LAG DE POLLING: el fire-and-forget de recompute_counts_bulk corre solo
--      cuando /api/pedidos o /api/services son consultados (hasta 180 s de lag).
--      Cualquier cambio en pedidos/services ahora dispara el recompute en tiempo real
--      desde la base de datos, independientemente del polling de la API.
--
-- DISEÑO:
--   · Solo se recomputa si la fila afectada corresponde a current_date.
--     Filas de fechas pasadas no tienen pendientes en moviles_dia y no deben tocarse.
--   · Se llama a fn_moviles_dia_recompute_counts(escenario, movil, current_date),
--     definida en 2026-05-27-moviles-dia-functions.sql y parcheada en
--     2026-05-28-moviles-dia-functions-fix-fchpara-date.sql (fch_para es date en prod).
--   · fch_para en ambas tablas es de tipo DATE en producción. Comparar siempre
--     con current_date (date = date), no con literales texto YYYYMMDD.
--   · services tiene además fch_hora_para (timestamptz). Se trata la fila como
--     "de hoy" si ALGUNA de las dos columnas indica hoy, espejando el criterio
--     de fn_moviles_dia_recompute_counts.
--   · En UPDATE se recomputan ambos lados (OLD y NEW) para cubrir reasignaciones.
--     Recomputar el mismo móvil dos veces es inocuo (un COUNT barato).
--   · RETURN NULL en triggers AFTER (valor ignorado por el motor).
--
-- COLUMNAS VERIFICADAS (types/supabase.ts):
--   pedidos : escenario integer, movil integer | null, fch_para date, estado_nro integer | null
--   services: escenario integer, movil integer | null, fch_para date,
--             fch_hora_para timestamptz | null, estado_nro integer | null
-- ============================================================


-- ============================================================
-- Trigger function 1: pedidos → moviles_dia
-- ============================================================
CREATE OR REPLACE FUNCTION trg_pedidos_to_moviles_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN

  IF TG_OP = 'INSERT' THEN
    -- Recompute el móvil asignado si la fecha del pedido es hoy.
    IF NEW.movil IS NOT NULL
       AND NEW.movil <> 0
       AND NEW.fch_para = current_date
    THEN
      PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, current_date);
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Recompute el móvil que tenía el pedido si era de hoy.
    IF OLD.movil IS NOT NULL
       AND OLD.movil <> 0
       AND OLD.fch_para = current_date
    THEN
      PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, current_date);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Siempre recompute el OLD móvil si era válido y de hoy.
    -- Esto cubre: cambio de estado, reasignación saliente, y cualquier otro update.
    IF OLD.movil IS NOT NULL
       AND OLD.movil <> 0
       AND OLD.fch_para = current_date
    THEN
      PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, current_date);
    END IF;

    -- Si el móvil o el escenario cambiaron, recompute también el NEW destino.
    -- Esto cierra la brecha de reasignación A→B: el móvil B que recibe el pedido
    -- actualiza su conteo en la misma transacción.
    -- Si el móvil no cambió, el bloque OLD ya fue suficiente (mismo móvil).
    IF (NEW.movil IS DISTINCT FROM OLD.movil
        OR NEW.escenario IS DISTINCT FROM OLD.escenario)
       AND NEW.movil IS NOT NULL
       AND NEW.movil <> 0
       AND NEW.fch_para = current_date
    THEN
      PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, current_date);
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
-- Trigger function 2: services → moviles_dia
-- ============================================================
--
-- NOTA sobre la condición de fecha en services:
--   services.fch_para (date) y services.fch_hora_para (timestamptz) son dos
--   columnas que pueden indicar la fecha del servicio. fn_moviles_dia_recompute_counts
--   usa un OR de ambas para contar pendientes; el trigger aplica el mismo criterio
--   para decidir si la fila corresponde a hoy:
--     fch_para = current_date
--     OR fch_hora_para::date = current_date
--   Así se garantiza que ninguna fila de hoy quede sin disparar el recompute.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_services_to_moviles_dia_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN

  IF TG_OP = 'INSERT' THEN
    IF NEW.movil IS NOT NULL
       AND NEW.movil <> 0
       AND (
         NEW.fch_para = current_date
         OR (NEW.fch_hora_para IS NOT NULL AND NEW.fch_hora_para::date = current_date)
       )
    THEN
      PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, current_date);
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.movil IS NOT NULL
       AND OLD.movil <> 0
       AND (
         OLD.fch_para = current_date
         OR (OLD.fch_hora_para IS NOT NULL AND OLD.fch_hora_para::date = current_date)
       )
    THEN
      PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, current_date);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Recompute el OLD móvil si el service era de hoy.
    IF OLD.movil IS NOT NULL
       AND OLD.movil <> 0
       AND (
         OLD.fch_para = current_date
         OR (OLD.fch_hora_para IS NOT NULL AND OLD.fch_hora_para::date = current_date)
       )
    THEN
      PERFORM fn_moviles_dia_recompute_counts(OLD.escenario, OLD.movil, current_date);
    END IF;

    -- Si el móvil o el escenario cambiaron, recompute también el NEW destino.
    IF (NEW.movil IS DISTINCT FROM OLD.movil
        OR NEW.escenario IS DISTINCT FROM OLD.escenario)
       AND NEW.movil IS NOT NULL
       AND NEW.movil <> 0
       AND (
         NEW.fch_para = current_date
         OR (NEW.fch_hora_para IS NOT NULL AND NEW.fch_hora_para::date = current_date)
       )
    THEN
      PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, current_date);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_services_to_moviles_dia ON services;
CREATE TRIGGER trg_services_to_moviles_dia
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION trg_services_to_moviles_dia_fn();


-- ─── Verificación (ejecutar manualmente post-apply) ───────────────────────────
--
-- PRE-CONDICIÓN: moviles_dia debe tener una fila para hoy con el móvil que vas
-- a usar. Si no existe, correr primero:
--   SELECT fn_moviles_dia_rebuild(current_date, current_date);
--
-- TEST 1 — Recompute en pedidos al cambiar estado_nro:
--
--   -- Anotar valor actual
--   SELECT pedidos_pendientes FROM moviles_dia
--     WHERE movil_id = <un_movil_nro> AND escenario_id = <escenario> AND fecha = current_date;
--
--   -- Disparar el trigger tocando un pedido de hoy (mismo móvil)
--   UPDATE pedidos SET estado_nro = estado_nro
--     WHERE movil = <un_movil_nro> AND escenario = <escenario>
--       AND fch_para = current_date
--     LIMIT 1;
--
--   -- Verificar que updated_at se renovó (conteo puede no cambiar si estado no varió,
--   -- pero el trigger SÍ disparó el recompute)
--   SELECT pedidos_pendientes, updated_at FROM moviles_dia
--     WHERE movil_id = <un_movil_nro> AND escenario_id = <escenario> AND fecha = current_date;
--
-- TEST 2 — Recompute en reasignación A→B:
--
--   -- Anotar pendientes de ambos móviles
--   SELECT movil_id, pedidos_pendientes FROM moviles_dia
--     WHERE movil_id IN (<movil_A>, <movil_B>) AND escenario_id = <escenario> AND fecha = current_date;
--
--   -- Reasignar pedido de A a B
--   UPDATE pedidos SET movil = <movil_B>
--     WHERE movil = <movil_A> AND escenario = <escenario>
--       AND fch_para = current_date AND estado_nro = 1
--     LIMIT 1;
--
--   -- Verificar que A bajó y B subió en la misma transacción
--   SELECT movil_id, pedidos_pendientes, updated_at FROM moviles_dia
--     WHERE movil_id IN (<movil_A>, <movil_B>) AND escenario_id = <escenario> AND fecha = current_date;
--   -- Esperado: movil_A.pedidos_pendientes decrementó, movil_B.pedidos_pendientes incrementó.
--
-- TEST 3 — services (análogo a TEST 2 pero en tabla services):
--
--   UPDATE services SET movil = <movil_B>
--     WHERE movil = <movil_A> AND escenario = <escenario>
--       AND fch_para = current_date AND estado_nro = 1
--     LIMIT 1;
--
--   SELECT movil_id, services_pendientes, updated_at FROM moviles_dia
--     WHERE movil_id IN (<movil_A>, <movil_B>) AND escenario_id = <escenario> AND fecha = current_date;
--   -- Esperado: movil_A.services_pendientes decrementó, movil_B.services_pendientes incrementó.
--
-- TEST 4 — Confirmar que filas de fechas pasadas NO disparan recompute:
--
--   UPDATE pedidos SET estado_nro = estado_nro
--     WHERE fch_para < current_date LIMIT 1;
--   -- El trigger debe ignorar la fila (condición fch_para = current_date no se cumple).
--   -- Sin efecto observable en moviles_dia.
