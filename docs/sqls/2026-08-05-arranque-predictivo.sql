-- =====================================================================
-- ARRANQUE PREDICTIVO: primera demora del dia 100% calculada
-- Fecha: 2026-08-05 | Idempotente | Requiere: toda la cadena hasta
-- 2026-08-04-arranque-despacho-mas-cola aplicada.
--
-- Spec: docs/superpowers/specs/2026-08-04-arranque-predictivo-design.md
--
-- Idea: mientras una zona no tiene ningun movil de PRIORIDAD, la demora
-- sale de "cuanto falta para que llegue el primero (historico por tipo de
-- dia), mas lo que ese movil tarda en atender a los que estan antes, mas
-- tu propia entrega" -- cero valores de demora cargados a mano. Los de
-- TRANSITO son invisibles hasta la hora maxima de espera al prioridad
-- (configurable por escenario+tipo+dia_tipo+zona); pasada esa hora, se
-- calcula con lo que hay (transito con su dedicacion), que entrega antes.
--
-- Alcance v1: SOLO URGENTE. Con el modo PREDICTIVO activo, NOCTURNO y
-- SERVICE conservan el comportamiento DESPACHO_MAS_COLA / techo actual.
--
-- Este archivo NO activa el modo: la eleccion del estimador (percentil /
-- margen) la decide el retro-backtest y la activacion va en un UPDATE
-- aparte (ver el comentario final).
-- =====================================================================

