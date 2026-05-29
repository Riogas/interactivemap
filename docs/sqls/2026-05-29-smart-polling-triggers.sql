-- ============================================================
-- Migration: smart polling — marca server-side de cambios en demoras y moviles_zonas
-- Fecha: 2026-05-29
-- Spec: docs/superpowers/specs/2026-05-29-polling-inteligente-demoras-moviles-zonas.md
-- Aplicar manualmente en Supabase SQL Editor
-- Dependencias: ninguna (independiente del refactor moviles_dia)
-- ============================================================
--
-- PROPÓSITO:
--   Evitar que los clientes refetcheen datos cuando nada cambió.
--   En lugar de llamar a /api/demoras y /api/moviles-zonas en cada tick del
--   polling, el frontend consulta primero una marca liviana (un timestamptz)
--   que se actualiza server-side cuando la tabla subyacente es modificada.
--   Solo si la marca es más nueva que el último fetch se dispara el request real.
--
-- ESTRATEGIA — FOR EACH STATEMENT (no FOR EACH ROW):
--   Un statement que toca 100 filas de demoras dispara el trigger UNA sola vez,
--   no 100 veces. El trigger toma todos los escenarios afectados con DISTINCT
--   y actualiza escenario_settings una sola vez por escenario distinto.
--   Esto hace que el costo sea O(escenarios afectados) y no O(filas afectadas).
--
-- TABLAS AFECTADAS:
--   · escenario_settings — recibe dos columnas nuevas de marca
--   · demoras            — 3 triggers FOR EACH STATEMENT
--   · moviles_zonas      — 3 triggers FOR EACH STATEMENT
--
-- TRANSITION TABLES (PostgreSQL ≥ 10):
--   INSERT → REFERENCING NEW TABLE AS new_rows
--   UPDATE → REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
--   DELETE → REFERENCING OLD TABLE AS old_rows
--   PostgreSQL no permite declarar OLD TABLE y NEW TABLE en un mismo trigger
--   si el evento no incluye ambas operaciones; por eso se crean 3 triggers
--   separados por evento, todos apuntando a la misma función trigger.
--   La función detecta TG_OP y accede solo a la transition table disponible.
--
-- INICIALIZACIÓN:
--   Al final del archivo se inicializan las marcas con now() para todas las
--   filas existentes de escenario_settings (COALESCE: no sobreescribe si ya
--   tiene valor, aunque en este deploy siempre será NULL la primera vez).
-- ============================================================


-- ============================================================
-- Step 1 — Columnas de marca en escenario_settings
-- ============================================================

ALTER TABLE escenario_settings
  ADD COLUMN IF NOT EXISTS demoras_last_api_update        timestamptz,
  ADD COLUMN IF NOT EXISTS moviles_zonas_last_api_update  timestamptz;


-- ============================================================
-- Step 2a — Trigger function: demoras → escenario_settings
-- ============================================================
--
-- Una sola función maneja INSERT/UPDATE/DELETE.
-- Cada evento usa solo la transition table que tiene disponible:
--   INSERT  → new_rows
--   UPDATE  → old_rows UNION new_rows  (cubre reasignaciones de escenario)
--   DELETE  → old_rows
--
-- La marca se actualiza una sola vez por escenario_id distinto afectado,
-- sin importar cuántas filas del statement pertenecen a ese escenario.

CREATE OR REPLACE FUNCTION trg_demoras_marca_smart_polling()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE escenario_settings es
       SET demoras_last_api_update = now()
     WHERE es.escenario_id IN (
       SELECT DISTINCT escenario_id
         FROM new_rows
        WHERE escenario_id IS NOT NULL
     );

  ELSIF TG_OP = 'UPDATE' THEN
    -- UNION cubre: cambio de escenario (old y new pueden diferir),
    -- cambio de estado puro (old = new, ambos son el mismo escenario).
    UPDATE escenario_settings es
       SET demoras_last_api_update = now()
     WHERE es.escenario_id IN (
       SELECT DISTINCT escenario_id FROM new_rows WHERE escenario_id IS NOT NULL
       UNION
       SELECT DISTINCT escenario_id FROM old_rows WHERE escenario_id IS NOT NULL
     );

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE escenario_settings es
       SET demoras_last_api_update = now()
     WHERE es.escenario_id IN (
       SELECT DISTINCT escenario_id
         FROM old_rows
        WHERE escenario_id IS NOT NULL
     );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_demoras_marca_ins ON demoras;
CREATE TRIGGER trg_demoras_marca_ins
  AFTER INSERT ON demoras
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_demoras_marca_smart_polling();

DROP TRIGGER IF EXISTS trg_demoras_marca_upd ON demoras;
CREATE TRIGGER trg_demoras_marca_upd
  AFTER UPDATE ON demoras
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_demoras_marca_smart_polling();

DROP TRIGGER IF EXISTS trg_demoras_marca_del ON demoras;
CREATE TRIGGER trg_demoras_marca_del
  AFTER DELETE ON demoras
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_demoras_marca_smart_polling();


-- ============================================================
-- Step 2b — Trigger function: moviles_zonas → escenario_settings
-- ============================================================
--
-- Mismo patrón que demoras, actualiza moviles_zonas_last_api_update.

