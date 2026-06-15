-- Migracion: peso_transito_alpha en escenario_settings
-- Fecha: 2026-05-15
-- Feature: prorrateo del lote del movil entre zonas con peso alpha configurable
--
-- INSTRUCCIONES POST-DEPLOY:
--   Tras aplicar esta migration, correr el endpoint:
--   POST /api/admin/recalcular-cap-entrega-all
--   (gate root) para refresh inicial de todas las filas de zonas_cap_entrega.
--   La operacion puede tardar 10-30s segun cantidad de moviles.

ALTER TABLE escenario_settings
  ADD COLUMN IF NOT EXISTS peso_transito_alpha NUMERIC(3,2) NOT NULL DEFAULT 0.3
  CHECK (peso_transito_alpha >= 0 AND peso_transito_alpha <= 1);

COMMENT ON COLUMN escenario_settings.peso_transito_alpha IS
  'Peso de las zonas de transito en el prorrateo del lote del movil para zonas_cap_entrega. 1 = igual que prioridad, 0 = no aporta nada, 0.3 default = aporta ~30%. Configurable solo por root.';

-- Actualizar comentario de zonas_cap_entrega.lote_disponible para reflejar la nueva semantica
COMMENT ON COLUMN zonas_cap_entrega.lote_disponible IS
  'Porcion del lote libre del movil (tamano_lote - capacidad) prorrateada a esta zona. Calculo: lote_libre * peso_zona / W, redondeado hacia arriba (ceiling). peso_zona = 1 si prioridad, peso_transito_alpha si transito. NO es el lote libre TOTAL del movil — es la contribucion del movil a la capacidad de esta zona. Para el lote total, usar tamano_lote - capacidad de moviles.';
