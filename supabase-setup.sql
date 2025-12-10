-- =====================================================
-- CONFIGURACIÓN COMPLETA DE SUPABASE PARA TRACKMOVIL
-- =====================================================
-- Ejecutar estos comandos en el SQL Editor de Supabase
-- Proyecto: lgniuhelyyizoursmsmi
-- =====================================================

-- 1️⃣ HABILITAR REALTIME EN LAS TABLAS
-- =====================================================

-- Agregar tablas a la publicación de Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE gps_tracking_extended;
ALTER PUBLICATION supabase_realtime ADD TABLE moviles;
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE empresas_fleteras;

-- Verificar que se agregaron correctamente
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 2️⃣ CONFIGURAR ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE gps_tracking_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE moviles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_fleteras ENABLE ROW LEVEL SECURITY;

-- IMPORTANTE: Estas políticas permiten acceso público de LECTURA
-- Ajusta según tus necesidades de seguridad

-- Política de lectura para GPS tracking
CREATE POLICY "Allow public read access to gps_tracking"
ON gps_tracking_extended FOR SELECT
USING (true);

-- Política de lectura para móviles
CREATE POLICY "Allow public read access to moviles"
ON moviles FOR SELECT
USING (true);

-- Política de lectura para pedidos
CREATE POLICY "Allow public read access to pedidos"
ON pedidos FOR SELECT
USING (true);

-- Política de lectura para empresas
CREATE POLICY "Allow public read access to empresas_fleteras"
ON empresas_fleteras FOR SELECT
USING (true);

-- Verificar políticas creadas
SELECT tablename, policyname, permissive, cmd 
FROM pg_policies 
WHERE tablename IN ('gps_tracking_extended', 'moviles', 'pedidos', 'empresas_fleteras')
ORDER BY tablename, policyname;

-- 3️⃣ ÍNDICES PARA OPTIMIZAR REALTIME
-- =====================================================

-- Índices ya existen en tu esquema, pero verificar:
SELECT tablename, indexname 
FROM pg_indexes 
WHERE tablename IN ('gps_tracking_extended', 'moviles', 'pedidos')
ORDER BY tablename;

-- 4️⃣ FUNCIÓN PARA UPDATE TIMESTAMP AUTOMÁTICO
-- =====================================================

-- Crear función si no existe
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verificar que los triggers existan (ya los tienes definidos)
SELECT tgname, tgrelid::regclass, tgenabled 
FROM pg_trigger 
WHERE tgname LIKE 'trigger_%_updated_at';

-- 5️⃣ DATOS DE PRUEBA (OPCIONAL)
-- =====================================================

-- Insertar empresa de prueba si no existe
INSERT INTO empresas_fleteras (
  escenario_id, nombre, razon_social, estado
) VALUES (
  1, 'Empresa Test Realtime', 'Test S.A.', 1
) ON CONFLICT DO NOTHING;

-- Insertar móvil de prueba
INSERT INTO moviles (
  movil, escenario_id, empresa_fletera_id, matricula, mostrar_en_mapa, estado
) VALUES (
  9999, 1, 1, 'TEST-RT-001', true, 1
) ON CONFLICT (movil, escenario_id, empresa_fletera_id) 
DO UPDATE SET 
  matricula = EXCLUDED.matricula,
  mostrar_en_mapa = EXCLUDED.mostrar_en_mapa,
  updated_at = NOW();

-- 6️⃣ VISTA PARA ÚLTIMAS POSICIONES (OPTIMIZACIÓN)
-- =====================================================

-- Crear vista materializada para últimas posiciones (opcional)
-- Esto mejora el rendimiento en la carga inicial
CREATE MATERIALIZED VIEW IF NOT EXISTS latest_gps_positions AS
SELECT DISTINCT ON (movil) 
  id, movil, escenario_id, latitud, longitud, fecha_hora,
  velocidad, bearing, accuracy, battery_level, distancia_recorrida
FROM gps_tracking_extended
ORDER BY movil, fecha_hora DESC;

-- Índice en la vista materializada
CREATE UNIQUE INDEX IF NOT EXISTS idx_latest_gps_movil 
ON latest_gps_positions(movil);

-- Función para refrescar la vista (llamar periódicamente)
CREATE OR REPLACE FUNCTION refresh_latest_positions()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY latest_gps_positions;
END;
$$ LANGUAGE plpgsql;