CREATE OR REPLACE FUNCTION trg_moviles_zonas_marca_smart_polling()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE escenario_settings es
       SET moviles_zonas_last_api_update = now()
     WHERE es.escenario_id IN (
       SELECT DISTINCT escenario_id
         FROM new_rows
        WHERE escenario_id IS NOT NULL
     );

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE escenario_settings es
       SET moviles_zonas_last_api_update = now()
     WHERE es.escenario_id IN (
       SELECT DISTINCT escenario_id FROM new_rows WHERE escenario_id IS NOT NULL
       UNION
       SELECT DISTINCT escenario_id FROM old_rows WHERE escenario_id IS NOT NULL
     );

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE escenario_settings es
       SET moviles_zonas_last_api_update = now()
     WHERE es.escenario_id IN (
       SELECT DISTINCT escenario_id
         FROM old_rows
        WHERE escenario_id IS NOT NULL
     );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_moviles_zonas_marca_ins ON moviles_zonas;
CREATE TRIGGER trg_moviles_zonas_marca_ins
  AFTER INSERT ON moviles_zonas
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_moviles_zonas_marca_smart_polling();

DROP TRIGGER IF EXISTS trg_moviles_zonas_marca_upd ON moviles_zonas;
CREATE TRIGGER trg_moviles_zonas_marca_upd
  AFTER UPDATE ON moviles_zonas
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_moviles_zonas_marca_smart_polling();

DROP TRIGGER IF EXISTS trg_moviles_zonas_marca_del ON moviles_zonas;
CREATE TRIGGER trg_moviles_zonas_marca_del
  AFTER DELETE ON moviles_zonas
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_moviles_zonas_marca_smart_polling();


-- ============================================================
-- Step 3 — Inicializar marcas para escenarios existentes
-- ============================================================
--
-- COALESCE garantiza idempotencia: si este script se re-aplica,
-- las marcas ya existentes no se sobreescriben.
-- Al momento del primer deploy ambas columnas son NULL en todas
-- las filas, así que todas quedan inicializadas con now().

UPDATE escenario_settings
   SET demoras_last_api_update       = COALESCE(demoras_last_api_update, now()),
       moviles_zonas_last_api_update = COALESCE(moviles_zonas_last_api_update, now())
 WHERE demoras_last_api_update IS NULL
    OR moviles_zonas_last_api_update IS NULL;


-- ─── Verificación / Smoke tests (ejecutar manualmente post-apply) ─────────────
--
-- PRE-CONDICIÓN: necesitás al menos un escenario en escenario_settings y
-- al menos una fila en demoras / moviles_zonas con ese escenario_id.
--
-- TEST 1 — INSERT en demoras actualiza la marca:
--
--   -- Anotar marca actual
--   SELECT escenario_id, demoras_last_api_update
--     FROM escenario_settings
--    WHERE escenario_id = <escenario>;
--
--   -- Insertar una fila (o simular con noop si no querés datos basura)
--   INSERT INTO demoras (escenario_id, <otras_columnas_requeridas>)
--     VALUES (<escenario>, ...);
--
--   -- Verificar que la marca se renovó
--   SELECT escenario_id, demoras_last_api_update
--     FROM escenario_settings
--    WHERE escenario_id = <escenario>;
--   -- Esperado: demoras_last_api_update > valor anterior.
--
--
-- TEST 2 — UPDATE bulk (100 filas) → 1 sola actualización en escenario_settings:
--
--   -- Antes: anotar demoras_last_api_update y contar updates en escenario_settings
--   SELECT demoras_last_api_update FROM escenario_settings WHERE escenario_id = <escenario>;
--
--   -- Bulk update que toca N filas del mismo escenario
--   UPDATE demoras
--      SET updated_at = now()   -- o cualquier campo inocuo
--    WHERE escenario_id = <escenario>;
--
--   -- Verificar: la marca se actualizó UNA SOLA VEZ (no N veces),
--   -- confirmado porque escenario_settings tiene exactamente 1 fila por escenario
--   -- y el trigger FOR EACH STATEMENT corre una vez.
--   SELECT demoras_last_api_update FROM escenario_settings WHERE escenario_id = <escenario>;
--   -- Esperado: timestamp más nuevo que el anotado antes.
--
--
-- TEST 3 — DELETE en demoras actualiza la marca:
--
--   -- Anotar marca
--   SELECT demoras_last_api_update FROM escenario_settings WHERE escenario_id = <escenario>;
--
--   -- Borrar una o varias filas
--   DELETE FROM demoras WHERE escenario_id = <escenario> AND <condicion_segura> LIMIT 1;
--
--   -- Verificar
--   SELECT demoras_last_api_update FROM escenario_settings WHERE escenario_id = <escenario>;
--   -- Esperado: timestamp renovado.
--
--
-- TEST 4 — moviles_zonas (análogo a TEST 2, verifica moviles_zonas_last_api_update):
--
--   SELECT moviles_zonas_last_api_update FROM escenario_settings WHERE escenario_id = <escenario>;
--
--   UPDATE moviles_zonas SET updated_at = now() WHERE escenario_id = <escenario>;
--
--   SELECT moviles_zonas_last_api_update FROM escenario_settings WHERE escenario_id = <escenario>;
--   -- Esperado: timestamp renovado, una sola escritura a escenario_settings.
--
--
-- TEST 5 — UPDATE que cambia el escenario_id de una fila (reasignación):
--
--   -- Ambos escenarios (old y new) deben recibir la marca actualizada.
--   SELECT escenario_id, demoras_last_api_update FROM escenario_settings
--    WHERE escenario_id IN (<escenario_A>, <escenario_B>);
--
--   UPDATE demoras SET escenario_id = <escenario_B>
--    WHERE escenario_id = <escenario_A> AND <condicion_segura> LIMIT 1;
--
--   SELECT escenario_id, demoras_last_api_update FROM escenario_settings
--    WHERE escenario_id IN (<escenario_A>, <escenario_B>);
--   -- Esperado: ambos escenarios con demoras_last_api_update renovado.
