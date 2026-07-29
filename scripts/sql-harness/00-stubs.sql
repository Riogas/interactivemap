-- Réplica mínima del estado de producción para validar migraciones.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

-- Default privileges al estilo Supabase: en un proyecto de Supabase, las
-- tablas nuevas del schema public nacen accesibles para `anon` y
-- `authenticated` (las dos claves que viajan al browser). Un Postgres vanilla
-- NO hace eso, y esa diferencia volvia intestable cualquier REVOKE: un assert
-- de "anon no puede escribir esta tabla" pasaba solo porque anon nunca tuvo
-- el privilegio, no porque la migracion lo hubiera revocado -- otro test que
-- no puede fallar. Con esto, el REVOKE de una migracion es lo unico que hace
-- pasar el assert, igual que en produccion.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;

CREATE TABLE app_config (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
);

CREATE TABLE escenario_settings (
  escenario_id INTEGER PRIMARY KEY,
  peso_transito_alpha NUMERIC(3,2) NOT NULL DEFAULT 0.3,
  nombre TEXT,
  pedidos_sa_minutos_antes INTEGER
);
INSERT INTO escenario_settings (escenario_id, peso_transito_alpha, nombre, pedidos_sa_minutos_antes)
VALUES (1000, 0.3, 'Escenario 1000', 60);

CREATE TABLE zonas (
  zona_id INTEGER, escenario_id INTEGER, nombre TEXT, activa BOOLEAN,
  PRIMARY KEY (zona_id, escenario_id)
);

CREATE TABLE demoras (
  demora_id BIGSERIAL PRIMARY KEY,
  escenario_id INTEGER, zona_id INTEGER, zona_tipo TEXT,
  descripcion TEXT, minutos INTEGER, activa BOOLEAN, zona_nombre TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT demoras_natural_key UNIQUE (escenario_id, zona_id, zona_tipo, descripcion)
);

CREATE TABLE moviles_zonas (
  id BIGSERIAL PRIMARY KEY,
  movil_id TEXT, zona_id INTEGER, escenario_id INTEGER,
  tipo_de_zona TEXT, tipo_de_servicio TEXT,
  prioridad_o_transito INTEGER, activa BOOLEAN DEFAULT true
);

CREATE TABLE moviles_dia (
  escenario_id INTEGER, movil_id INTEGER, fecha DATE,
  estado_nro INTEGER, activo BOOLEAN NOT NULL DEFAULT false,
  oculto_operativo BOOLEAN NOT NULL DEFAULT false,
  pedidos_pendientes INTEGER DEFAULT 0, services_pendientes INTEGER DEFAULT 0,
  tamano_lote INTEGER, empresa_fletera_id INTEGER,
  PRIMARY KEY (escenario_id, movil_id, fecha)
);

CREATE TABLE pedidos (
  id BIGINT, escenario INTEGER, servicio_nombre TEXT, movil INTEGER,
  zona_nro INTEGER, empresa_fletera_id INTEGER, fletero TEXT,
  fch_hora_asignado TIMESTAMPTZ, fch_hora_finalizacion TIMESTAMPTZ,
  fch_hora_para TIMESTAMPTZ, fch_hora_max_ent_comp TIMESTAMPTZ,
  demora_movil_desde_asignacion_mins NUMERIC,
  estado_nro INTEGER, sub_estado_nro INTEGER, orden_cancelacion TEXT,
  fch_para DATE,
  PRIMARY KEY (id, escenario)
);
CREATE TABLE services (LIKE pedidos INCLUDING ALL);

CREATE TABLE metricas_cumplimiento (
  origen TEXT NOT NULL, pedido_id BIGINT NOT NULL, escenario INTEGER NOT NULL,
  fecha DATE NOT NULL, tipo_servicio TEXT NOT NULL, servicio_nombre TEXT,
  movil INTEGER, zona_nro INTEGER, empresa_fletera_id INTEGER, chofer TEXT,
  fch_hora_asignado TIMESTAMPTZ, fch_hora_finalizacion TIMESTAMPTZ NOT NULL,
  fch_hora_para TIMESTAMPTZ, fch_hora_max_ent_comp TIMESTAMPTZ,
  demora_mins NUMERIC NOT NULL, demora_efectiva_mins NUMERIC NOT NULL,
  atraso_vs_para_mins NUMERIC, atraso_vs_compromiso_mins NUMERIC,
  reloj_inicio TEXT NOT NULL DEFAULT 'ASIGNADO', asignado_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (origen, pedido_id, escenario)
);
