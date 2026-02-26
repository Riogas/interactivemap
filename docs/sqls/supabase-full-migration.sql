-- =====================================================================
-- 🚀 TRACKMOVIL — MIGRACIÓN COMPLETA A SUPABASE SELF-HOSTED
-- =====================================================================
-- Ejecutar este script COMPLETO en el SQL Editor de tu nuevo Supabase.
-- Crea TODAS las tablas, índices, triggers, funciones, RLS y Realtime.
--
-- Orden de ejecución:
--   1. Extensiones
--   2. Funciones auxiliares
--   3. Tablas (en orden de dependencias)
--   4. Índices
--   5. Triggers
--   6. Row Level Security (RLS) + Políticas
--   7. Realtime
--   8. Vistas materializadas
--   9. Funciones geoespaciales
--  10. Verificación final
--
-- Fecha de generación: 2026-02-26
-- =====================================================================


-- =====================================================================
-- 1️⃣  EXTENSIONES
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;


-- =====================================================================
-- 2️⃣  FUNCIONES AUXILIARES (usadas por triggers)
-- =====================================================================

-- Función genérica para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =====================================================================
-- 3️⃣  TABLAS
-- =====================================================================

-- ----- 3.1  empresas_fleteras -----
CREATE TABLE IF NOT EXISTS empresas_fleteras (
    empresa_fletera_id    SERIAL PRIMARY KEY,
    escenario_id          INT NOT NULL,
    nombre                TEXT NOT NULL,
    razon_social          TEXT,
    rut                   TEXT,
    direccion             TEXT,
    telefono              TEXT,
    email                 TEXT,
    contacto_nombre       TEXT,
    contacto_telefono     TEXT,
    estado                INT DEFAULT 1,
    observaciones         TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_empresa_escenario UNIQUE (empresa_fletera_id, escenario_id)
);

-- ----- 3.2  moviles -----
CREATE TABLE IF NOT EXISTS moviles (
    id                                    TEXT PRIMARY KEY,
    nro                                   INT,
    descripcion                           TEXT NOT NULL,
    detalle_html                          TEXT,
    distancia_max_mts_cump_pedidos        INT,
    empresa_fletera_id                    INT NOT NULL,
    empresa_fletera_nom                   TEXT,
    estado_desc                           TEXT,
    estado_nro                            INT,
    fch_hora_mov                          TIMESTAMPTZ,
    fch_hora_upd_firestore                TIMESTAMPTZ,
    matricula                             TEXT,
    mostrar_en_mapa                       BOOLEAN DEFAULT true,
    obs                                   TEXT,
    pedidos_pendientes                    INT,
    permite_baja_momentanea               BOOLEAN,
    print_screen                          BOOLEAN,
    se_puede_activar_desde_la_app         BOOLEAN,
    se_puede_desactivar_desde_la_app      BOOLEAN,
    tamano_lote                           INT,
    visible_en_app                        BOOLEAN,
    debug_mode                            BOOLEAN,
    gps_n8n                               BOOLEAN,
    grabar_pantalla                       BOOLEAN,
    created_at                            TIMESTAMPTZ DEFAULT NOW(),
    updated_at                            TIMESTAMPTZ DEFAULT NOW()
);

