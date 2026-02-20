-- ============================================
-- 📦 Habilitar Realtime para tabla PEDIDOS
-- ============================================
-- Ejecuta este script en Supabase SQL Editor
--
-- Este script habilita las actualizaciones en tiempo real
-- para la tabla pedidos, permitiendo que el dashboard
-- reciba notificaciones instantáneas de cambios.
--
-- Fecha: 2025-12-01
-- ============================================

-- 1. Habilitar Realtime en la tabla pedidos
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;

-- 2. Verificar que se habilitó correctamente
SELECT 
    schemaname, 
    tablename,
    'Realtime habilitado ✅' as status
FROM pg_publication_tables 
WHERE tablename = 'pedidos';

-- Resultado esperado:
-- schemaname | tablename | status
-- -----------+-----------+---------------------------
-- public     | pedidos   | Realtime habilitado ✅

-- 3. (OPCIONAL) Ver configuración completa de Realtime
SELECT 
    p.pubname as publication_name,
    pt.schemaname,
    pt.tablename
FROM pg_publication p
JOIN pg_publication_tables pt ON p.pubname = pt.pubname
WHERE pt.tablename IN ('pedidos', 'gps_tracking_extended', 'moviles')
ORDER BY pt.tablename;

-- ============================================
-- 🧪 PRUEBAS DE REALTIME
-- ============================================

-- Test 1: Insertar un pedido de prueba
-- Este pedido debería aparecer automáticamente en el mapa
INSERT INTO pedidos (
    pedido_id,
    escenario_id,
    movil,
    estado,
    latitud,
    longitud,
    zona,
    tipo,
    producto_codigo,
    producto_nombre,
    producto_cantidad,
    prioridad,
    fecha_para,
    fecha_hora_para,
    cliente_nombre,
    cliente_direccion,
    cliente_nro
) VALUES (
    999999,  -- ID único temporal
    1,       -- escenario_id
    251,     -- movil (ajusta según tu caso)
    1,       -- estado
    '-34.9011120',  -- latitud (Montevideo)
    '-56.1645320',  -- longitud (Montevideo)
    5,       -- zona
    'Pedidos',
    'TEST_RT',
    'Pedido de Prueba Realtime',
    '1.00',
    5,       -- prioridad alta
    CURRENT_DATE,
    NOW() + INTERVAL '2 hours',
    'Cliente Realtime Test',
    'Av. Test Realtime',
    '1234'
);

-- Espera 1-2 segundos y verifica en el mapa...
-- Deberías ver un marcador naranja 📦 aparecer

-- Test 2: Actualizar el pedido (cambiar prioridad)
UPDATE pedidos 
SET 
    prioridad = 10,
    observacion = 'Actualizado en tiempo real'
WHERE pedido_id = 999999;

-- El marcador debería actualizarse sin recargar

-- Test 3: Marcar como cumplido (debería desaparecer del mapa)
UPDATE pedidos 
SET fecha_hora_cumplido = NOW()
WHERE pedido_id = 999999;

-- El marcador debería desaparecer automáticamente

-- Test 4: Limpiar pedido de prueba
DELETE FROM pedidos WHERE pedido_id = 999999;

-- ============================================
-- 📊 CONSULTAS ÚTILES
-- ============================================

-- Ver todos los pedidos pendientes de un móvil
SELECT 
    pedido_id,
    movil,
    cliente_nombre,
    producto_nombre,
    prioridad,
    fecha_hora_para,
    estado,
    latitud,
    longitud
FROM pedidos
WHERE 
    movil = 251  -- Ajusta el ID del móvil
    AND fecha_hora_cumplido IS NULL
    AND latitud IS NOT NULL
    AND longitud IS NOT NULL
ORDER BY prioridad DESC, fecha_hora_para ASC;

-- Contar pedidos pendientes por móvil
SELECT 
    movil,
    COUNT(*) as pedidos_pendientes,
    SUM(CASE WHEN prioridad >= 4 THEN 1 ELSE 0 END) as urgentes
FROM pedidos
WHERE 
    escenario_id = 1
    AND fecha_hora_cumplido IS NULL
    AND latitud IS NOT NULL
    AND longitud IS NOT NULL
GROUP BY movil
ORDER BY pedidos_pendientes DESC;

-- Ver últimas actualizaciones
SELECT 
    pedido_id,
    movil,
    cliente_nombre,
    updated_at,
    CASE 
        WHEN fecha_hora_cumplido IS NOT NULL THEN 'Cumplido'
        WHEN fecha_hora_asignado IS NOT NULL THEN 'Asignado'
        ELSE 'Pendiente'
    END as estado_actual
FROM pedidos
WHERE escenario_id = 1
ORDER BY updated_at DESC
LIMIT 10;

-- ============================================
-- 🔧 TROUBLESHOOTING
-- ============================================

-- Si Realtime no funciona, verificar:

-- 1. ¿La tabla está en la publicación?
SELECT tablename 
FROM pg_publication_tables 
WHERE tablename = 'pedidos';

-- Si no aparece, ejecutar:
-- ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;

-- 2. ¿Hay permisos de lectura?
SELECT grantee, privilege_type 
FROM information_schema.table_privileges 
WHERE table_name = 'pedidos';

-- 3. Ver todas las tablas con Realtime habilitado
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- ============================================
-- 💡 NOTAS IMPORTANTES
-- ============================================
/*
1. Realtime funciona a nivel de ROW (fila)
   - Cada INSERT/UPDATE/DELETE genera un evento
   
2. Los eventos son filtrados en el cliente
   - El hook filtra por escenario_id y movil
   
3. Limitaciones de Realtime:
   - No funciona con RLS (Row Level Security) por defecto
   - Requiere permisos de SELECT en la tabla
   - Los cambios deben ser vía Supabase (no directo a Postgres)
   
4. Rendimiento:
   - Realtime es eficiente para < 1000 cambios/segundo
   - Para más, considerar debouncing o batching
   
5. Debugging:
   - Abre DevTools → Console
   - Busca logs: "📦 Nuevo pedido recibido"
   - Verifica: "✅ Conectado a Realtime Pedidos"
*/

-- ============================================
-- ✅ CHECKLIST FINAL
-- ============================================
/*
□ Ejecutar: ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
□ Verificar en pg_publication_tables que aparece 'pedidos'
□ Abrir dashboard en http://localhost:3000/dashboard
□ Seleccionar un móvil de la lista
□ Abrir DevTools (F12) → Console
□ Buscar: "✅ Conectado a Realtime Pedidos"
□ Ejecutar INSERT de prueba (pedido_id = 999999)
□ Verificar que aparece marcador 📦 en el mapa
□ Ejecutar UPDATE para marcar como cumplido
□ Verificar que el marcador desaparece
□ Ejecutar DELETE para limpiar
□ ¡Realtime funcionando! 🎉
*/
