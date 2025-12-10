-- Consulta para verificar la estructura de la tabla pedidos
-- Ejecuta esto en Supabase SQL Editor

-- Ver columnas de la tabla pedidos
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'pedidos'
ORDER BY ordinal_position;

-- Verificar que Realtime está habilitado
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE tablename = 'pedidos';

-- Ver un pedido de ejemplo
SELECT * FROM pedidos LIMIT 1;
