-- =====================================================
-- DEBUG: Verificar qué empresas hay en la base de datos
-- =====================================================

-- Ver todas las empresas con su escenario_id
SELECT 
  empresa_fletera_id,
  escenario_id,
  nombre,
  estado,
  COUNT(*) OVER (PARTITION BY escenario_id) as empresas_por_escenario
FROM empresas_fleteras
ORDER BY escenario_id, nombre
LIMIT 20;

-- Ver cuántas empresas hay por escenario
SELECT 
  escenario_id,
  COUNT(*) as total_empresas,
  COUNT(CASE WHEN estado = 1 THEN 1 END) as empresas_activas
FROM empresas_fleteras
GROUP BY escenario_id
ORDER BY escenario_id;

-- Verificar RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'empresas_fleteras';