-- ─── 0. Tipo de dia ─────────────────────────────────────────────────
-- HABIL = lunes a viernes. Feriados NO se tratan (decision del usuario:
-- a lo sumo hay menos moviles o zonas inactivas ese dia, y el universo
-- de zonas activas ya lo absorbe).
CREATE OR REPLACE FUNCTION demoras_dia_tipo(p_fecha date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE EXTRACT(ISODOW FROM p_fecha)
           WHEN 6 THEN 'SABADO'
           WHEN 7 THEN 'DOMINGO'
           ELSE 'HABIL' END
$$;

COMMENT ON FUNCTION demoras_dia_tipo(date) IS
  'Clasifica una fecha en HABIL / SABADO / DOMINGO (sin feriados, a proposito). Unica fuente del tipo de dia para ventanas, espera maxima e historico de activacion.';

REVOKE EXECUTE ON FUNCTION demoras_dia_tipo(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_dia_tipo(date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_dia_tipo(date) TO service_role;

-- ─── 1. Ventanas del cron por tipo de dia ───────────────────────────
-- Generaliza la ventana unica hora_inicio/hora_fin de demoras_config: el
-- gate del run lee la fila del tipo de dia de HOY y, si no existe, cae a
-- demoras_config (que queda como respaldo, no se borra). Se siembra SOLO
-- URGENTE (alcance v1): NOCTURNO y SERVICE siguen gateando por
-- demoras_config hasta que se definan.
CREATE TABLE IF NOT EXISTS demoras_ventanas (
  escenario_id  integer NOT NULL,
  tipo_servicio text    NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')),
  dia_tipo      text    NOT NULL CHECK (dia_tipo IN ('HABIL','SABADO','DOMINGO')),
  hora_inicio   time    NOT NULL,
  hora_fin      time    NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  PRIMARY KEY (escenario_id, tipo_servicio, dia_tipo),
  -- Mismo CHECK que demoras_config (B4): una ventana que cruza la
  -- medianoche apagaria el tipo en silencio, porque el gate filtra con
  -- `v_hora BETWEEN inicio AND fin` sobre un time.
  CHECK (hora_fin > hora_inicio)
);

COMMENT ON TABLE demoras_ventanas IS
  'Ventana horaria del motor POR TIPO DE DIA (HABIL/SABADO/DOMINGO). El gate de demoras_calcular_run usa la fila del tipo de dia de hoy y cae a demoras_config.hora_inicio/hora_fin si no hay fila. Sembrada solo para URGENTE (v1).';

INSERT INTO demoras_ventanas (escenario_id, tipo_servicio, dia_tipo, hora_inicio, hora_fin)
SELECT dc.escenario_id, dc.tipo_servicio, d.dia_tipo, dc.hora_inicio, dc.hora_fin
  FROM demoras_config dc
 CROSS JOIN (VALUES ('HABIL'), ('SABADO'), ('DOMINGO')) AS d(dia_tipo)
 WHERE dc.tipo_servicio = 'URGENTE'
ON CONFLICT (escenario_id, tipo_servicio, dia_tipo) DO NOTHING;

REVOKE ALL ON TABLE demoras_ventanas FROM PUBLIC;
REVOKE ALL ON TABLE demoras_ventanas FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_ventanas TO service_role;

-- ─── 2. Espera maxima al movil de prioridad ─────────────────────────
-- "Hasta que hora del dia se le espera al prioridad": dentro de esa
-- ventana el transito es invisible y se promete la espera (capeada a
-- esta hora); pasada, se calcula con lo que hay. Por tipo de dia
-- (decision del usuario) y con override por zona (zona_id NULL = default
-- del escenario+tipo+dia_tipo). Seed: apertura de la ventana + 2 horas.
CREATE TABLE IF NOT EXISTS demoras_espera_max (
  id            bigserial PRIMARY KEY,
  escenario_id  integer NOT NULL,
  tipo_servicio text    NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')),
  dia_tipo      text    NOT NULL CHECK (dia_tipo IN ('HABIL','SABADO','DOMINGO')),
  zona_id       integer,
  hora_max      time    NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

-- Unicidad con el NULL colapsado: una sola default por (esc, tipo, dia)
-- y una sola fila por zona.
CREATE UNIQUE INDEX IF NOT EXISTS demoras_espera_max_uq
  ON demoras_espera_max (escenario_id, tipo_servicio, dia_tipo, COALESCE(zona_id, -1));

COMMENT ON TABLE demoras_espera_max IS
  'Hora maxima del dia hasta la que se espera al primer movil de PRIORIDAD (arranque PREDICTIVO). zona_id NULL = default del escenario+tipo+dia_tipo; la fila con zona pisa la default. Antes de esa hora el transito es invisible para la primera demora; despues, el motor calcula con lo que hay.';

INSERT INTO demoras_espera_max (escenario_id, tipo_servicio, dia_tipo, zona_id, hora_max)
SELECT dc.escenario_id, dc.tipo_servicio, d.dia_tipo, NULL,
       dc.hora_inicio + interval '2 hours'
  FROM demoras_config dc
 CROSS JOIN (VALUES ('HABIL'), ('SABADO'), ('DOMINGO')) AS d(dia_tipo)
 WHERE dc.tipo_servicio = 'URGENTE'
   AND NOT EXISTS (SELECT 1 FROM demoras_espera_max e
                    WHERE e.escenario_id = dc.escenario_id
                      AND e.tipo_servicio = dc.tipo_servicio
                      AND e.dia_tipo = d.dia_tipo
                      AND e.zona_id IS NULL);

REVOKE ALL ON TABLE demoras_espera_max FROM PUBLIC;
REVOKE ALL ON TABLE demoras_espera_max FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_espera_max TO service_role;
GRANT  USAGE ON SEQUENCE demoras_espera_max_id_seq TO service_role;

-- ─── 3. Historico de primera activacion del prioridad ───────────────
-- Una fila por (escenario, tipo, zona, dia): a que hora aparecio el
-- primer movil de PRIORIDAD segun las corridas del motor
-- (demoras_calculadas.moviles_prioridad > 0). primer_prioridad_at NULL =
-- ese dia hubo corridas pero nunca un prioridad (cuenta como dia SIN
-- muestra para el estimador). Granularidad 10 min (la del motor).
CREATE TABLE IF NOT EXISTS demoras_activacion_hist (
  escenario_id        integer NOT NULL,
  tipo_servicio       text    NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')),
  zona_id             integer NOT NULL,
  fecha               date    NOT NULL,
  dia_tipo            text    NOT NULL CHECK (dia_tipo IN ('HABIL','SABADO','DOMINGO')),
  primer_prioridad_at timestamptz,
  PRIMARY KEY (escenario_id, tipo_servicio, zona_id, fecha)
);

CREATE INDEX IF NOT EXISTS demoras_activacion_hist_fecha_idx
  ON demoras_activacion_hist (escenario_id, fecha);

COMMENT ON TABLE demoras_activacion_hist IS
  'A que hora aparecio el primer movil de PRIORIDAD en cada zona, cada dia, reconstruido de demoras_calculadas por el job nocturno demoras_activacion_snapshot. Insumo del arranque PREDICTIVO. NULL = ese dia nunca hubo prioridad. Retencion 90 dias.';

REVOKE ALL ON TABLE demoras_activacion_hist FROM PUBLIC;
REVOKE ALL ON TABLE demoras_activacion_hist FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_activacion_hist TO service_role;

-- ─── 4. Snapshot nocturno ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION demoras_activacion_snapshot(
  p_fecha date DEFAULT ((now() AT TIME ZONE 'America/Montevideo')::date - 1)
)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO demoras_activacion_hist
    (escenario_id, tipo_servicio, zona_id, fecha, dia_tipo, primer_prioridad_at)
  SELECT dc.escenario, dc.tipo_servicio, dc.zona_id, p_fecha,
         demoras_dia_tipo(p_fecha),
         min(dc.corrida_at) FILTER (WHERE dc.moviles_prioridad > 0)
    FROM demoras_calculadas dc
   WHERE dc.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
     AND dc.corrida_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/Montevideo')
   GROUP BY dc.escenario, dc.tipo_servicio, dc.zona_id
  ON CONFLICT (escenario_id, tipo_servicio, zona_id, fecha) DO UPDATE
    SET primer_prioridad_at = EXCLUDED.primer_prioridad_at,
        dia_tipo            = EXCLUDED.dia_tipo;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Retencion: 90 dias alcanzan de sobra para las ventanas del estimador
  -- (10 habiles / 4 sabados / 4 domingos).
  DELETE FROM demoras_activacion_hist
   WHERE fecha < (now() AT TIME ZONE 'America/Montevideo')::date - 90;

  RETURN v_n;
END
$fn$;

COMMENT ON FUNCTION demoras_activacion_snapshot(date) IS
  'Materializa en demoras_activacion_hist la primera corrida del dia con moviles_prioridad > 0, por (escenario, tipo, zona). Corre por pg_cron a las 03:40 UY con la fecha de AYER; tambien sirve para backfill llamandola con fechas pasadas. Idempotente (upsert).';

REVOKE EXECUTE ON FUNCTION demoras_activacion_snapshot(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_activacion_snapshot(date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_activacion_snapshot(date) TO service_role;

-- El job nocturno. 03:40 UY = 06:40 UTC (pg_cron corre en UTC), despues
-- de los cleanup de 02:30/02:45 y del backfill de desfasaje.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('demoras-activacion-hist', '40 6 * * *',
      $j$SELECT demoras_activacion_snapshot()$j$);
  ELSE
    RAISE NOTICE 'sin pg_cron (harness): correr SELECT demoras_activacion_snapshot(fecha) a mano';
  END IF;
END $$;

-- ─── 5. Perillas nuevas en demoras_modelo ───────────────────────────
ALTER TABLE demoras_modelo
  ADD COLUMN IF NOT EXISTS activacion_percentil      numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS activacion_margen_minutos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activacion_min_muestras   integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS activacion_gracia_minutos integer NOT NULL DEFAULT 20;

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_activacion_chk;
ALTER TABLE demoras_modelo ADD CONSTRAINT demoras_modelo_activacion_chk
  CHECK (activacion_percentil > 0 AND activacion_percentil < 1
     AND activacion_margen_minutos BETWEEN 0 AND 60
     AND activacion_min_muestras  BETWEEN 1 AND 30
     AND activacion_gracia_minutos BETWEEN 0 AND 120);

COMMENT ON COLUMN demoras_modelo.activacion_percentil IS
  'Arranque PREDICTIVO: que percentil del historico de primeras activaciones usar como hora estimada (0.5 = mediana, 0.75 = conservador). Lo elige el retro-backtest, no el ojo.';
COMMENT ON COLUMN demoras_modelo.activacion_margen_minutos IS
  'Arranque PREDICTIVO: colchon en minutos que se suma a la hora estimada de activacion (0 = sin colchon).';
COMMENT ON COLUMN demoras_modelo.activacion_min_muestras IS
  'Arranque PREDICTIVO: minimo de dias con activacion registrada para confiar en el estimador. Cadena de respaldo: mismo tipo de dia -> historico general de la zona -> apertura de la ventana.';
COMMENT ON COLUMN demoras_modelo.activacion_gracia_minutos IS
  'Arranque PREDICTIVO: minutos despues de la hora estimada durante los que se mantiene la promesa. Pasada la gracia sin prioridad, la escalera sube hacia el techo (no sabemos que le paso al movil) hasta la hora maxima de espera.';

-- El modo nuevo en la perilla de arranque.
ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_arranque_chk;
ALTER TABLE demoras_modelo ADD CONSTRAINT demoras_modelo_arranque_chk
  CHECK (arranque_sin_movil_modo IN ('TECHO', 'DESPACHO', 'DESPACHO_MAS_COLA', 'PREDICTIVO'));

COMMENT ON COLUMN demoras_modelo.arranque_sin_movil_modo IS
  'Que informar cuando la zona no tiene movil: TECHO = max_minutos; DESPACHO = valor del Despacho/AS400 solo con zona vacia; DESPACHO_MAS_COLA = Despacho + cola equivalente x ritmo; PREDICTIVO (solo URGENTE) = espera estimada al primer prioridad + (cola+1) x ritmo, con transito invisible hasta la hora maxima de espera -- NOCTURNO/SERVICE se comportan como DESPACHO_MAS_COLA. Ver docs/superpowers/specs/2026-08-04-arranque-predictivo-design.md.';

-- ─── 6. Auditoria del arranque en demoras_calculadas ────────────────
-- Combustible de la fase de explicabilidad: cada corrida deja escrito en
-- que fase del arranque estaba la zona y con que insumos.
ALTER TABLE demoras_calculadas
  ADD COLUMN IF NOT EXISTS arranque_fase          text,
  ADD COLUMN IF NOT EXISTS activacion_estimada_at timestamptz,
  ADD COLUMN IF NOT EXISTS activacion_origen      text,
  ADD COLUMN IF NOT EXISTS espera_minutos         numeric,
  ADD COLUMN IF NOT EXISTS espera_max_at          timestamptz;

ALTER TABLE demoras_calculadas DROP CONSTRAINT IF EXISTS demoras_calc_arranque_fase_chk;
ALTER TABLE demoras_calculadas ADD CONSTRAINT demoras_calc_arranque_fase_chk
  CHECK (arranque_fase IS NULL OR arranque_fase IN ('PREDICTIVO','GRACIA_VENCIDA','TRANSITO'));

ALTER TABLE demoras_calculadas DROP CONSTRAINT IF EXISTS demoras_calc_activacion_origen_chk;
ALTER TABLE demoras_calculadas ADD CONSTRAINT demoras_calc_activacion_origen_chk
  CHECK (activacion_origen IS NULL OR activacion_origen IN ('DIA_TIPO','GENERAL','HORARIO'));

COMMENT ON COLUMN demoras_calculadas.arranque_fase IS
  'Arranque PREDICTIVO (solo filas URGENTE sin prioridad con el modo activo): PREDICTIVO = prometiendo la espera al primer movil; GRACIA_VENCIDA = paso la hora estimada + gracia sin movil (escalera al techo, transito sigue invisible); TRANSITO = paso la hora maxima de espera y el calculo normal corre con los de transito. NULL = el arranque no aplico (hay prioridad, otro tipo, u otro modo).';
COMMENT ON COLUMN demoras_calculadas.activacion_estimada_at IS
  'Hora estimada de activacion del primer prioridad usada en esta corrida (SIN capear a la espera maxima; incluye el margen). Solo filas con arranque_fase.';
COMMENT ON COLUMN demoras_calculadas.activacion_origen IS
  'De donde salio la estimacion: DIA_TIPO = historico del mismo tipo de dia; GENERAL = historico de la zona sin separar tipo de dia; HORARIO = apertura de la ventana (sin muestra suficiente).';
COMMENT ON COLUMN demoras_calculadas.espera_minutos IS
  'Minutos de espera al primer prioridad aplicados en la formula (ya capeados a la espera maxima). Solo filas con arranque_fase = PREDICTIVO.';
COMMENT ON COLUMN demoras_calculadas.espera_max_at IS
  'Hora maxima de espera al prioridad vigente para esta zona en esta corrida (demoras_espera_max, override de zona o default).';

-- ─── 7. demoras_calcular_run v6 ─────────────────────────────────────
-- v6 = v5 + (a) gate de ventana por tipo de dia (demoras_ventanas con
-- respaldo en demoras_config), (b) CTEs de estimacion de activacion +
-- espera maxima, (c) el arbol PREDICTIVO en `crudo`, (d) bypass del
-- suavizado al entrar en fase TRANSITO ("dar una mejor demora" a la
-- corrida siguiente de vencer la espera, no una hora despues), (e) las
-- columnas de auditoria del arranque en el INSERT.
CREATE OR REPLACE FUNCTION demoras_calcular_run(p_corrida_at timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_esc      integer;
  v_local    timestamp;
  v_fecha    date;
  v_hora     time;
  v_dia_tipo text;
  v_escritas bigint := 0;
  v_n        bigint;
  m          record;
BEGIN
  -- Lock UNA sola vez, ANTES del loop: serializa la corrida entera. Ver el
  -- comentario extenso del encabezado.
  IF NOT pg_try_advisory_xact_lock(2180637405::bigint) THEN
    RAISE NOTICE 'demoras_calcular_run: ya hay una corrida en curso, salteando';
    RETURN 0;
  END IF;

  -- La hora local es la MISMA para todos los escenarios: es una conversion
  -- de huso horario sobre p_corrida_at, no algo que dependa del escenario.
  v_local    := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha    := v_local::date;
  v_hora     := v_local::time;
  v_dia_tipo := demoras_dia_tipo(v_fecha);

  -- Un escenario se calcula si y solo si tiene fila en demoras_modelo. Uno
  -- con demoras_config pero SIN demoras_modelo no aparece aca y no se
  -- calcula -- es la misma logica que hoy usa un tipo sin fila en
  -- demoras_config para quedar apagado, un nivel mas arriba.
  FOR m IN SELECT * FROM demoras_modelo ORDER BY escenario_id LOOP
    v_esc := m.escenario_id;

    WITH
    -- Solo lo OPERATIVO por tipo. Un tipo sin fila aca no se calcula, y esa
    -- sigue siendo la forma de apagar un tipo sin borrar historico.
    -- v6: la ventana horaria sale de demoras_ventanas (por tipo de dia)
    -- cuando hay fila, y cae a demoras_config si no la hay -- NOCTURNO y
    -- SERVICE no estan sembrados y siguen gateando como siempre.
    cfg AS (
      SELECT dc.tipo_servicio,
             coalesce(dv.hora_inicio, dc.hora_inicio) AS ventana_inicio
        FROM demoras_config dc
        LEFT JOIN demoras_ventanas dv
               ON dv.escenario_id  = dc.escenario_id
              AND dv.tipo_servicio = dc.tipo_servicio
              AND dv.dia_tipo      = v_dia_tipo
       WHERE dc.escenario_id = v_esc
         AND dc.motor_activo
         AND v_hora BETWEEN coalesce(dv.hora_inicio, dc.hora_inicio)
                        AND coalesce(dv.hora_fin,    dc.hora_fin)
    ),
    zonas_activas AS (
      SELECT DISTINCT d.zona_id
        FROM demoras d
       WHERE d.escenario_id = v_esc AND d.descripcion = 'URGENTE' AND d.activa
    ),
    cola AS (
      SELECT * FROM demoras_cola(v_esc, v_fecha, p_corrida_at)
    ),
    -- Reemplaza al CTE `hueco` de la v2 (demoras_proximo_hueco). Devuelve
    -- demora_cruda SIN clamp/suavizado/redondeo (eso lo hace demoras_acabado
    -- mas abajo, sin cambios) y las columnas de auditoria del modelo nuevo:
    -- capacidad_inicial, capacidad_final, tramos, cola_por_delante,
    -- moviles_considerados. NO se lee tr.sin_capacidad aca -- ver el
    -- comentario extenso del encabezado sobre por que esa columna usa
    -- moviles_activos en los dos modelos y no el atajo interno de ninguno.
    tr AS (
      SELECT * FROM demoras_consumo_tramos(v_esc, v_fecha, p_corrida_at)
    ),
    cap AS (
      SELECT * FROM demoras_capacidad(v_esc, v_fecha)
    ),
    rit AS (
      SELECT * FROM demoras_ritmo(v_esc, v_fecha)
    ),
    universo AS (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo_servicio,
             cf.ventana_inicio
        FROM moviles_zonas mz
        JOIN zonas_activas za ON za.zona_id = mz.zona_id
        JOIN cfg cf           ON cf.tipo_servicio = mz.tipo_de_servicio
       WHERE mz.escenario_id = v_esc
         AND coalesce(mz.activa, true)
         AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ),
    -- La corrida anterior DENTRO de este escenario -filtrado por
    -- escenario = v_esc, que es la columna lider del indice
    -- idx_demoras_calc_esc_zona_tipo_at. Ver el comentario del encabezado
    -- sobre por que este indice sigue sirviendo con N escenarios.
    -- v6: tambien arrastra arranque_fase para detectar la ENTRADA en fase
    -- TRANSITO (bypass del suavizado en esa transicion).
    prev AS (
      SELECT DISTINCT ON (zona_id, tipo_servicio)
             zona_id, tipo_servicio, demora_suavizada, moviles_activos,
             arranque_fase
        FROM demoras_calculadas
       WHERE escenario = v_esc
         AND corrida_at >= (v_fecha::timestamp AT TIME ZONE 'America/Montevideo')
         AND corrida_at < p_corrida_at
         AND (corrida_at AT TIME ZONE 'America/Montevideo')::date = v_fecha
       ORDER BY zona_id, tipo_servicio, corrida_at DESC
    ),
    -- ── Estimacion de la primera activacion (arranque PREDICTIVO) ────
    -- Historico de primeras activaciones de PRIORIDAD, con dos ventanas
    -- moviles: la del MISMO tipo de dia (ultimos 10 habiles / 4 finde) y
    -- la general de la zona (ultimos 10 dias con activacion). Los dias
    -- SIN activacion no cuentan como muestra: el estimador dice "cuando
    -- viene, viene a esta hora"; si hoy no viene, lo cubren la gracia y
    -- la espera maxima.
    act_hist AS (
      SELECT h.zona_id, h.tipo_servicio, h.dia_tipo, h.primer_prioridad_at,
             row_number() OVER (PARTITION BY h.zona_id, h.tipo_servicio, h.dia_tipo
                                ORDER BY h.fecha DESC) AS rn_tipo,
             row_number() OVER (PARTITION BY h.zona_id, h.tipo_servicio
                                ORDER BY h.fecha DESC) AS rn_gral
        FROM demoras_activacion_hist h
       WHERE h.escenario_id = v_esc
         AND h.fecha <  v_fecha
         AND h.fecha >= v_fecha - 35
         AND h.primer_prioridad_at IS NOT NULL
    ),
    act_tipo AS (
      SELECT ah.zona_id, ah.tipo_servicio,
             count(*)::integer AS muestras,
             percentile_cont(m.activacion_percentil::double precision) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (ah.primer_prioridad_at
                                            AT TIME ZONE 'America/Montevideo')::time)::double precision
             ) AS seg
        FROM act_hist ah
       WHERE ah.dia_tipo = v_dia_tipo
         AND ah.rn_tipo <= CASE WHEN v_dia_tipo = 'HABIL' THEN 10 ELSE 4 END
       GROUP BY ah.zona_id, ah.tipo_servicio
    ),
    act_gral AS (
      SELECT ah.zona_id, ah.tipo_servicio,
             count(*)::integer AS muestras,
             percentile_cont(m.activacion_percentil::double precision) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (ah.primer_prioridad_at
                                            AT TIME ZONE 'America/Montevideo')::time)::double precision
             ) AS seg
        FROM act_hist ah
       WHERE ah.rn_gral <= 10
       GROUP BY ah.zona_id, ah.tipo_servicio
    ),
    -- Espera maxima vigente: la fila de la zona pisa la default (NULL).
    emax AS (
      SELECT u.zona_id, u.tipo_servicio,
             coalesce(ez.hora_max, ed.hora_max) AS hora_max
        FROM universo u
        LEFT JOIN demoras_espera_max ez
               ON ez.escenario_id = v_esc AND ez.tipo_servicio = u.tipo_servicio
              AND ez.dia_tipo = v_dia_tipo AND ez.zona_id = u.zona_id
        LEFT JOIN demoras_espera_max ed
               ON ed.escenario_id = v_esc AND ed.tipo_servicio = u.tipo_servicio
              AND ed.dia_tipo = v_dia_tipo AND ed.zona_id IS NULL
    ),
    arm AS (
      SELECT
        u.zona_id, u.tipo_servicio,
        coalesce(q.asignados,0)     AS asignados,
        coalesce(q.sin_asignar,0)   AS sin_asignar,
        coalesce(q.atrapados,0)     AS atrapados,
        coalesce(c.capacidad_efectiva,0) AS capacidad,
        coalesce(c.moviles_activos,0)    AS mov_act,
        coalesce(c.moviles_prioridad,0)  AS mov_pri,
        coalesce(c.moviles_transito,0)   AS mov_tra,
        coalesce(c.alpha_usado,0.3)      AS alpha,
        r.ritmo_media, r.ritmo_mediana, r.ritmo_p75, r.ritmo_p90, r.ritmo_muestras,
        coalesce(rc.stat, m.ritmo_default_minutos) AS ritmo_usado,
        CASE WHEN rc.stat IS NULL THEN 'DEFECTO'
             ELSE coalesce(r.ritmo_origen, 'GLOBAL') END AS ritmo_origen,
        p.demora_suavizada AS prev_suav,
        p.moviles_activos  AS prev_mov,
        p.arranque_fase    AS prev_fase,
        -- Insumos de auditoria del modelo CONSUMO_TRAMOS: se llevan crudos
        -- hasta `crudo`, que los deja en NULL cuando corre CAPACIDAD_PROMEDIO
        -- -- ver el comentario de mas abajo.
        tr.demora_cruda          AS tramos_cruda,
        tr.moviles_considerados  AS tramos_moviles_considerados,
        tr.cola_por_delante      AS tramos_cola_por_delante,
        tr.capacidad_inicial     AS tramos_capacidad_inicial,
        tr.capacidad_final       AS tramos_capacidad_final,
        tr.tramos                AS tramos_n,
        (SELECT dd.minutos FROM demoras dd
          WHERE dd.escenario_id = v_esc AND dd.zona_id = u.zona_id
            AND dd.descripcion = u.tipo_servicio
          ORDER BY dd.updated_at DESC, dd.demora_id DESC
          LIMIT 1) AS as400,
        -- Insumos del arranque PREDICTIVO.
        u.ventana_inicio,
        atp.seg                    AS act_tipo_seg,
        coalesce(atp.muestras, 0)  AS act_tipo_muestras,
        agr.seg                    AS act_gral_seg,
        coalesce(agr.muestras, 0)  AS act_gral_muestras,
        emx.hora_max               AS espera_hora_max
      FROM universo u
      LEFT JOIN cola  q ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo_servicio
      LEFT JOIN tr       ON tr.zona_id = u.zona_id AND tr.tipo_servicio = u.tipo_servicio
      LEFT JOIN cap   c ON c.zona_id = u.zona_id AND c.tipo_servicio = u.tipo_servicio
      LEFT JOIN rit   r ON r.zona_id = u.zona_id AND r.tipo_servicio = u.tipo_servicio
      LEFT JOIN prev  p ON p.zona_id = u.zona_id AND p.tipo_servicio = u.tipo_servicio
      LEFT JOIN act_tipo atp ON atp.zona_id = u.zona_id AND atp.tipo_servicio = u.tipo_servicio
      LEFT JOIN act_gral agr ON agr.zona_id = u.zona_id AND agr.tipo_servicio = u.tipo_servicio
      LEFT JOIN emax     emx ON emx.zona_id = u.zona_id AND emx.tipo_servicio = u.tipo_servicio
      CROSS JOIN LATERAL (
        SELECT CASE m.estadistico WHEN 'MEDIA' THEN r.ritmo_media
                                  WHEN 'P75'   THEN r.ritmo_p75
                                  WHEN 'P90'   THEN r.ritmo_p90
                                  ELSE r.ritmo_mediana END AS stat
      ) rc
    ),
    -- ── La fase del arranque, resuelta UNA vez por fila ──────────────
    -- est_capped: la estimacion se capea a la espera maxima -- se espera
    -- al prioridad HASTA esa hora aunque el historico diga mas tarde
    -- (correccion del usuario: el max se respeta siempre, nunca se
    -- promete mas alla de el, pero tampoco se saltea la espera).
    pred AS (
      SELECT a.*,
             e0.act_origen,
             e1.act_estimada_at,
             e1.espera_max_at,
             e2.est_capped_at,
             e3.espera_min,
             CASE
               WHEN m.arranque_sin_movil_modo = 'PREDICTIVO'
                    AND a.tipo_servicio = 'URGENTE'
                    AND a.mov_pri <= 0
                    AND e1.espera_max_at IS NOT NULL
               THEN CASE
                      WHEN p_corrida_at <= e1.espera_max_at THEN
                        CASE WHEN p_corrida_at <= e2.est_capped_at
                                  + make_interval(mins => m.activacion_gracia_minutos)
                             THEN 'PREDICTIVO'
                             ELSE 'GRACIA_VENCIDA' END
                      WHEN a.mov_tra > 0 THEN 'TRANSITO'
                      ELSE NULL
                    END
               ELSE NULL
             END AS arranque_fase
      FROM arm a
      CROSS JOIN LATERAL (
        SELECT CASE WHEN a.act_tipo_muestras >= m.activacion_min_muestras
                      THEN a.act_tipo_seg
                    WHEN a.act_gral_muestras >= m.activacion_min_muestras
                      THEN a.act_gral_seg
                    ELSE EXTRACT(EPOCH FROM a.ventana_inicio)::double precision
               END AS act_seg,
               CASE WHEN a.act_tipo_muestras >= m.activacion_min_muestras THEN 'DIA_TIPO'
                    WHEN a.act_gral_muestras >= m.activacion_min_muestras THEN 'GENERAL'
                    ELSE 'HORARIO' END AS act_origen
      ) e0
      CROSS JOIN LATERAL (
        SELECT ((v_fecha::timestamp
                 + make_interval(secs => e0.act_seg + m.activacion_margen_minutos * 60.0))
                AT TIME ZONE 'America/Montevideo')            AS act_estimada_at,
               CASE WHEN a.espera_hora_max IS NOT NULL
                    THEN ((v_fecha + a.espera_hora_max)::timestamp
                          AT TIME ZONE 'America/Montevideo') END AS espera_max_at
      ) e1
      CROSS JOIN LATERAL (
        SELECT LEAST(e1.act_estimada_at, e1.espera_max_at) AS est_capped_at
      ) e2
      CROSS JOIN LATERAL (
        SELECT GREATEST(0, EXTRACT(EPOCH FROM (e2.est_capped_at - p_corrida_at)) / 60.0)
               AS espera_min
      ) e3
    ),
    crudo AS (
      SELECT a.*,
             CASE
               -- ARRANQUE PREDICTIVO (2026-08-05, solo URGENTE): la zona no
               -- tiene ningun movil de PRIORIDAD y estamos dentro de la
               -- ventana de espera. La demora es fisica: cuanto falta para
               -- que llegue el primero (capeado a la espera maxima) + lo
               -- que tarda en atender a los que estan antes + tu entrega.
               -- El transito es INVISIBLE en esta fase aunque este activo:
               -- por eso esta rama va ANTES que la del modelo (que si lo
               -- cuenta con su dedicacion).
               WHEN a.arranque_fase = 'PREDICTIVO'
                 THEN a.espera_min
                      + (coalesce(a.tramos_cola_por_delante,
                                  (a.asignados + a.sin_asignar))::numeric + 1)
                        * a.ritmo_usado
               -- Paso la hora estimada + gracia y el prioridad no aparecio:
               -- no sabemos que le paso; la escalera sube hacia el techo y
               -- el transito SIGUE invisible hasta la espera maxima.
               WHEN a.arranque_fase = 'GRACIA_VENCIDA'
                 THEN m.max_minutos::numeric
               -- (La fase TRANSITO no tiene rama propia: cae al modelo de
               -- abajo, que cuenta a los de transito con su dedicacion.)
               -- Perilla de arranque DESPACHO / DESPACHO_MAS_COLA (2026-08-04).
               -- Con el modo PREDICTIVO activo llegan aca: NOCTURNO y
               -- SERVICE siempre (el predictivo es solo URGENTE en v1), y
               -- URGENTE solo con fase NULL = pasada la espera maxima sin
               -- transito NI moviles (mov_act <= 0): "considerar todo lo
               -- que hay" con la zona muerta = el valor del Despacho + la
               -- cola, no el techo (medido 3/8: 5/7 aciertos vs 0/7).
               -- Las fases PREDICTIVO/GRACIA_VENCIDA ya salieron por las
               -- ramas de arriba, y TRANSITO tiene mov_act > 0.
               WHEN m.arranque_sin_movil_modo IN ('DESPACHO', 'DESPACHO_MAS_COLA', 'PREDICTIVO')
                    AND a.mov_act <= 0
                    AND a.as400 IS NOT NULL
                    AND (m.arranque_sin_movil_modo IN ('DESPACHO_MAS_COLA', 'PREDICTIVO')
                         OR (a.asignados + a.sin_asignar) = 0)
                 THEN a.as400::numeric
                      + CASE WHEN m.arranque_sin_movil_modo IN ('DESPACHO_MAS_COLA', 'PREDICTIVO')
                             THEN coalesce(a.tramos_cola_por_delante,
                                           (a.asignados + a.sin_asignar))::numeric
                                  * a.ritmo_usado
                             ELSE 0 END
               -- Modelo nuevo: el numero ya viene resuelto de la simulacion,
               -- con su propio techo (el `sin_capacidad` interno de
               -- demoras_consumo_tramos ya esta reflejado en este numero).
               WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_cruda
               -- Modelo viejo, conservado tal cual para poder comparar. El
               -- orden del CASE importa: la falta de capacidad manda sobre la
               -- falta de demanda.
               WHEN a.capacidad <= 0                  THEN m.max_minutos::numeric
               WHEN (a.asignados + a.sin_asignar) = 0 THEN m.min_minutos::numeric
               ELSE ((a.asignados + a.sin_asignar)::numeric / a.capacidad)
                    * a.ritmo_usado * m.factor_calibracion
             END AS demora_cruda,
             -- sin_cap describe el ESTADO DEL MUNDO, LA MISMA EXPRESION EN
             -- LOS DOS MODELOS: habia algun movil activo asignado a esta
             -- zona hoy (moviles_activos <= 0, de demoras_capacidad)? No es
             -- un CASE por modelo a proposito -- ver el comentario extenso
             -- del encabezado.
             (a.mov_act <= 0) AS sin_cap,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_moviles_considerados ELSE NULL END AS moviles_considerados,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_cola_por_delante     ELSE NULL END AS cola_por_delante,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_capacidad_inicial    ELSE NULL END AS capacidad_inicial,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_capacidad_final      ELSE NULL END AS capacidad_final,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_n                    ELSE NULL END AS tramos,
             -- Bypass del suavizado: (a) si cambio la cantidad de moviles
             -- activos respecto de la corrida anterior, la variacion es
             -- estructural (entro o salio un movil), no ruido; (b) v6: al
             -- ENTRAR en fase TRANSITO (vencio la espera maxima), el numero
             -- nuevo sale de un regimen distinto -- frenarlo con la
             -- escalera seria seguir prometiendo la espera que acabamos de
             -- abandonar ("a las 10:10 debe dar una mejor demora").
             CASE WHEN (m.suavizado_bypass_cambio_capacidad
                        AND a.prev_mov IS DISTINCT FROM a.mov_act)
                    OR (a.arranque_fase = 'TRANSITO'
                        AND a.prev_fase IS DISTINCT FROM 'TRANSITO')
                  THEN NULL ELSE a.prev_suav END AS prev_efectivo
      FROM pred a
    ),
    final AS (
      SELECT c.*, f.suavizada, f.informada, f.clampeado, f.suavizado_aplicado
      FROM crudo c
      CROSS JOIN LATERAL demoras_acabado(
        c.demora_cruda, c.prev_efectivo,
        m.min_minutos, m.max_minutos, m.subida_max, m.bajada_max, m.escalon_minutos
      ) f
    ),
    ins AS (
      INSERT INTO demoras_calculadas (
        corrida_at, escenario, zona_id, tipo_servicio,
        demora_informada, demora_suavizada, demora_cruda, demora_as400,
        pendientes_asignados, pendientes_sin_asignar, pendientes_atrapados,
        capacidad_efectiva, moviles_activos, moviles_prioridad, moviles_transito, alpha_usado,
        ritmo_media, ritmo_mediana, ritmo_p75, ritmo_p90, ritmo_usado, ritmo_origen, ritmo_muestras,
        capacidad_inicial, capacidad_final, tramos, cola_por_delante, moviles_considerados,
        sin_capacidad, clampeado, suavizado_aplicado, modelo_version,
        arranque_fase, activacion_estimada_at, activacion_origen, espera_minutos, espera_max_at
      )
      SELECT
        p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
        f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
        f.asignados, f.sin_asignar, f.atrapados,
        f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
        f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
        f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
        f.capacidad_inicial, f.capacidad_final, f.tramos, f.cola_por_delante, f.moviles_considerados,
        f.sin_cap, f.clampeado, f.suavizado_aplicado, m.version,
        f.arranque_fase,
        CASE WHEN f.arranque_fase IS NOT NULL THEN f.act_estimada_at END,
        CASE WHEN f.arranque_fase IS NOT NULL THEN f.act_origen END,
        CASE WHEN f.arranque_fase = 'PREDICTIVO' THEN round(f.espera_min::numeric, 1) END,
        CASE WHEN f.arranque_fase IS NOT NULL THEN f.espera_max_at END
      FROM final f
      ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio) DO UPDATE SET
        demora_informada        = EXCLUDED.demora_informada,
        demora_suavizada        = EXCLUDED.demora_suavizada,
        demora_cruda            = EXCLUDED.demora_cruda,
        demora_as400            = EXCLUDED.demora_as400,
        pendientes_asignados    = EXCLUDED.pendientes_asignados,
        pendientes_sin_asignar  = EXCLUDED.pendientes_sin_asignar,
        pendientes_atrapados    = EXCLUDED.pendientes_atrapados,
        capacidad_efectiva      = EXCLUDED.capacidad_efectiva,
        moviles_activos         = EXCLUDED.moviles_activos,
        moviles_prioridad       = EXCLUDED.moviles_prioridad,
        moviles_transito        = EXCLUDED.moviles_transito,
        alpha_usado             = EXCLUDED.alpha_usado,
        ritmo_media             = EXCLUDED.ritmo_media,
        ritmo_mediana           = EXCLUDED.ritmo_mediana,
        ritmo_p75               = EXCLUDED.ritmo_p75,
        ritmo_p90               = EXCLUDED.ritmo_p90,
        ritmo_usado             = EXCLUDED.ritmo_usado,
        ritmo_origen            = EXCLUDED.ritmo_origen,
        ritmo_muestras          = EXCLUDED.ritmo_muestras,
        capacidad_inicial       = EXCLUDED.capacidad_inicial,
        capacidad_final         = EXCLUDED.capacidad_final,
        tramos                  = EXCLUDED.tramos,
        cola_por_delante        = EXCLUDED.cola_por_delante,
        moviles_considerados    = EXCLUDED.moviles_considerados,
        sin_capacidad           = EXCLUDED.sin_capacidad,
        clampeado               = EXCLUDED.clampeado,
        suavizado_aplicado      = EXCLUDED.suavizado_aplicado,
        modelo_version          = EXCLUDED.modelo_version,
        arranque_fase           = EXCLUDED.arranque_fase,
        activacion_estimada_at  = EXCLUDED.activacion_estimada_at,
        activacion_origen       = EXCLUDED.activacion_origen,
        espera_minutos          = EXCLUDED.espera_minutos,
        espera_max_at           = EXCLUDED.espera_max_at
      RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;

    v_escritas := v_escritas + v_n;
  END LOOP;

  RETURN v_escritas;
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora. Recorre TODOS los escenarios con fila en demoras_modelo y para cada uno despacha entre CONSUMO_TRAMOS (simulacion por tramos sobre demoras_aportes) y CAPACIDAD_PROMEDIO (el modelo viejo), escribiendo las MISMAS columnas en los dos casos para poder compararlos. v6: gate de ventana por tipo de dia (demoras_ventanas con respaldo en demoras_config) y arranque PREDICTIVO para URGENTE (espera estimada al primer movil de prioridad + cola, con transito invisible hasta la espera maxima -- ver el CTE pred y la spec 2026-08-04-arranque-predictivo-design.md). El advisory lock se toma UNA sola vez, antes del loop de escenarios: serializa la corrida entera. sin_capacidad es la MISMA expresion (moviles_activos <= 0) en los dos modelos.';

REVOKE EXECUTE ON FUNCTION demoras_calcular_run(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_calcular_run(timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_calcular_run(timestamptz) TO service_role;

-- =====================================================================
-- ACTIVACION: NO va en este archivo. El retro-backtest de estimadores
-- (mediana / mediana+margen / p75) contra la ultima semana elige
-- activacion_percentil / activacion_margen_minutos, y recien ahi:
--
--   UPDATE demoras_modelo
--      SET arranque_sin_movil_modo = 'PREDICTIVO',
--          activacion_percentil     = <lo que gane>,
--          activacion_margen_minutos = <lo que gane>
--    WHERE escenario_id = 1000;
--
-- Revertir: UPDATE demoras_modelo SET arranque_sin_movil_modo =
-- 'DESPACHO_MAS_COLA' WHERE escenario_id = 1000;
-- =====================================================================
