\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION chk(desc_ text, got anyelement, want anyelement) RETURNS void AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALLO %: obtuvo % esperaba %', desc_, got, want;
  END IF;
  RAISE NOTICE 'ok %', desc_;
END $$ LANGUAGE plpgsql;

-- clamp inferior
SELECT chk('clamp min', (SELECT informada FROM demoras_acabado(5, NULL, 30,120,30,15,15)), 30);
SELECT chk('clamp min marca', (SELECT clampeado FROM demoras_acabado(5, NULL, 30,120,30,15,15)), 'MIN'::text);
-- clamp superior
SELECT chk('clamp max', (SELECT informada FROM demoras_acabado(999, NULL, 30,120,30,15,15)), 120);
-- redondeo hacia arriba
SELECT chk('31 -> 45', (SELECT informada FROM demoras_acabado(31, 31, 30,120,30,15,15)), 45);
SELECT chk('45 exacto queda 45', (SELECT informada FROM demoras_acabado(45, 45, 30,120,30,15,15)), 45);
-- sin previo, no suaviza
SELECT chk('sin previo', (SELECT suavizada FROM demoras_acabado(100, NULL, 30,120,30,15,15)), 100::numeric);
SELECT chk('sin previo no marca', (SELECT suavizado_aplicado FROM demoras_acabado(100, NULL, 30,120,30,15,15)), false);
-- suavizado: sube como maximo +30
SELECT chk('sube tope 30', (SELECT suavizada FROM demoras_acabado(120, 30, 30,120,30,15,15)), 60::numeric);
-- suavizado: baja como maximo -15
SELECT chk('baja tope 15', (SELECT suavizada FROM demoras_acabado(30, 120, 30,120,30,15,15)), 105::numeric);
-- movimiento menor al tope pasa entero
SELECT chk('sube 10 pasa', (SELECT suavizada FROM demoras_acabado(40, 30, 30,120,30,15,15)), 40::numeric);
-- piso en el redondeo: suavizado puede mover valor fuera de rango si config cambio en caliente
-- demoras_acabado(50, 35, 100, 120, 30, 15, 15): crudo=50 baja de 35 en tope -15 = 20
-- pero 20 es menor que piso 100, asi que debe acotar a 100 sin salir del rango
SELECT chk('piso en redondeo', (SELECT informada FROM demoras_acabado(50, 35, 100, 120, 30, 15, 15)), 100);
-- previo muy por debajo del piso, baja es -15, pero valor acotado a piso
SELECT chk('previo bajo se acota', (SELECT informada FROM demoras_acabado(50, 10, 100, 120, 30, 15, 15)), 100);

-- Secuencia PICO FALSO de la spec: crudo 30,120,60,60,45 -> informa 30,60,60,60,45
DO $$
DECLARE prev numeric := NULL; crudos numeric[] := ARRAY[30,120,60,60,45];
        esperado int[] := ARRAY[30,60,60,60,45]; r record; i int;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM demoras_acabado(crudos[i], prev, 30,120,30,15,15);
    IF r.informada <> esperado[i] THEN
      RAISE EXCEPTION 'pico falso paso %: obtuvo % esperaba %', i, r.informada, esperado[i];
    END IF;
    prev := r.suavizada;
  END LOOP;
  RAISE NOTICE 'ok secuencia pico falso';
END $$;

-- Secuencia CONGESTION REAL: crudo 30,120,120,120,120 -> informa 30,60,90,120,120
DO $$
DECLARE prev numeric := NULL; crudos numeric[] := ARRAY[30,120,120,120,120];
        esperado int[] := ARRAY[30,60,90,120,120]; r record; i int;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM demoras_acabado(crudos[i], prev, 30,120,30,15,15);
    IF r.informada <> esperado[i] THEN
      RAISE EXCEPTION 'congestion paso %: obtuvo % esperaba %', i, r.informada, esperado[i];
    END IF;
    prev := r.suavizada;
  END LOOP;
  RAISE NOTICE 'ok secuencia congestion real';
END $$;
