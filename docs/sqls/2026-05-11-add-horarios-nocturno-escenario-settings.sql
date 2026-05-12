ALTER TABLE escenario_settings
  ADD COLUMN IF NOT EXISTS hora_ini_nocturno time NULL,
  ADD COLUMN IF NOT EXISTS hora_fin_nocturno time NULL;

COMMENT ON COLUMN escenario_settings.hora_ini_nocturno IS
  'Hora en que arranca el periodo nocturno. NULL = usar default hardcodeado (20:30).';

COMMENT ON COLUMN escenario_settings.hora_fin_nocturno IS
  'Hora en que arranca el periodo diurno (fin del nocturno). NULL = usar default hardcodeado (06:00).';
