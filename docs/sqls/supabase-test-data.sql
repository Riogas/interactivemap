-- =====================================================
-- DATOS DE PRUEBA PARA TRACKMOVIL
-- =====================================================
-- Ejecutar DESPUÉS de supabase-setup.sql
-- =====================================================

-- 1️⃣ INSERTAR EMPRESAS FLETERAS DE PRUEBA
-- =====================================================

INSERT INTO empresas_fleteras (
  escenario_id, 
  nombre, 
  razon_social, 
  estado
) VALUES 
  (1, 'Logística del Sur', 'Logística del Sur S.A.', 1),
  (1, 'Transportes Rápidos SA', 'Transportes Rápidos Sociedad Anónima', 1),
  (1, 'Distribuidora Norte', 'Distribuidora Norte Ltda.', 1)
ON CONFLICT (escenario_id, nombre) 
DO UPDATE SET 
  razon_social = EXCLUDED.razon_social,
  estado = EXCLUDED.estado,
  updated_at = NOW();

-- Verificar empresas insertadas
SELECT empresa_fletera_id, nombre, estado 
FROM empresas_fleteras 
WHERE escenario_id = 1
ORDER BY empresa_fletera_id;

-- 2️⃣ INSERTAR MÓVILES DE PRUEBA
-- =====================================================

-- Obtener IDs de empresas (ajustar según tus datos)
DO $$
DECLARE
  empresa1_id INTEGER;
  empresa2_id INTEGER;
BEGIN
  -- Obtener IDs de las empresas
  SELECT empresa_fletera_id INTO empresa1_id 
  FROM empresas_fleteras 
  WHERE nombre = 'Logística del Sur' AND escenario_id = 1
  LIMIT 1;
  
  SELECT empresa_fletera_id INTO empresa2_id 
  FROM empresas_fleteras 
  WHERE nombre = 'Transportes Rápidos SA' AND escenario_id = 1
  LIMIT 1;
  
  -- Insertar móviles
  INSERT INTO moviles (
    movil, 
    escenario_id, 
    empresa_fletera_id, 
    matricula, 
    mostrar_en_mapa, 
    estado
  ) VALUES 
    ('101', 1, empresa1_id, 'ABC-1234', true, 1),
    ('102', 1, empresa1_id, 'DEF-5678', true, 1),
    ('201', 1, empresa2_id, 'GHI-9012', true, 1),
    ('202', 1, empresa2_id, 'JKL-3456', true, 1)
  ON CONFLICT (movil, escenario_id, empresa_fletera_id) 
  DO UPDATE SET 
    matricula = EXCLUDED.matricula,
    mostrar_en_mapa = EXCLUDED.mostrar_en_mapa,
    updated_at = NOW();
    
  RAISE NOTICE 'Móviles insertados para empresas % y %', empresa1_id, empresa2_id;
END $$;

-- Verificar móviles insertados
SELECT m.movil, m.matricula, e.nombre as empresa
FROM moviles m
JOIN empresas_fleteras e ON m.empresa_fletera_id = e.empresa_fletera_id
WHERE m.escenario_id = 1
ORDER BY m.movil;

-- 3️⃣ INSERTAR POSICIONES GPS DE PRUEBA
-- =====================================================

-- Posiciones en Montevideo, Uruguay (zona del Centro)
INSERT INTO gps_tracking_extended (
  movil, 
  escenario_id, 
  latitud, 
  longitud, 
  fecha_hora,
  velocidad,
  bearing,
  accuracy,
  battery_level
) VALUES 
  -- Móvil 101 - Plaza Independencia
  ('101', 1, -34.9058, -56.2012, NOW() - INTERVAL '5 minutes', 25.5, 90, 10, 85),
  ('101', 1, -34.9061, -56.2008, NOW() - INTERVAL '3 minutes', 30.0, 95, 8, 84),
  ('101', 1, -34.9065, -56.2003, NOW(), 28.3, 92, 12, 83),
  
  -- Móvil 102 - Pocitos
  ('102', 1, -34.9088, -56.1538, NOW() - INTERVAL '10 minutes', 40.0, 180, 15, 92),
  ('102', 1, -34.9095, -56.1545, NOW() - INTERVAL '5 minutes', 35.5, 185, 10, 91),
  ('102', 1, -34.9102, -56.1552, NOW(), 32.0, 183, 8, 90),
  
  -- Móvil 201 - Buceo
  ('201', 1, -34.8965, -56.1420, NOW() - INTERVAL '8 minutes', 50.2, 270, 20, 78),
  ('201', 1, -34.8968, -56.1445, NOW() - INTERVAL '4 minutes', 45.8, 268, 18, 77),
  ('201', 1, -34.8971, -56.1470, NOW(), 48.5, 272, 15, 76),
  
  -- Móvil 202 - Carrasco
  ('202', 1, -34.8735, -56.0512, NOW() - INTERVAL '15 minutes', 60.0, 45, 25, 88),
  ('202', 1, -34.8710, -56.0485, NOW() - INTERVAL '8 minutes', 55.3, 48, 20, 87),
  ('202', 1, -34.8685, -56.0458, NOW(), 52.7, 46, 18, 86);

-- Verificar posiciones insertadas
SELECT 
  movil, 
  latitud, 
  longitud, 
  fecha_hora,
  velocidad,
  battery_level
FROM gps_tracking_extended
WHERE escenario_id = 1
ORDER BY movil, fecha_hora DESC;

-- 4️⃣ RESUMEN DE DATOS INSERTADOS
-- =====================================================

DO $$
DECLARE
  count_empresas INTEGER;
  count_moviles INTEGER;
  count_gps INTEGER;
BEGIN
  SELECT COUNT(*) INTO count_empresas FROM empresas_fleteras WHERE escenario_id = 1;
  SELECT COUNT(*) INTO count_moviles FROM moviles WHERE escenario_id = 1;
  SELECT COUNT(*) INTO count_gps FROM gps_tracking_extended WHERE escenario_id = 1;
  
  RAISE NOTICE '==========================================';
  RAISE NOTICE '📊 RESUMEN DE DATOS INSERTADOS';
  RAISE NOTICE '==========================================';
  RAISE NOTICE '✅ Empresas fleteras: %', count_empresas;
  RAISE NOTICE '✅ Móviles: %', count_moviles;
  RAISE NOTICE '✅ Posiciones GPS: %', count_gps;
  RAISE NOTICE '==========================================';
END $$;

-- 5️⃣ CONSULTA PARA VERIFICAR TODO JUNTO
-- =====================================================

SELECT 
  e.nombre as empresa,
  m.movil,
  m.matricula,
  g.latitud,
  g.longitud,
  g.fecha_hora,
  g.velocidad
FROM empresas_fleteras e
JOIN moviles m ON e.empresa_fletera_id = m.empresa_fletera_id
LEFT JOIN LATERAL (
  SELECT * 
  FROM gps_tracking_extended 
  WHERE movil = m.movil 
  AND escenario_id = m.escenario_id
  ORDER BY fecha_hora DESC 
  LIMIT 1
) g ON true
WHERE e.escenario_id = 1
ORDER BY e.nombre, m.movil;

-- =====================================================
-- ¡LISTO! Ahora recarga tu aplicación
-- =====================================================
-- Los móviles deberían aparecer en el mapa de Montevideo
