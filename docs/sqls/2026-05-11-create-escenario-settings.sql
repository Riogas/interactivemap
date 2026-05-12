-- Migracion: tabla de configuracion por escenario
-- Fecha: 2026-05-11
-- Feature: ventana temporal para pedidos sin asignar (cteMinsAntes)

CREATE TABLE IF NOT EXISTS escenario_settings (
  escenario_id integer PRIMARY KEY,
  pedidos_sa_minutos_antes integer NULL
    CONSTRAINT chk_pedidos_sa_minutos_antes CHECK (pedidos_sa_minutos_antes IS NULL OR pedidos_sa_minutos_antes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE escenario_settings IS
  'Configuracion operacional por escenario. pedidos_sa_minutos_antes=null significa sin filtro temporal (comportamiento original).';

COMMENT ON COLUMN escenario_settings.pedidos_sa_minutos_antes IS
  'Minutos antes del FchHoraPara en que un pedido sin asignar empieza a ser visible. null o 0 = sin filtro.';
