-- =====================================================================
-- 🔑 Unique constraint para tabla demoras (clave natural)
-- =====================================================================
--
-- PROPÓSITO:
--   Permitir UPSERT desde AS400 sin necesitar demora_id.
--   La combinación (escenario_id, zona_id, zona_tipo, descripcion)
--   identifica de forma única cada registro de demora.
--
-- FORMATO AS400:
--   { EscenarioId, TipoDeZona, TipoDeServicio, CodZonas: [{ Zona, ZonaActiva, Demora }] }
--
-- MAPPING:
--   EscenarioId    → escenario_id
--   TipoDeZona     → zona_tipo
--   TipoDeServicio → descripcion
--   Zona           → zona_id (INT)
--   ZonaActiva S/N → activa true/false
--   Demora         → minutos
--
-- EJECUTAR EN: Supabase SQL Editor
-- =====================================================================

-- 1️⃣ Autoincrement en demora_id (la tabla original lo tiene como INT sin secuencia)
CREATE SEQUENCE IF NOT EXISTS demoras_demora_id_seq;
SELECT setval('demoras_demora_id_seq', GREATEST(COALESCE((SELECT MAX(demora_id) FROM demoras), 0), 1));
ALTER TABLE demoras ALTER COLUMN demora_id SET DEFAULT nextval('demoras_demora_id_seq');
ALTER SEQUENCE demoras_demora_id_seq OWNED BY demoras.demora_id;

-- 2️⃣ Unique constraint en la clave natural
-- (permite upsert con onConflict: 'escenario_id,zona_id,zona_tipo,descripcion')
ALTER TABLE demoras
    ADD CONSTRAINT demoras_natural_key
    UNIQUE (escenario_id, zona_id, zona_tipo, descripcion);

-- 3️⃣ Índice compuesto para búsquedas frecuentes por escenario + zona_tipo
CREATE INDEX IF NOT EXISTS idx_demoras_escenario_tipo
    ON demoras(escenario_id, zona_tipo);

-- =====================================================================
-- 📋 VERIFICACIÓN
-- =====================================================================
-- Ver constraints:
--   SELECT constraint_name, constraint_type
--   FROM information_schema.table_constraints
--   WHERE table_name = 'demoras';
--
-- Probar upsert manualmente:
--   INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
--   VALUES (1000, 10, 'Distribucion', 'URGENTE', 30, true)
--   ON CONFLICT (escenario_id, zona_id, zona_tipo, descripcion)
--   DO UPDATE SET minutos = EXCLUDED.minutos, activa = EXCLUDED.activa, updated_at = NOW();
--
-- Ver demoras por escenario:
--   SELECT * FROM demoras WHERE escenario_id = 1000 AND zona_tipo = 'Distribucion'
--   ORDER BY zona_id;
-- =====================================================================