-- ----- 3.3  pedidos -----
CREATE TABLE IF NOT EXISTS pedidos (
    id                      BIGINT NOT NULL,
    escenario               INT NOT NULL DEFAULT 1000,

    -- Datos del cliente
    cliente_ciudad          TEXT,
    cliente_direccion       TEXT,
    cliente_direccion_esq1  TEXT,
    cliente_direccion_obs   TEXT,
    cliente_nombre          TEXT,
    cliente_nro             BIGINT,
    cliente_obs             TEXT,
    cliente_tel             TEXT,

    -- Info del pedido
    demora_informada        INT DEFAULT 0,
    detalle_html            TEXT DEFAULT '',
    empresa_fletera_id      INT DEFAULT 0,
    empresa_fletera_nom     TEXT DEFAULT '',
    estado_nro              INT DEFAULT 1,
    fpago_obs1              TEXT DEFAULT '',

    -- Fechas
    fch_hora_max_ent_comp   TIMESTAMPTZ,
    fch_hora_mov            TIMESTAMPTZ,
    fch_hora_para           TIMESTAMPTZ,
    fch_hora_upd_firestore  TIMESTAMPTZ,
    fch_para                DATE,

    -- URLs y precios
    google_maps_url         TEXT DEFAULT '',
    imp_bruto               NUMERIC(12,2) DEFAULT 0,
    imp_flete               NUMERIC(12,2) DEFAULT 0,

    -- Asignación y estado
    movil                   INT DEFAULT 0,
    orden_cancelacion       TEXT DEFAULT 'N',
    otros_productos         TEXT DEFAULT '',
    pedido_obs              TEXT DEFAULT '',
    precio                  NUMERIC(12,2) DEFAULT 0,
    prioridad               INT DEFAULT 0,

    -- Producto
    producto_cant           NUMERIC(12,2) DEFAULT 0,
    producto_cod            TEXT DEFAULT '',
    producto_nom            TEXT DEFAULT '',
    servicio_nombre         TEXT DEFAULT '',

    -- Sub estado
    sub_estado_desc         TEXT DEFAULT '',
    sub_estado_nro          INT DEFAULT 0,

    -- Otros
    tipo                    TEXT DEFAULT 'Pedidos',
    visible_en_app          TEXT DEFAULT 'S',
    waze_url                TEXT DEFAULT '',
    zona_nro                INT DEFAULT 0,
    ubicacion               TEXT DEFAULT '',

    -- Coordenadas geográficas
    latitud                 DOUBLE PRECISION,
    longitud                DOUBLE PRECISION,

    -- Timestamps
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (id, escenario)
);