-- 7️⃣ CONFIGURAR POSTGIS (SI NO ESTÁ INSTALADO)
-- =====================================================

-- Habilitar extensión PostGIS si planeas usar funciones geoespaciales
CREATE EXTENSION IF NOT EXISTS postgis;

-- Agregar columna de geometría (opcional, para búsquedas espaciales avanzadas)
-- Esto es útil para búsquedas como "móviles dentro de un radio"
ALTER TABLE gps_tracking_extended 
ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

-- Índice espacial
CREATE INDEX IF NOT EXISTS idx_gps_tracking_geom 
ON gps_tracking_extended USING GIST(geom);

-- Trigger para actualizar geometría automáticamente
CREATE OR REPLACE FUNCTION update_gps_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitud, NEW.latitud), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger
DROP TRIGGER IF EXISTS trigger_update_gps_geom ON gps_tracking_extended;
CREATE TRIGGER trigger_update_gps_geom
BEFORE INSERT OR UPDATE ON gps_tracking_extended
FOR EACH ROW
EXECUTE FUNCTION update_gps_geom();

-- 8️⃣ FUNCIONES DE BÚSQUEDA GEOESPACIAL
-- =====================================================

-- Función: Encontrar móviles cerca de un punto
CREATE OR REPLACE FUNCTION find_moviles_near_point(
  p_lat NUMERIC,
  p_lon NUMERIC,
  p_radius_meters INTEGER DEFAULT 1000,
  p_escenario_id INTEGER DEFAULT 1
)
RETURNS TABLE (
  movil VARCHAR,
  latitud NUMERIC,
  longitud NUMERIC,
  distance_meters NUMERIC,
  fecha_hora TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.movil,
    g.latitud,
    g.longitud,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(g.longitud, g.latitud), 4326)::geography
    ) AS distance_meters,
    g.fecha_hora
  FROM latest_gps_positions g
  WHERE g.escenario_id = p_escenario_id
  AND ST_DWithin(
    ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
    ST_SetSRID(ST_MakePoint(g.longitud, g.latitud), 4326)::geography,
    p_radius_meters
  )
  ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql;

-- Ejemplo de uso:
-- SELECT * FROM find_moviles_near_point(-34.9011, -56.1645, 5000, 1);

-- 9️⃣ VERIFICACIÓN FINAL
-- =====================================================

-- Verificar que todo está configurado correctamente
DO $$
BEGIN
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'VERIFICACIÓN DE CONFIGURACIÓN SUPABASE';
  RAISE NOTICE '==========================================';
  
  -- Verificar Realtime
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'gps_tracking_extended'
  ) THEN
    RAISE NOTICE '✅ Realtime habilitado en gps_tracking_extended';
  ELSE
    RAISE NOTICE '❌ Realtime NO habilitado en gps_tracking_extended';
  END IF;
  
  -- Verificar RLS
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'gps_tracking_extended' 
    AND rowsecurity = true
  ) THEN
    RAISE NOTICE '✅ RLS habilitado en gps_tracking_extended';
  ELSE
    RAISE NOTICE '❌ RLS NO habilitado en gps_tracking_extended';
  END IF;
  
  -- Verificar PostGIS
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE NOTICE '✅ PostGIS instalado';
  ELSE
    RAISE NOTICE '⚠️  PostGIS no instalado (opcional)';
  END IF;
  
  RAISE NOTICE '==========================================';
END $$;

-- 🔟 LIMPIEZA Y MANTENIMIENTO
-- =====================================================

-- Función para limpiar datos antiguos de GPS (ejecutar periódicamente)
CREATE OR REPLACE FUNCTION cleanup_old_gps_data(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM gps_tracking_extended
  WHERE fecha_hora < NOW() - (days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Ejemplo: DELETE FROM gps_tracking_extended WHERE fecha_hora < NOW() - INTERVAL '30 days';
-- SELECT cleanup_old_gps_data(30);

-- =====================================================
-- FIN DE LA CONFIGURACIÓN
-- =====================================================

-- Para probar Realtime, ejecuta:
-- INSERT INTO gps_tracking_extended (movil, escenario_id, latitud, longitud, fecha_hora)
-- VALUES ('9999', 1, -34.9011, -56.1645, NOW());

-- Deberías ver la actualización en tu aplicación en tiempo real!
