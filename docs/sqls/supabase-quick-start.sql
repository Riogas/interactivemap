-- =====================================================
-- QUICK START: TRACKMOVIL - EJECUTAR TODO ESTO
-- =====================================================
-- Copia y pega TODO este archivo en el SQL Editor de Supabase
-- https://app.supabase.com/project/lgniuhelyyizoursmsmi/sql
-- =====================================================

-- 1️⃣ HABILITAR REALTIME
-- =====================================================
-- Nota: Ignorar errores si las tablas ya están en la publicación
DO $$
BEGIN
  -- Intentar agregar tablas a Realtime (ignorar si ya existen)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE gps_tracking_extended;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Tabla ya está en la publicación
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE moviles;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE empresas_fleteras;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 2️⃣ CONFIGURAR RLS (Row Level Security)
-- =====================================================
ALTER TABLE gps_tracking_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE moviles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_fleteras ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso público para LECTURA
DROP POLICY IF EXISTS "Allow public read access to gps_tracking" ON gps_tracking_extended;
CREATE POLICY "Allow public read access to gps_tracking"
ON gps_tracking_extended FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read access to moviles" ON moviles;
CREATE POLICY "Allow public read access to moviles"
ON moviles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read access to pedidos" ON pedidos;
CREATE POLICY "Allow public read access to pedidos"
ON pedidos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read access to empresas_fleteras" ON empresas_fleteras;
CREATE POLICY "Allow public read access to empresas_fleteras"
ON empresas_fleteras FOR SELECT USING (true);

-- 3️⃣ INSERTAR DATOS DE PRUEBA
-- =====================================================

-- Limpiar datos existentes
DELETE FROM gps_tracking_extended WHERE escenario_id = 1000 AND movil IN ('101', '102', '201', '202');
DELETE FROM moviles WHERE escenario_id = 1000 AND movil IN (101, 102, 201, 202);
-- No eliminamos empresas porque ya existen

-- Móviles (insertar usando las empresas existentes con escenario_id = 1000)
INSERT INTO moviles (movil, escenario_id, empresa_fletera_id, matricula, mostrar_en_mapa, estado)
SELECT 101, 1000, empresa_fletera_id, 'ABC-1234', true, 1
FROM empresas_fleteras WHERE nombre LIKE '%MONDELLI%' AND escenario_id = 1000 LIMIT 1;

INSERT INTO moviles (movil, escenario_id, empresa_fletera_id, matricula, mostrar_en_mapa, estado)
SELECT 102, 1000, empresa_fletera_id, 'DEF-5678', true, 1
FROM empresas_fleteras WHERE nombre LIKE '%TORCOR%' AND escenario_id = 1000 LIMIT 1;

INSERT INTO moviles (movil, escenario_id, empresa_fletera_id, matricula, mostrar_en_mapa, estado)
SELECT 201, 1000, empresa_fletera_id, 'GHI-9012', true, 1
FROM empresas_fleteras WHERE nombre LIKE '%CARLOS OJEDA%' AND escenario_id = 1000 LIMIT 1;

INSERT INTO moviles (movil, escenario_id, empresa_fletera_id, matricula, mostrar_en_mapa, estado)
SELECT 202, 1000, empresa_fletera_id, 'JKL-3456', true, 1
FROM empresas_fleteras WHERE nombre LIKE '%RIOGAS%' AND escenario_id = 1000 LIMIT 1;

-- Posiciones GPS (Montevideo, Uruguay)
INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora, velocidad, bearing, accuracy, battery_level) VALUES 
  -- Móvil 101 - Plaza Independencia
  ('101', 1000, -34.9058, -56.2012, NOW() - INTERVAL '5 minutes', 25.5, 90, 10, 85),
  ('101', 1000, -34.9061, -56.2008, NOW() - INTERVAL '3 minutes', 30.0, 95, 8, 84),
  ('101', 1000, -34.9065, -56.2003, NOW(), 28.3, 92, 12, 83),
  
  -- Móvil 102 - Pocitos
  ('102', 1000, -34.9088, -56.1538, NOW() - INTERVAL '10 minutes', 40.0, 180, 15, 92),
  ('102', 1000, -34.9095, -56.1545, NOW() - INTERVAL '5 minutes', 35.5, 185, 10, 91),
  ('102', 1000, -34.9102, -56.1552, NOW(), 32.0, 183, 8, 90),
  
  -- Móvil 201 - Buceo
  ('201', 1000, -34.8965, -56.1420, NOW() - INTERVAL '8 minutes', 50.2, 270, 20, 78),
  ('201', 1000, -34.8968, -56.1445, NOW() - INTERVAL '4 minutes', 45.8, 268, 18, 77),
  ('201', 1000, -34.8971, -56.1470, NOW(), 48.5, 272, 15, 76),
  
  -- Móvil 202 - Carrasco
  ('202', 1000, -34.8735, -56.0512, NOW() - INTERVAL '15 minutes', 60.0, 45, 25, 88),
  ('202', 1000, -34.8710, -56.0485, NOW() - INTERVAL '8 minutes', 55.3, 48, 20, 87),
  ('202', 1000, -34.8685, -56.0458, NOW(), 52.7, 46, 18, 86);

-- 4️⃣ VERIFICACIÓN
-- =====================================================
SELECT '=== RESUMEN ===' as resultado;

SELECT 
  '✅ Empresas' as tipo,
  COUNT(*) as cantidad
FROM empresas_fleteras 
WHERE escenario_id = 1000

UNION ALL

SELECT 
  '✅ Móviles' as tipo,
  COUNT(*) as cantidad
FROM moviles 
WHERE escenario_id = 1000

UNION ALL

SELECT 
  '✅ Posiciones GPS' as tipo,
  COUNT(*) as cantidad
FROM gps_tracking_extended 
WHERE escenario_id = 1000;

-- Datos completos
SELECT 
  e.nombre as empresa,
  m.movil,
  m.matricula,
  COUNT(g.id) as posiciones_gps
FROM empresas_fleteras e
JOIN moviles m ON e.empresa_fletera_id = m.empresa_fletera_id
LEFT JOIN gps_tracking_extended g ON m.movil::text = g.movil AND m.escenario_id = g.escenario_id
WHERE e.escenario_id = 1000
GROUP BY e.nombre, m.movil, m.matricula
ORDER BY e.nombre, m.movil;

-- =====================================================
-- ✅ ¡LISTO! Ahora recarga tu app en http://localhost:3000
-- =====================================================
