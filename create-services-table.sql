-- ============================================================
-- TABLA: services
-- Almacena los servicios importados desde el sistema externo
-- Estructura similar a pedidos pero con Tipo = 'Services'
-- ============================================================

CREATE TABLE IF NOT EXISTS services (
  -- Identificadores
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

  -- Timestamps de auditoría
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES para queries frecuentes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_services_escenario ON services(escenario);
CREATE INDEX IF NOT EXISTS idx_services_estado_nro ON services(estado_nro);
CREATE INDEX IF NOT EXISTS idx_services_movil ON services(movil);
CREATE INDEX IF NOT EXISTS idx_services_cliente_nro ON services(cliente_nro);
CREATE INDEX IF NOT EXISTS idx_services_fch_para ON services(fch_para);
CREATE INDEX IF NOT EXISTS idx_services_escenario_estado ON services(escenario, estado_nro);

-- ============================================================
-- Trigger para actualizar updated_at automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_services_updated_at ON services;
CREATE TRIGGER trigger_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION update_services_updated_at();

-- ============================================================
-- Habilitar Realtime para la tabla services
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE services;

-- ============================================================
-- RLS (Row Level Security) - Ajustar según necesidad
-- ============================================================
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Política para permitir lectura desde la app
CREATE POLICY "Allow read access to services" ON services
  FOR SELECT USING (true);

-- Política para permitir insert/update desde service role (API)
CREATE POLICY "Allow service role full access to services" ON services
  FOR ALL USING (true) WITH CHECK (true);
