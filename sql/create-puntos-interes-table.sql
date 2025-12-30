-- =====================================================
-- TABLA: puntos_interes
-- Descripción: Almacena puntos de interés personalizados en el mapa
-- Sistema: TrackMovil (sin autenticación de Supabase)
-- Fecha: 2025-12-30
-- =====================================================

-- Eliminar tabla si existe (para desarrollo/testing)
DROP TABLE IF EXISTS puntos_interes CASCADE;

-- Crear tabla principal
CREATE TABLE puntos_interes (
    -- Identificador único
    id BIGSERIAL PRIMARY KEY,
    
    -- Información del punto
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    icono VARCHAR(10) NOT NULL DEFAULT '📍',
    
    -- Coordenadas geográficas
    latitud DECIMAL(10, 8) NOT NULL,
    longitud DECIMAL(11, 8) NOT NULL,
    
    -- Tipo y visibilidad
    tipo VARCHAR(20) DEFAULT 'privado' CHECK (tipo IN ('publico', 'privado')),
    visible BOOLEAN DEFAULT true,
    
    -- Usuario propietario (email del sistema interno, NO Supabase Auth)
    usuario_email VARCHAR(255) NOT NULL,
    
    -- Timestamps automáticos
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT puntos_interes_nombre_check CHECK (LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT puntos_interes_coords_check CHECK (
        latitud BETWEEN -90 AND 90 AND 
        longitud BETWEEN -180 AND 180
    ),
    CONSTRAINT puntos_interes_unique_usuario_nombre UNIQUE (usuario_email, nombre)
);

-- =====================================================
-- ÍNDICES
-- =====================================================

-- Índice para búsquedas por usuario
CREATE INDEX idx_puntos_interes_usuario_email 
    ON puntos_interes(usuario_email);

-- Índice para filtrar por tipo
CREATE INDEX idx_puntos_interes_tipo 
    ON puntos_interes(tipo);

-- Índice para filtrar por visible
CREATE INDEX idx_puntos_interes_visible 
    ON puntos_interes(visible);

-- Índice compuesto para queries frecuentes (usuario + visible)
CREATE INDEX idx_puntos_interes_usuario_visible 
    ON puntos_interes(usuario_email, visible);

-- Índice espacial para búsquedas geográficas (opcional)
CREATE INDEX idx_puntos_interes_coords 
    ON puntos_interes(latitud, longitud);

-- Índice para ordenar por fecha de creación
CREATE INDEX idx_puntos_interes_created_at 
    ON puntos_interes(created_at DESC);

-- =====================================================
-- TRIGGER PARA ACTUALIZAR updated_at AUTOMÁTICAMENTE
-- =====================================================

-- Función para actualizar timestamp
CREATE OR REPLACE FUNCTION update_puntos_interes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger que ejecuta la función antes de cada UPDATE
CREATE TRIGGER trigger_update_puntos_interes_updated_at
    BEFORE UPDATE ON puntos_interes
    FOR EACH ROW
    EXECUTE FUNCTION update_puntos_interes_updated_at();

-- =====================================================
-- FUNCIONES AUXILIARES
-- =====================================================

-- Función para obtener todos los puntos de un usuario (privados + públicos)
CREATE OR REPLACE FUNCTION get_puntos_usuario(p_usuario_email VARCHAR)
RETURNS TABLE (
    id BIGINT,
    nombre VARCHAR,
    descripcion TEXT,
    icono VARCHAR,
    latitud DECIMAL,
    longitud DECIMAL,
    tipo VARCHAR,
    visible BOOLEAN,
    usuario_email VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pi.id,
        pi.nombre,
        pi.descripcion,
        pi.icono,
        pi.latitud,
        pi.longitud,
        pi.tipo,
        pi.visible,
        pi.usuario_email,
        pi.created_at,
        pi.updated_at
    FROM puntos_interes pi
    WHERE pi.visible = true
      AND (pi.usuario_email = p_usuario_email OR pi.tipo = 'publico')
    ORDER BY pi.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Función para obtener solo puntos públicos
CREATE OR REPLACE FUNCTION get_puntos_publicos()
RETURNS TABLE (
    id BIGINT,
    nombre VARCHAR,
    descripcion TEXT,
    icono VARCHAR,
    latitud DECIMAL,
    longitud DECIMAL,
    tipo VARCHAR,
    visible BOOLEAN,
    usuario_email VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pi.id,
        pi.nombre,
        pi.descripcion,
        pi.icono,
        pi.latitud,
        pi.longitud,
        pi.tipo,
        pi.visible,
        pi.usuario_email,
        pi.created_at,
        pi.updated_at
    FROM puntos_interes pi
    WHERE pi.visible = true
      AND pi.tipo = 'publico'
    ORDER BY pi.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Función para contar puntos por usuario
CREATE OR REPLACE FUNCTION count_puntos_usuario(p_usuario_email VARCHAR)
RETURNS TABLE (
    total BIGINT,
    publicos BIGINT,
    privados BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total,
        COUNT(*) FILTER (WHERE tipo = 'publico')::BIGINT as publicos,
        COUNT(*) FILTER (WHERE tipo = 'privado')::BIGINT as privados
    FROM puntos_interes
    WHERE usuario_email = p_usuario_email
      AND visible = true;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMENTARIOS EN COLUMNAS (Documentación)
-- =====================================================

COMMENT ON TABLE puntos_interes IS 'Puntos de interés personalizados en el mapa por usuario';
COMMENT ON COLUMN puntos_interes.id IS 'Identificador único autoincrementable';
COMMENT ON COLUMN puntos_interes.nombre IS 'Nombre descriptivo del punto (único por usuario)';
COMMENT ON COLUMN puntos_interes.descripcion IS 'Descripción opcional del punto';
COMMENT ON COLUMN puntos_interes.icono IS 'Emoji o ícono para mostrar en el mapa';
COMMENT ON COLUMN puntos_interes.latitud IS 'Latitud en grados decimales (-90 a 90)';
COMMENT ON COLUMN puntos_interes.longitud IS 'Longitud en grados decimales (-180 a 180)';
COMMENT ON COLUMN puntos_interes.tipo IS 'Tipo de punto: publico (visible para todos) o privado (solo para el usuario)';
COMMENT ON COLUMN puntos_interes.visible IS 'Indica si el punto está activo/visible';
COMMENT ON COLUMN puntos_interes.usuario_email IS 'Email del usuario propietario del punto (del sistema interno)';
COMMENT ON COLUMN puntos_interes.created_at IS 'Fecha y hora de creación';
COMMENT ON COLUMN puntos_interes.updated_at IS 'Fecha y hora de última actualización (auto-actualizado)';

-- =====================================================
-- DATOS DE EJEMPLO (OPCIONAL - comentar en producción)
-- =====================================================

-- Punto público de ejemplo
INSERT INTO puntos_interes (nombre, descripcion, icono, latitud, longitud, tipo, usuario_email)
VALUES 
    ('Oficina Central', 'Sede principal de la empresa', '🏢', -34.603722, -58.381592, 'publico', 'admin@trackmovil.com'),
    ('Centro de Distribución Norte', 'Depósito y logística', '📦', -34.563722, -58.451592, 'publico', 'admin@trackmovil.com'),
    ('Estación de Servicio', 'Punto de carga de combustible', '⛽', -34.623722, -58.401592, 'publico', 'admin@trackmovil.com');

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================

-- Verificar que la tabla se creó correctamente
SELECT 
    'Tabla creada' as status,
    COUNT(*) as registros_ejemplo
FROM puntos_interes;

-- Verificar índices
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'puntos_interes'
ORDER BY indexname;

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
