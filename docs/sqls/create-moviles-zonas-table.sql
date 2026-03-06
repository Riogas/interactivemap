-- =====================================================================
-- 🔗 Tabla moviles_zonas (N:N entre móviles y zonas)
-- =====================================================================
--
-- PROPÓSITO:
--   Relacionar móviles con zonas (muchos a muchos).
--   La demora es propiedad de la zona, no de la asignación.
--   Se agrega demora_minutos a la tabla zonas.
--
-- EJECUTAR EN: Supabase SQL Editor
-- =====================================================================

-- 1️⃣ Tabla de relación N:N moviles ↔ zonas
CREATE TABLE IF NOT EXISTS moviles_zonas (
    id                BIGSERIAL PRIMARY KEY,
    movil_id          TEXT NOT NULL,
    zona_id           INT NOT NULL,
    escenario_id      INT DEFAULT 1000,
    activa            BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),

    -- Clave única: un móvil solo puede estar asignado 1 vez a cada zona
    CONSTRAINT moviles_zonas_unique UNIQUE (movil_id, zona_id)
);

-- 2️⃣ Índices
CREATE INDEX IF NOT EXISTS idx_moviles_zonas_movil ON moviles_zonas(movil_id);
CREATE INDEX IF NOT EXISTS idx_moviles_zonas_zona ON moviles_zonas(zona_id);
CREATE INDEX IF NOT EXISTS idx_moviles_zonas_escenario ON moviles_zonas(escenario_id);
CREATE INDEX IF NOT EXISTS idx_moviles_zonas_activa ON moviles_zonas(activa);

-- 3️⃣ Trigger updated_at
DROP TRIGGER IF EXISTS trigger_moviles_zonas_updated_at ON moviles_zonas;
CREATE TRIGGER trigger_moviles_zonas_updated_at
    BEFORE UPDATE ON moviles_zonas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4️⃣ Agregar demora_minutos a la tabla zonas (la demora es de la zona)
ALTER TABLE zonas
    ADD COLUMN IF NOT EXISTS demora_minutos INT DEFAULT 0;

-- 5️⃣ RLS (Row Level Security)
ALTER TABLE moviles_zonas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_moviles_zonas" ON moviles_zonas;
CREATE POLICY "public_read_moviles_zonas" ON moviles_zonas FOR SELECT USING (true);

DROP POLICY IF EXISTS "full_access_moviles_zonas" ON moviles_zonas;
CREATE POLICY "full_access_moviles_zonas" ON moviles_zonas FOR ALL USING (true) WITH CHECK (true);

-- 6️⃣ Publicar en Realtime (opcional)
-- ALTER PUBLICATION supabase_realtime ADD TABLE moviles_zonas;

-- =====================================================================
-- 📋 VERIFICACIÓN
-- =====================================================================
-- Ver la tabla:
--   SELECT * FROM moviles_zonas;
--
-- Móviles de una zona:
--   SELECT mz.*, m.descripcion as movil_nombre, z.nombre as zona_nombre
--   FROM moviles_zonas mz
--   JOIN moviles m ON m.id::text = mz.movil_id
--   JOIN zonas z ON z.zona_id = mz.zona_id
--   WHERE mz.zona_id = 1 AND mz.activa = true;
--
-- Zonas de un móvil (con demora de cada zona):
--   SELECT mz.*, z.nombre, z.color, z.demora_minutos
--   FROM moviles_zonas mz
--   JOIN zonas z ON z.zona_id = mz.zona_id
--   WHERE mz.movil_id = '693' AND mz.activa = true;
-- =====================================================================