-- ----- 3.4  services -----
CREATE TABLE IF NOT EXISTS services (
    id                      BIGINT PRIMARY KEY,
    escenario               INT NOT NULL DEFAULT 1000,

    -- Datos del cliente
    cliente_ciudad          TEXT,
    cliente_direccion       TEXT,
    cliente_direccion_esq1  TEXT,
    cliente_direccion_obs   TEXT,
    cliente_nombre          TEXT,
    cliente_nro             BIGINT,
    cliente_obs             TEXT,
    cliente_tel             TEXT,

    -- Info del servicio
    defecto                 TEXT DEFAULT '',
    demora_informada        INT DEFAULT 0,
    detalle_html            TEXT DEFAULT '',
    empresa_fletera_id      INT DEFAULT 0,
    empresa_fletera_nom     TEXT DEFAULT '',
    estado_nro              INT DEFAULT 1,
    fpago_obs1              TEXT DEFAULT '',

    -- Fechas
    fch_hora_max_ent_comp   TIMESTAMPTZ,
    fch_hora_mov            TIMESTAMPTZ,
    fch_hora_para           TIMESTAMPTZ,
    fch_hora_upd_firestore  TIMESTAMPTZ,
    fch_para                DATE,

    -- URLs y precios
    google_maps_url         TEXT DEFAULT '',
    imp_bruto               NUMERIC(12,2) DEFAULT 0,
    imp_flete               NUMERIC(12,2) DEFAULT 0,

    -- Asignación y estado
    movil                   INT DEFAULT 0,
    orden_cancelacion       TEXT DEFAULT 'N',
    otros_productos         TEXT DEFAULT '',
    pedido_obs              TEXT DEFAULT '',
    precio                  NUMERIC(12,2) DEFAULT 0,
    prioridad               INT DEFAULT 0,

    -- Producto
    producto_cant           NUMERIC(12,2) DEFAULT 0,
    producto_cod            TEXT DEFAULT '',
    producto_nom            TEXT DEFAULT '',
    servicio_nombre         TEXT DEFAULT '',

    -- Sub estado
    sub_estado_desc         TEXT DEFAULT '',
    sub_estado_nro          INT DEFAULT 0,

    -- Otros
    tipo                    TEXT DEFAULT 'Services',
    visible_en_app          TEXT DEFAULT 'S',
    waze_url                TEXT DEFAULT '',
    zona_nro                INT DEFAULT 0,
    ubicacion               TEXT DEFAULT '',

    -- Coordenadas geográficas
    latitud                 DOUBLE PRECISION,
    longitud                DOUBLE PRECISION,

    -- Timestamps
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ----- 3.5  gps_tracking_history (historial completo) -----
-- Almacena TODOS los registros GPS. Es la tabla principal de escritura.
CREATE TABLE IF NOT EXISTS gps_tracking_history (
    id                              BIGSERIAL PRIMARY KEY,

    -- Identificación
    movil_id                        TEXT NOT NULL,
    pedido_id                       INT,
    device_id                       TEXT,
    usuario                         TEXT,
    escenario_id                    INT,

    -- Coordenadas
    latitud                         DOUBLE PRECISION NOT NULL,
    longitud                        DOUBLE PRECISION NOT NULL,
    utm_x                           DOUBLE PRECISION,
    utm_y                           DOUBLE PRECISION,

    -- Precisión y altitud
    accuracy                        DOUBLE PRECISION,
    altitude                        DOUBLE PRECISION,
    bearing                         DOUBLE PRECISION,
    provider                        TEXT,
    speed_accuracy                  DOUBLE PRECISION,

    -- Mock / satélites
    is_mock_location                BOOLEAN,
    location_age_ms                 BIGINT,
    satellites_used                 INT,
    satellites_total                INT,
    satellites_avg_snr              DOUBLE PRECISION,

    -- Movimiento
    velocidad                       DOUBLE PRECISION,
    distancia_recorrida             DOUBLE PRECISION,
    movement_type                   TEXT,

    -- Estado de la app
    app_state                       TEXT,
    app_version                     TEXT,

    -- Permisos
    permission_fine_location        BOOLEAN,
    permission_coarse_location      BOOLEAN,
    permission_background_location  BOOLEAN,
    notifications_enabled           BOOLEAN,
    gps_enabled                     BOOLEAN,

    -- Batería
    battery_level                   INT,
    battery_charging                BOOLEAN,
    battery_status                  TEXT,
    battery_saver_on                BOOLEAN,
    battery_optimization_ignored    BOOLEAN,
    doze_mode_active                BOOLEAN,

    -- Red
    network_type                    TEXT,
    network_connected               BOOLEAN,

    -- Dispositivo
    device_manufacturer             TEXT,
    device_model                    TEXT,
    device_brand                    TEXT,
    android_version                 INT,
    android_release                 TEXT,

    -- Memoria
    memory_available_mb             DOUBLE PRECISION,
    memory_total_mb                 DOUBLE PRECISION,
    memory_low                      BOOLEAN,

    -- Contadores
    execution_counter               INT,
    last_reset_reason               TEXT,

    -- Timestamps
    fecha_hora                      TIMESTAMPTZ NOT NULL,
    timestamp_local                 TIMESTAMPTZ,
    timestamp_utc                   TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ DEFAULT NOW(),

    -- PostGIS (columna geométrica, se llena automáticamente por trigger)
    geom                            geometry(Point, 4326)
);

-- ----- 3.5b  gps_latest_positions (última posición por móvil) -----
-- 1 fila por móvil. Se actualiza automáticamente via trigger en gps_tracking_history.
-- Ideal para Realtime: cada INSERT en history genera un UPDATE aquí → evento Realtime.
CREATE TABLE IF NOT EXISTS gps_latest_positions (
    movil_id                        TEXT PRIMARY KEY,
    history_id                      BIGINT,             -- referencia al último registro en history
    escenario_id                    INT,

    -- Coordenadas
    latitud                         DOUBLE PRECISION NOT NULL,
    longitud                        DOUBLE PRECISION NOT NULL,

    -- Datos clave de la última posición
    velocidad                       DOUBLE PRECISION,
    bearing                         DOUBLE PRECISION,
    accuracy                        DOUBLE PRECISION,
    altitude                        DOUBLE PRECISION,
    battery_level                   INT,
    distancia_recorrida             DOUBLE PRECISION,
    movement_type                   TEXT,

    -- Dispositivo
    device_id                       TEXT,
    app_version                     TEXT,
    network_type                    TEXT,
    network_connected               BOOLEAN,

    -- Timestamps
    fecha_hora                      TIMESTAMPTZ NOT NULL,
    created_at                      TIMESTAMPTZ DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ DEFAULT NOW(),

    -- PostGIS
    geom                            geometry(Point, 4326)
);

-- ----- 3.6  puntos_interes -----
CREATE TABLE IF NOT EXISTS puntos_interes (
    id                BIGSERIAL PRIMARY KEY,
    nombre            VARCHAR(100) NOT NULL,
    descripcion       TEXT,
    icono             VARCHAR(10) NOT NULL DEFAULT '📍',
    latitud           DECIMAL(10, 8) NOT NULL,
    longitud          DECIMAL(11, 8) NOT NULL,
    tipo              VARCHAR(20) DEFAULT 'privado' CHECK (tipo IN ('publico', 'privado')),
    visible           BOOLEAN DEFAULT true,
    usuario_email     VARCHAR(255) NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT puntos_interes_nombre_check CHECK (LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT puntos_interes_coords_check CHECK (
        latitud BETWEEN -90 AND 90 AND
        longitud BETWEEN -180 AND 180
    ),
    CONSTRAINT puntos_interes_unique_usuario_nombre UNIQUE (usuario_email, nombre)
);

-- ----- 3.7  zonas -----
CREATE TABLE IF NOT EXISTS zonas (
    zona_id           INT PRIMARY KEY,
    escenario_id      INT DEFAULT 1000,
    nombre            TEXT,
    descripcion       TEXT,
    color             TEXT,
    activa            BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----- 3.8  demoras -----
CREATE TABLE IF NOT EXISTS demoras (
    demora_id         INT PRIMARY KEY,
    escenario_id      INT DEFAULT 1000,
    descripcion       TEXT,
    minutos           INT DEFAULT 0,
    activa            BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ----- 3.9  puntoventa -----
CREATE TABLE IF NOT EXISTS puntoventa (
    punto_venta_id    INT PRIMARY KEY,
    escenario_id      INT DEFAULT 1000,
    nombre            TEXT,
    direccion         TEXT,
    telefono          TEXT,
    latitud           DOUBLE PRECISION,
    longitud          DOUBLE PRECISION,
    activo            BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);


-- =====================================================================
-- 4️⃣  ÍNDICES
-- =====================================================================

-- empresas_fleteras
CREATE INDEX IF NOT EXISTS idx_empresas_escenario ON empresas_fleteras(escenario_id);
CREATE INDEX IF NOT EXISTS idx_empresas_estado ON empresas_fleteras(estado);

-- moviles
CREATE INDEX IF NOT EXISTS idx_moviles_empresa ON moviles(empresa_fletera_id);
CREATE INDEX IF NOT EXISTS idx_moviles_mostrar ON moviles(mostrar_en_mapa);
CREATE INDEX IF NOT EXISTS idx_moviles_nro ON moviles(nro);

-- pedidos
CREATE INDEX IF NOT EXISTS idx_pedidos_escenario ON pedidos(escenario);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado_nro ON pedidos(estado_nro);
CREATE INDEX IF NOT EXISTS idx_pedidos_movil ON pedidos(movil);
CREATE INDEX IF NOT EXISTS idx_pedidos_fch_para ON pedidos(fch_para);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa ON pedidos(empresa_fletera_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_escenario_estado ON pedidos(escenario, estado_nro);
CREATE INDEX IF NOT EXISTS idx_pedidos_coords ON pedidos(latitud, longitud);

-- services
CREATE INDEX IF NOT EXISTS idx_services_escenario ON services(escenario);
CREATE INDEX IF NOT EXISTS idx_services_estado_nro ON services(estado_nro);
CREATE INDEX IF NOT EXISTS idx_services_movil ON services(movil);
CREATE INDEX IF NOT EXISTS idx_services_cliente_nro ON services(cliente_nro);
CREATE INDEX IF NOT EXISTS idx_services_fch_para ON services(fch_para);
CREATE INDEX IF NOT EXISTS idx_services_escenario_estado ON services(escenario, estado_nro);

-- gps_tracking_history
CREATE INDEX IF NOT EXISTS idx_gps_history_movil_id ON gps_tracking_history(movil_id);
CREATE INDEX IF NOT EXISTS idx_gps_history_escenario ON gps_tracking_history(escenario_id);
CREATE INDEX IF NOT EXISTS idx_gps_history_fecha_hora ON gps_tracking_history(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_gps_history_movil_fecha ON gps_tracking_history(movil_id, fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_gps_history_escenario_fecha ON gps_tracking_history(escenario_id, fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_gps_history_geom ON gps_tracking_history USING GIST(geom);

-- gps_latest_positions
CREATE INDEX IF NOT EXISTS idx_gps_latest_escenario ON gps_latest_positions(escenario_id);
CREATE INDEX IF NOT EXISTS idx_gps_latest_fecha ON gps_latest_positions(fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_gps_latest_geom ON gps_latest_positions USING GIST(geom);

-- puntos_interes
CREATE INDEX IF NOT EXISTS idx_puntos_usuario_email ON puntos_interes(usuario_email);
CREATE INDEX IF NOT EXISTS idx_puntos_tipo ON puntos_interes(tipo);
CREATE INDEX IF NOT EXISTS idx_puntos_visible ON puntos_interes(visible);
CREATE INDEX IF NOT EXISTS idx_puntos_usuario_visible ON puntos_interes(usuario_email, visible);
CREATE INDEX IF NOT EXISTS idx_puntos_coords ON puntos_interes(latitud, longitud);
CREATE INDEX IF NOT EXISTS idx_puntos_created_at ON puntos_interes(created_at DESC);

-- zonas
CREATE INDEX IF NOT EXISTS idx_zonas_escenario ON zonas(escenario_id);


-- =====================================================================
-- 5️⃣  TRIGGERS
-- =====================================================================

-- empresas_fleteras
DROP TRIGGER IF EXISTS trigger_empresas_updated_at ON empresas_fleteras;
CREATE TRIGGER trigger_empresas_updated_at
    BEFORE UPDATE ON empresas_fleteras
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- moviles
DROP TRIGGER IF EXISTS trigger_moviles_updated_at ON moviles;
CREATE TRIGGER trigger_moviles_updated_at
    BEFORE UPDATE ON moviles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- pedidos
DROP TRIGGER IF EXISTS trigger_pedidos_updated_at ON pedidos;
CREATE TRIGGER trigger_pedidos_updated_at
    BEFORE UPDATE ON pedidos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- services
DROP TRIGGER IF EXISTS trigger_services_updated_at ON services;
CREATE TRIGGER trigger_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- puntos_interes
DROP TRIGGER IF EXISTS trigger_puntos_interes_updated_at ON puntos_interes;
CREATE TRIGGER trigger_puntos_interes_updated_at
    BEFORE UPDATE ON puntos_interes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- zonas
DROP TRIGGER IF EXISTS trigger_zonas_updated_at ON zonas;
CREATE TRIGGER trigger_zonas_updated_at
    BEFORE UPDATE ON zonas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- demoras
DROP TRIGGER IF EXISTS trigger_demoras_updated_at ON demoras;
CREATE TRIGGER trigger_demoras_updated_at
    BEFORE UPDATE ON demoras
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- puntoventa
DROP TRIGGER IF EXISTS trigger_puntoventa_updated_at ON puntoventa;
CREATE TRIGGER trigger_puntoventa_updated_at
    BEFORE UPDATE ON puntoventa
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- gps_tracking_history → auto-llenar columna geom con PostGIS
CREATE OR REPLACE FUNCTION update_gps_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitud IS NOT NULL AND NEW.longitud IS NOT NULL THEN
        NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitud, NEW.latitud), 4326);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_gps_geom ON gps_tracking_history;
CREATE TRIGGER trigger_update_gps_geom
    BEFORE INSERT OR UPDATE ON gps_tracking_history
    FOR EACH ROW EXECUTE FUNCTION update_gps_geom();

-- gps_latest_positions → auto-llenar columna geom con PostGIS
DROP TRIGGER IF EXISTS trigger_update_latest_geom ON gps_latest_positions;
CREATE TRIGGER trigger_update_latest_geom
    BEFORE INSERT OR UPDATE ON gps_latest_positions
    FOR EACH ROW EXECUTE FUNCTION update_gps_geom();

-- 🔥 TRIGGER PRINCIPAL: Al insertar en gps_tracking_history, UPSERT en gps_latest_positions
-- Esto mantiene gps_latest_positions SIEMPRE actualizada sin código extra en la app.
CREATE OR REPLACE FUNCTION sync_gps_latest_position()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO gps_latest_positions (
        movil_id, history_id, escenario_id,
        latitud, longitud,
        velocidad, bearing, accuracy, altitude,
        battery_level, distancia_recorrida, movement_type,
        device_id, app_version, network_type, network_connected,
        fecha_hora, updated_at
    ) VALUES (
        NEW.movil_id, NEW.id, NEW.escenario_id,
        NEW.latitud, NEW.longitud,
        NEW.velocidad, NEW.bearing, NEW.accuracy, NEW.altitude,
        NEW.battery_level, NEW.distancia_recorrida, NEW.movement_type,
        NEW.device_id, NEW.app_version, NEW.network_type, NEW.network_connected,
        NEW.fecha_hora, NOW()
    )
    ON CONFLICT (movil_id) DO UPDATE SET
        history_id          = EXCLUDED.history_id,
        escenario_id        = EXCLUDED.escenario_id,
        latitud             = EXCLUDED.latitud,
        longitud            = EXCLUDED.longitud,
        velocidad           = EXCLUDED.velocidad,
        bearing             = EXCLUDED.bearing,
        accuracy            = EXCLUDED.accuracy,
        altitude            = EXCLUDED.altitude,
        battery_level       = EXCLUDED.battery_level,
        distancia_recorrida = EXCLUDED.distancia_recorrida,
        movement_type       = EXCLUDED.movement_type,
        device_id           = EXCLUDED.device_id,
        app_version         = EXCLUDED.app_version,
        network_type        = EXCLUDED.network_type,
        network_connected   = EXCLUDED.network_connected,
        fecha_hora          = EXCLUDED.fecha_hora,
        updated_at          = NOW()
    WHERE EXCLUDED.fecha_hora >= gps_latest_positions.fecha_hora;
    -- Solo actualiza si la nueva posición es más reciente (evita race conditions)

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_latest_position ON gps_tracking_history;
CREATE TRIGGER trigger_sync_latest_position
    AFTER INSERT ON gps_tracking_history
    FOR EACH ROW EXECUTE FUNCTION sync_gps_latest_position();


-- =====================================================================
-- 6️⃣  ROW LEVEL SECURITY (RLS) + POLÍTICAS
-- =====================================================================

-- Habilitar RLS en TODAS las tablas
ALTER TABLE empresas_fleteras   ENABLE ROW LEVEL SECURITY;
ALTER TABLE moviles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE services            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_tracking_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_latest_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE puntos_interes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE demoras             ENABLE ROW LEVEL SECURITY;
ALTER TABLE puntoventa          ENABLE ROW LEVEL SECURITY;

-- Políticas de LECTURA pública (anon key puede leer)
DROP POLICY IF EXISTS "public_read_empresas"       ON empresas_fleteras;
DROP POLICY IF EXISTS "public_read_moviles"        ON moviles;
DROP POLICY IF EXISTS "public_read_pedidos"        ON pedidos;
DROP POLICY IF EXISTS "public_read_services"       ON services;
DROP POLICY IF EXISTS "public_read_gps_history"    ON gps_tracking_history;
DROP POLICY IF EXISTS "public_read_gps_latest"     ON gps_latest_positions;
DROP POLICY IF EXISTS "public_read_puntos_interes" ON puntos_interes;
DROP POLICY IF EXISTS "public_read_zonas"          ON zonas;
DROP POLICY IF EXISTS "public_read_demoras"        ON demoras;
DROP POLICY IF EXISTS "public_read_puntoventa"     ON puntoventa;

CREATE POLICY "public_read_empresas"       ON empresas_fleteras       FOR SELECT USING (true);
CREATE POLICY "public_read_moviles"        ON moviles                 FOR SELECT USING (true);
CREATE POLICY "public_read_pedidos"        ON pedidos                 FOR SELECT USING (true);
CREATE POLICY "public_read_services"       ON services                FOR SELECT USING (true);
CREATE POLICY "public_read_gps_history"    ON gps_tracking_history    FOR SELECT USING (true);
CREATE POLICY "public_read_gps_latest"     ON gps_latest_positions   FOR SELECT USING (true);
CREATE POLICY "public_read_puntos_interes" ON puntos_interes          FOR SELECT USING (true);
CREATE POLICY "public_read_zonas"          ON zonas                   FOR SELECT USING (true);
CREATE POLICY "public_read_demoras"        ON demoras                 FOR SELECT USING (true);
CREATE POLICY "public_read_puntoventa"     ON puntoventa              FOR SELECT USING (true);

-- Políticas de ESCRITURA completa (service_role y anon para las que la app necesita)
DROP POLICY IF EXISTS "full_access_empresas"       ON empresas_fleteras;
DROP POLICY IF EXISTS "full_access_moviles"        ON moviles;
DROP POLICY IF EXISTS "full_access_pedidos"        ON pedidos;
DROP POLICY IF EXISTS "full_access_services"       ON services;
DROP POLICY IF EXISTS "full_access_gps_history"    ON gps_tracking_history;
DROP POLICY IF EXISTS "full_access_gps_latest"     ON gps_latest_positions;
DROP POLICY IF EXISTS "full_access_puntos_interes" ON puntos_interes;
DROP POLICY IF EXISTS "full_access_zonas"          ON zonas;
DROP POLICY IF EXISTS "full_access_demoras"        ON demoras;
DROP POLICY IF EXISTS "full_access_puntoventa"     ON puntoventa;

CREATE POLICY "full_access_empresas"       ON empresas_fleteras       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_moviles"        ON moviles                 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_pedidos"        ON pedidos                 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_services"       ON services                FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_gps_history"    ON gps_tracking_history    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_gps_latest"     ON gps_latest_positions   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_puntos_interes" ON puntos_interes          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_zonas"          ON zonas                   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_demoras"        ON demoras                 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_puntoventa"     ON puntoventa              FOR ALL USING (true) WITH CHECK (true);


-- =====================================================================
-- 7️⃣  REALTIME (publicación para eventos en vivo)
-- =====================================================================

DO $$
BEGIN
    -- gps_tracking_history (para auditoría, opcional)
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE gps_tracking_history;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    -- gps_latest_positions (PRINCIPAL para Realtime — 1 fila por móvil)
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE gps_latest_positions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    -- moviles
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE moviles;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    -- pedidos
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    -- services
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE services;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    -- empresas_fleteras
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE empresas_fleteras;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;


-- =====================================================================
-- 8️⃣  NOTA: Vista materializada ELIMINADA
-- =====================================================================
-- La vista materializada latest_gps_positions fue reemplazada por la
-- TABLA gps_latest_positions (sección 3.5b). Ventajas:
--   • Siempre actualizada (trigger automático, sin REFRESH)
--   • Compatible con Supabase Realtime (genera eventos INSERT/UPDATE)
--   • Sin costo de mantenimiento (no necesita pg_cron)
--   • Consultas instantáneas (PK = movil_id)


-- =====================================================================
-- 9️⃣  FUNCIONES AUXILIARES
-- =====================================================================

-- Buscar móviles cerca de un punto (requiere PostGIS)
CREATE OR REPLACE FUNCTION find_moviles_near_point(
    p_lat NUMERIC,
    p_lon NUMERIC,
    p_radius_meters INTEGER DEFAULT 1000,
    p_escenario_id INTEGER DEFAULT 1
)
RETURNS TABLE (
    movil_id TEXT,
    latitud NUMERIC,
    longitud NUMERIC,
    distance_meters NUMERIC,
    fecha_hora TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        g.movil_id,
        g.latitud::NUMERIC,
        g.longitud::NUMERIC,
        ST_Distance(
            ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint(g.longitud, g.latitud), 4326)::geography
        )::NUMERIC AS distance_meters,
        g.fecha_hora
    FROM gps_latest_positions g
    WHERE g.escenario_id = p_escenario_id
      AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(g.longitud, g.latitud), 4326)::geography,
          p_radius_meters
      )
    ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql;

-- Obtener puntos de interés de un usuario
CREATE OR REPLACE FUNCTION get_puntos_usuario(p_usuario_email VARCHAR)
RETURNS TABLE (
    id BIGINT, nombre VARCHAR, descripcion TEXT, icono VARCHAR,
    latitud DECIMAL, longitud DECIMAL, tipo VARCHAR, visible BOOLEAN,
    usuario_email VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT pi.id, pi.nombre, pi.descripcion, pi.icono,
           pi.latitud, pi.longitud, pi.tipo, pi.visible,
           pi.usuario_email, pi.created_at, pi.updated_at
    FROM puntos_interes pi
    WHERE pi.visible = true
      AND (pi.usuario_email = p_usuario_email OR pi.tipo = 'publico')
    ORDER BY pi.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Limpiar datos GPS antiguos (mantenimiento)
CREATE OR REPLACE FUNCTION cleanup_old_gps_data(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM gps_tracking_history
    WHERE fecha_hora < NOW() - (days_to_keep || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


-- =====================================================================
-- 🔟  VERIFICACIÓN FINAL
-- =====================================================================

DO $$
DECLARE
    tbl RECORD;
    rt_count INT;
    rls_count INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════';
    RAISE NOTICE '  VERIFICACIÓN DE CONFIGURACIÓN SUPABASE';
    RAISE NOTICE '══════════════════════════════════════════════';

    -- Verificar tablas
    FOR tbl IN
        SELECT unnest(ARRAY[
            'empresas_fleteras','moviles','pedidos','services',
            'gps_tracking_history','gps_latest_positions','puntos_interes','zonas','demoras','puntoventa'
        ]) AS name
    LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = tbl.name AND schemaname = 'public') THEN
            RAISE NOTICE '  ✅ Tabla: %', tbl.name;
        ELSE
            RAISE NOTICE '  ❌ Tabla FALTA: %', tbl.name;
        END IF;
    END LOOP;

    -- Verificar Realtime
    SELECT COUNT(*) INTO rt_count
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename IN ('gps_tracking_history','gps_latest_positions','moviles','pedidos','services','empresas_fleteras');
    RAISE NOTICE '';
    RAISE NOTICE '  📡 Tablas en Realtime: %/6', rt_count;

    -- Verificar RLS
    SELECT COUNT(*) INTO rls_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('empresas_fleteras','moviles','pedidos','services',
                        'gps_tracking_history','gps_latest_positions','puntos_interes','zonas','demoras','puntoventa')
      AND rowsecurity = true;
    RAISE NOTICE '  🔒 Tablas con RLS: %/10', rls_count;

    -- Verificar PostGIS
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        RAISE NOTICE '  🌍 PostGIS: instalado';
    ELSE
        RAISE NOTICE '  ⚠️  PostGIS: NO instalado';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════';
    RAISE NOTICE '  ✅ MIGRACIÓN COMPLETADA';
    RAISE NOTICE '══════════════════════════════════════════════';
END $$;


-- =====================================================================
-- 📋  RESUMEN DE VARIABLES DE ENTORNO (.env.local)
-- =====================================================================
--
-- Actualizar en tu archivo .env.local:
--
--   NEXT_PUBLIC_SUPABASE_URL=https://tu-supabase-selfhosted.ejemplo.com
--   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...tu-anon-key...
--   SUPABASE_SERVICE_ROLE_KEY=eyJ...tu-service-role-key... (opcional, para bypass RLS)
--
-- =====================================================================
-- 📡  CANALES REALTIME QUE USA LA APP
-- =====================================================================
--
-- La app se suscribe a estos canales (automáticamente):
--
--   1. gps-latest-{escenarioId}        → INSERT, UPDATE en gps_latest_positions
--   2. moviles-changes               → INSERT, UPDATE, DELETE en moviles
--   3. pedidos-changes               → INSERT, UPDATE, DELETE en pedidos
--   4. pedidos-realtime-{escenarioId} → INSERT, UPDATE, DELETE en pedidos
--   5. empresas-changes              → INSERT, UPDATE, DELETE en empresas_fleteras
--   6. services-realtime-{escenarioId} → INSERT, UPDATE, DELETE en services
--
-- Asegurate de que el servicio Realtime esté habilitado en tu
-- Supabase self-hosted (viene activado por defecto).
--
-- =====================================================================
