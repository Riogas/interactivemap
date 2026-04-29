BEGIN;

ALTER TABLE moviles
  ADD COLUMN IF NOT EXISTS pto_vta_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS pto_vta_lng NUMERIC;

COMMENT ON COLUMN moviles.pto_vta_lat IS 'Lat (grados decimales) del punto de venta del móvil — proviene de AS400 ptoVtaX. Usado para autocreación de posición inicial del día si no hay GPS aún.';
COMMENT ON COLUMN moviles.pto_vta_lng IS 'Lng (grados decimales) del punto de venta del móvil — proviene de AS400 ptoVtaY.';

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS atraso_cump_mins NUMERIC,
  ADD COLUMN IF NOT EXISTS demora_movil_desde_asignacion_mins NUMERIC;

COMMENT ON COLUMN pedidos.atraso_cump_mins IS 'Minutos de atraso en cumplimiento (proviene de AS400 AtrasoCumpMins). Negativo permitido (anticipación).';
COMMENT ON COLUMN pedidos.demora_movil_desde_asignacion_mins IS 'Minutos transcurridos desde la asignación al móvil (AS400 DemoraMovilDesdeAsignacionMins).';

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS atraso_cump_mins NUMERIC,
  ADD COLUMN IF NOT EXISTS demora_movil_desde_asignacion_mins NUMERIC;

COMMENT ON COLUMN services.atraso_cump_mins IS 'Minutos de atraso en cumplimiento (AS400 AtrasoCumpMins).';
COMMENT ON COLUMN services.demora_movil_desde_asignacion_mins IS 'Minutos transcurridos desde la asignación al móvil (AS400 DemoraMovilDesdeAsignacionMins).';

ALTER TABLE puntos_interes
  ADD COLUMN IF NOT EXISTS escenario_id INTEGER,
  ADD COLUMN IF NOT EXISTS empresa_fletera_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'puntos_interes_empresa_fletera_fk'
  ) THEN
    ALTER TABLE puntos_interes
      ADD CONSTRAINT puntos_interes_empresa_fletera_fk
      FOREIGN KEY (empresa_fletera_id)
      REFERENCES empresas_fleteras(empresa_fletera_id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN puntos_interes.escenario_id IS 'Escenario al que pertenece el POI (NULL = todos los escenarios).';
COMMENT ON COLUMN puntos_interes.empresa_fletera_id IS 'Empresa fletera dueña del POI privado. NULL para públicos/osm o privados sin asignar (no visibles a distribuidor hasta reasignación).';

DO $$
DECLARE
  v_def TEXT;
  v_name TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid), c.conname
    INTO v_def, v_name
    FROM pg_constraint c
   WHERE c.conrelid = 'puntos_interes'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%tipo%'
   LIMIT 1;

  IF v_def IS NOT NULL AND v_def NOT ILIKE '%osm%' THEN
    EXECUTE format('ALTER TABLE puntos_interes DROP CONSTRAINT %I', v_name);
    ALTER TABLE puntos_interes
      ADD CONSTRAINT puntos_interes_tipo_check
      CHECK (tipo IN ('publico','privado','osm'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_puntos_interes_tipo_empresa
  ON puntos_interes(tipo, empresa_fletera_id);

CREATE INDEX IF NOT EXISTS idx_puntos_interes_escenario
  ON puntos_interes(escenario_id);

CREATE INDEX IF NOT EXISTS idx_gps_latest_positions_fecha_hora
  ON gps_latest_positions(fecha_hora DESC);

COMMIT;

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE (table_name='moviles' AND column_name LIKE 'pto_vta%')
    OR (table_name='pedidos' AND column_name IN ('atraso_cump_mins','demora_movil_desde_asignacion_mins'))
    OR (table_name='services' AND column_name IN ('atraso_cump_mins','demora_movil_desde_asignacion_mins'))
    OR (table_name='puntos_interes' AND column_name IN ('escenario_id','empresa_fletera_id'))
 ORDER BY table_name, column_name;
