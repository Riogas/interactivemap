-- =====================================================
-- MIGRACIÓN: Eliminar usuario_id y actualizar constraints
-- =====================================================

-- 1. Eliminar constraint de foreign key si existe
ALTER TABLE puntos_interes 
DROP CONSTRAINT IF EXISTS puntos_interes_usuario_id_fkey;

-- 2. Eliminar constraint unique que usa usuario_id
ALTER TABLE puntos_interes 
DROP CONSTRAINT IF EXISTS puntos_interes_unique_usuario_nombre;

-- 3. Hacer usuario_id nullable
ALTER TABLE puntos_interes 
ALTER COLUMN usuario_id DROP NOT NULL;

-- 4. Hacer usuario_email obligatorio
ALTER TABLE puntos_interes 
ALTER COLUMN usuario_email SET NOT NULL;

-- 5. Recrear constraint unique con usuario_email
ALTER TABLE puntos_interes
ADD CONSTRAINT puntos_interes_unique_usuario_nombre 
UNIQUE (usuario_email, nombre);

-- 6. Eliminar índice viejo de usuario_id si existe
DROP INDEX IF EXISTS idx_puntos_interes_usuario_id;

-- 7. Crear índice en usuario_email
CREATE INDEX IF NOT EXISTS idx_puntos_interes_usuario_email 
ON puntos_interes(usuario_email);

-- 8. Verificar que todo quedó bien
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'puntos_interes'
ORDER BY ordinal_position;

-- 9. Ver constraints
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'puntos_interes'::regclass;

-- =====================================================
-- FIN DE MIGRACIÓN
-- =====================================================
