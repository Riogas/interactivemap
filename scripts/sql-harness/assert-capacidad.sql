\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia;

-- Movil 10: activo, 1 zona prioridad (100) + 3 de transito (101,102,103), URGENTE.
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('10', 100, 1000, 'URGENTE', 1),
  ('10', 101, 1000, 'URGENTE', 2),
  ('10', 102, 1000, 'URGENTE', 2),
  ('10', 103, 1000, 'URGENTE', 2),
-- Movil 20: INACTIVO, tambien en zona 100. No debe aportar nada.
  ('20', 100, 1000, 'URGENTE', 1);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 10, DATE '2026-07-29', true),
  (1000, 20, DATE '2026-07-29', false);

-- alpha=0.3 -> W = 1 + 0.3*3 = 1.9 ; zona 100 recibe 1/1.9 = 0.5263
DO $$
DECLARE v numeric;
BEGIN
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF round(v,4) <> 0.5263 THEN RAISE EXCEPTION 'zona prioridad: obtuvo % esperaba 0.5263', round(v,4); END IF;
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=101 AND tipo_servicio='URGENTE';
  IF round(v,4) <> 0.1579 THEN RAISE EXCEPTION 'zona transito: obtuvo % esperaba 0.1579', round(v,4); END IF;
  RAISE NOTICE 'ok prorrateo';
END $$;

-- El total de las 4 zonas suma ~1 movil (tolerancia por residuo de redondeo).
-- Suma de fracciones redondeadas independientemente no da exacto. Residuo típico ~1e-4.
DO $$
DECLARE v numeric;
BEGIN
  SELECT sum(capacidad_efectiva) INTO v FROM demoras_capacidad(1000, DATE '2026-07-29');
  IF abs(v - 1.0) >= 0.001 THEN RAISE EXCEPTION 'suma total: obtuvo % (fuera de tolerancia)', v; END IF;
  RAISE NOTICE 'ok suma ~ 1 movil';
END $$;

-- El movil inactivo no cuenta.
DO $$
DECLARE v int;
BEGIN
  SELECT moviles_activos INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF v <> 1 THEN RAISE EXCEPTION 'moviles activos: obtuvo % esperaba 1', v; END IF;
  RAISE NOTICE 'ok ignora inactivos';
END $$;

-- alpha=0 anula el transito.
UPDATE escenario_settings SET peso_transito_alpha = 0 WHERE escenario_id = 1000;
DO $$
DECLARE v numeric;
BEGIN
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=101 AND tipo_servicio='URGENTE';
  IF round(v,6) <> 0 THEN RAISE EXCEPTION 'alpha=0: obtuvo % esperaba 0', v; END IF;
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF round(v,6) <> 1 THEN RAISE EXCEPTION 'alpha=0 prioridad: obtuvo % esperaba 1', v; END IF;
  RAISE NOTICE 'ok alpha=0';
END $$;

-- Edge case: alpha=0.33 con mas zonas de transito (1 prioridad + 5 transito).
-- W = 1 + 0.33*5 = 2.65; suma redondeada ~ 0.9999 (fuera de 1.0 pero dentro de tolerancia).
TRUNCATE moviles_zonas, moviles_dia;
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('30', 200, 1000, 'URGENTE', 1),
  ('30', 201, 1000, 'URGENTE', 2),
  ('30', 202, 1000, 'URGENTE', 2),
  ('30', 203, 1000, 'URGENTE', 2),
  ('30', 204, 1000, 'URGENTE', 2),
  ('30', 205, 1000, 'URGENTE', 2);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 30, DATE '2026-07-29', true);
UPDATE escenario_settings SET peso_transito_alpha = 0.33 WHERE escenario_id = 1000;
DO $$
DECLARE v numeric;
BEGIN
  SELECT sum(capacidad_efectiva) INTO v FROM demoras_capacidad(1000, DATE '2026-07-29');
  IF abs(v - 1.0) >= 0.001 THEN RAISE EXCEPTION 'alpha=0.33 suma: obtuvo % (fuera de tolerancia)', v; END IF;
  RAISE NOTICE 'ok alpha=0.33 6zonas suma dentro de tolerancia';
END $$;

-- Restaurar alpha a default
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
