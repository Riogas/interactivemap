-- =====================================================================
-- EL CICLO DIARIO DEL LABORATORIO: evaluar, buscar, proponer
-- Fecha: 2026-08-07 | Idempotente | Pedido del usuario (7/8):
-- "que dia a dia se ejecute algo que revise todos los calculos segun
--  todas las posibilidades del laboratorio y los compare contra
--  despacho y vaya razonando y mejorando o armando nuevas combinatorias".
--
-- Son tres piezas, en este orden:
--
--  1. EVALUADOR (03:30). Cierra el dia anterior y persiste, por variante
--     y por tolerancia (±10/±15/±25), cuanto acerto, con que sesgo, y si
--     le gano al Despacho y al motor. Queda una serie historica por
--     variante en vez de recalcular todo cada vez que alguien abre la
--     card.
--
--  2. OPTIMIZADOR (04:00). Con el simulador puro NO hay que esperar dias
--     para probar una idea: barre el espacio de perillas sobre la
--     historia capturada y propone las mejores combinaciones como
--     variantes nuevas del catalogo (origen AUTO). Usa descenso por
--     coordenadas -- eje por eje y despues el combo de los mejores --
--     que con ~30 evaluaciones cubre lo que una grilla completa
--     necesitaria miles.
--
--  3. INFORME. El resumen legible del dia: quien gana, por cuanto, que
--     se propuso y que falta para promover.
--
-- ─── La regla que evita engañarse sola ───────────────────────────────
-- WALK-FORWARD. El optimizador ELIGE mirando [hasta-N, hasta-1] y
-- VALIDA en [hasta], un dia que no vio. Sin eso, con suficientes
-- combinaciones siempre aparece una que le gana al Despacho por
-- casualidad -- y la estariamos promoviendo por ruido. Se persisten las
-- dos metricas (entrenamiento y validacion) para que la diferencia
-- quede a la vista.
--
-- Y el limite de todo esto, dicho de frente: el laboratorio asume que
-- publicar otra demora NO habria cambiado la operacion. Hoy vale,
-- porque la grilla del Despacho es manual y nadie rutea mirando el
-- numero del motor. El dia que la operacion decida con lo que publica
-- el motor, estas simulaciones dejan de ser contrafacticos limpios.
-- =====================================================================

-- ─── 1. Los resultados por dia ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS demoras_variantes_resultados (
  fecha           date     NOT NULL,
  escenario       integer  NOT NULL,
  variante_id     smallint NOT NULL REFERENCES demoras_variantes(id),
  tolerancia      smallint NOT NULL,
  n               integer  NOT NULL,
  le_tol          numeric,
  sesgo           numeric,
  p80             numeric,
  despacho_le_tol numeric,
  motor_le_tol    numeric,
  calculado_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, escenario, variante_id, tolerancia)
);

COMMENT ON TABLE demoras_variantes_resultados IS
  'La serie historica del laboratorio: que acerto cada variante cada dia, en cada tolerancia, contra el Despacho y contra el motor real. La escribe el job demoras-lab-evaluador.';

-- ─── 2. Evaluar CUALQUIER parametria sobre un rango ──────────────────
-- Simula los dias pedidos con esas perillas y cruza contra las entregas
-- reales. Es la funcion que usa el optimizador para puntuar una idea sin
-- necesidad de darla de alta ni de esperar a mañana.
--
-- Nota sobre que se lee: `pedidos` aparece aca, pero para las ENTREGAS
-- REALES (fch_hora_finalizacion), que son historicas e inmutables. No es
-- el estado volatil que obligo a construir la caja negra.
CREATE OR REPLACE FUNCTION demoras_evaluar_perillas(
  p_escenario integer, p_desde date, p_hasta date, p_perillas jsonb,
  p_tolerancia numeric DEFAULT 25, p_tipo text DEFAULT 'URGENTE')
RETURNS TABLE(n integer, le_tol numeric, sesgo numeric, p80 numeric, despacho_le_tol numeric)
LANGUAGE plpgsql
-- VOLATILE (no STABLE): crea una tabla temporal para materializar la
-- simulacion antes de cruzarla. No modifica nada persistente.
AS $function$
DECLARE d date;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _sim_tmp (
    corrida_at timestamptz, zona_id integer, tipo_servicio text, informada integer
  ) ON COMMIT DROP;
  TRUNCATE _sim_tmp;

  d := p_desde;
  WHILE d <= p_hasta LOOP
    INSERT INTO _sim_tmp
    SELECT s.corrida_at, s.zona_id, s.tipo_servicio, s.demora_informada
    FROM demoras_simular_dia(d, p_escenario, p_perillas) s;
    d := d + 1;
  END LOOP;

  CREATE INDEX IF NOT EXISTS _sim_tmp_idx ON _sim_tmp (zona_id, tipo_servicio, corrida_at DESC);

  RETURN QUERY
  WITH ent AS (
    SELECT EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0 AS real_min,
           CASE WHEN p2.demora_informada > 0
                THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                     - p2.demora_informada END AS d_desp,
           sm.informada AS promesa
    FROM pedidos p2
    LEFT JOIN LATERAL (
      SELECT t.informada FROM _sim_tmp t
      WHERE t.zona_id = p2.zona_nro AND t.tipo_servicio = upper(trim(p2.servicio_nombre))
        AND t.corrida_at <= p2.fch_hora_para
        AND t.corrida_at >= ((p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date::timestamp
                             AT TIME ZONE 'America/Montevideo')
      ORDER BY t.corrida_at DESC LIMIT 1
    ) sm ON true
    WHERE p2.escenario = p_escenario
      AND p2.estado_nro = 2 AND p2.sub_estado_nro = 3
      AND coalesce(p2.orden_cancelacion, 'N') <> 'S'
      AND upper(trim(p2.servicio_nombre)) = p_tipo
      AND p2.fch_hora_para >= (p_desde::timestamp AT TIME ZONE 'America/Montevideo')
      AND p2.fch_hora_para <  ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Montevideo')
      AND p2.fch_hora_finalizacion IS NOT NULL
      AND NOT (coalesce(p2.fch_hora_asignado, p2.fch_hora_para)
               + interval '60 minutes' < p2.fch_hora_para)
  ),
  c AS (SELECT real_min - promesa AS d_var, d_desp FROM ent WHERE promesa IS NOT NULL AND d_desp IS NOT NULL)
  SELECT count(*)::integer,
         round(100.0 * count(*) FILTER (WHERE abs(d_var) <= p_tolerancia) / nullif(count(*), 0), 2),
         round(avg(d_var)::numeric, 2),
         round(percentile_cont(0.8) WITHIN GROUP (ORDER BY abs(d_var))::numeric, 2),
         round(100.0 * count(*) FILTER (WHERE abs(d_desp) <= p_tolerancia) / nullif(count(*), 0), 2)
  FROM c;
END;
$function$;

COMMENT ON FUNCTION demoras_evaluar_perillas(integer, date, date, jsonb, numeric, text) IS
  'Simula un rango de dias con una parametria arbitraria y lo cruza contra las entregas reales. Es como se puntua una idea SIN darla de alta ni esperar a mañana: la usa el optimizador.';

-- ─── 3. El evaluador nocturno ────────────────────────────────────────
CREATE OR REPLACE FUNCTION demoras_variantes_evaluar(p_fecha date, p_escenario integer)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_n     integer := 0;
  v_paso  integer;
  t       integer;
BEGIN
  FOREACH t IN ARRAY ARRAY[10, 15, 25] LOOP
    INSERT INTO demoras_variantes_resultados (
      fecha, escenario, variante_id, tolerancia, n, le_tol, sesgo, p80,
      despacho_le_tol, motor_le_tol, calculado_at)
    SELECT p_fecha, p_escenario, v.variante_id, t, v.n, v.le_tol, v.sesgo, v.p80,
           v.despacho_le_tol, mot.motor_le_tol, now()
    FROM (
      SELECT dv.variante_id,
             count(*)::integer AS n,
             round(100.0 * count(*) FILTER (WHERE abs(e.real_min - dv.demora_informada) <= t)
                   / nullif(count(*), 0), 2) AS le_tol,
             round(avg(e.real_min - dv.demora_informada)::numeric, 2) AS sesgo,
             round(percentile_cont(0.8) WITHIN GROUP (
                     ORDER BY abs(e.real_min - dv.demora_informada))::numeric, 2) AS p80,
             round(100.0 * count(*) FILTER (WHERE abs(e.d_desp) <= t) / nullif(count(*), 0), 2) AS despacho_le_tol
      FROM (
        SELECT p2.zona_nro AS zona, upper(trim(p2.servicio_nombre)) AS tipo,
               EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0 AS real_min,
               CASE WHEN p2.demora_informada > 0
                    THEN EXTRACT(EPOCH FROM (p2.fch_hora_finalizacion - p2.fch_hora_para)) / 60.0
                         - p2.demora_informada END AS d_desp,
               mc.corrida_at
        FROM pedidos p2
        LEFT JOIN LATERAL (
          SELECT dc.corrida_at FROM demoras_calculadas dc
          WHERE dc.escenario = p_escenario AND dc.zona_id = p2.zona_nro
            AND dc.tipo_servicio = upper(trim(p2.servicio_nombre))
            AND dc.corrida_at <= p2.fch_hora_para
            AND dc.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
          ORDER BY dc.corrida_at DESC LIMIT 1
        ) mc ON true
        WHERE p2.escenario = p_escenario AND p2.estado_nro = 2 AND p2.sub_estado_nro = 3
          AND coalesce(p2.orden_cancelacion, 'N') <> 'S'
          AND upper(trim(p2.servicio_nombre)) IN ('URGENTE','NOCTURNO')
          AND (p2.fch_hora_para AT TIME ZONE 'America/Montevideo')::date = p_fecha
          AND p2.fch_hora_finalizacion IS NOT NULL
          AND NOT (coalesce(p2.fch_hora_asignado, p2.fch_hora_para)
                   + interval '60 minutes' < p2.fch_hora_para)
      ) e
      JOIN demoras_calculadas_variantes dv
        ON dv.escenario = p_escenario AND dv.corrida_at = e.corrida_at
       AND dv.zona_id = e.zona AND dv.tipo_servicio = e.tipo
      WHERE e.d_desp IS NOT NULL AND dv.demora_informada IS NOT NULL
      GROUP BY dv.variante_id
    ) v
    CROSS JOIN LATERAL (
      SELECT round(100.0 * count(*) FILTER (WHERE abs(x.d_mot) <= t) / nullif(count(*), 0), 2) AS motor_le_tol
      FROM (
        SELECT EXTRACT(EPOCH FROM (p3.fch_hora_finalizacion - p3.fch_hora_para)) / 60.0
               - mm.demora_informada AS d_mot
        FROM pedidos p3
        LEFT JOIN LATERAL (
          SELECT dc.demora_informada FROM demoras_calculadas dc
          WHERE dc.escenario = p_escenario AND dc.zona_id = p3.zona_nro
            AND dc.tipo_servicio = upper(trim(p3.servicio_nombre))
            AND dc.corrida_at <= p3.fch_hora_para
            AND dc.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
          ORDER BY dc.corrida_at DESC LIMIT 1
        ) mm ON true
        WHERE p3.escenario = p_escenario AND p3.estado_nro = 2 AND p3.sub_estado_nro = 3
          AND coalesce(p3.orden_cancelacion, 'N') <> 'S'
          AND upper(trim(p3.servicio_nombre)) IN ('URGENTE','NOCTURNO')
          AND (p3.fch_hora_para AT TIME ZONE 'America/Montevideo')::date = p_fecha
          AND p3.fch_hora_finalizacion IS NOT NULL
          AND p3.demora_informada > 0
          AND mm.demora_informada IS NOT NULL
          AND NOT (coalesce(p3.fch_hora_asignado, p3.fch_hora_para)
                   + interval '60 minutes' < p3.fch_hora_para)
      ) x
    ) mot
    ON CONFLICT (fecha, escenario, variante_id, tolerancia) DO UPDATE SET
      n = EXCLUDED.n, le_tol = EXCLUDED.le_tol, sesgo = EXCLUDED.sesgo, p80 = EXCLUDED.p80,
      despacho_le_tol = EXCLUDED.despacho_le_tol, motor_le_tol = EXCLUDED.motor_le_tol,
      calculado_at = EXCLUDED.calculado_at;

    -- OJO: en una variable propia. Reusar `t` (la tolerancia) para el
    -- ROW_COUNT rompia el FOREACH en silencio.
    GET DIAGNOSTICS v_paso = ROW_COUNT;
    v_n := v_n + v_paso;
  END LOOP;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION demoras_variantes_evaluar(date, integer) IS
  'Cierra un dia: persiste en demoras_variantes_resultados cuanto acerto cada variante en cada tolerancia, con su sesgo y p80, contra el Despacho y contra el motor real.';

-- ─── 4. El optimizador ───────────────────────────────────────────────
-- Descenso por coordenadas: prueba cada perilla por separado sobre la
-- ventana de entrenamiento, se queda con el mejor valor de cada una, y
-- despues prueba el combo de todas juntas. Es la busqueda que mas
-- terreno cubre por evaluacion cuando los ejes son casi independientes
-- -- que es el caso aca (el factor escala, el escalon redondea, el piso
-- acota).
--
-- Lo que propone entra al catalogo como variante nueva con origen AUTO.
-- NO promueve nada al motor: eso lo decide la regla de promocion (7 dias
-- medidos, 5 ganados, 1,5 puntos) y una persona.
CREATE TABLE IF NOT EXISTS demoras_variantes_propuestas (
  id            bigserial PRIMARY KEY,
  escenario     integer     NOT NULL,
  creada_at     timestamptz NOT NULL DEFAULT now(),
  perillas      jsonb       NOT NULL,
  huella        text        NOT NULL,   -- para no proponer dos veces lo mismo
  train_desde   date, train_hasta date,
  train_le_tol  numeric, train_n integer,
  valida_fecha  date,
  valida_le_tol numeric, valida_n integer,
  despacho_le_tol numeric,
  variante_id   smallint REFERENCES demoras_variantes(id),
  nota          text,
  UNIQUE (escenario, huella)
);

COMMENT ON TABLE demoras_variantes_propuestas IS
  'Lo que el optimizador encontro cada noche: la combinacion, como le fue en entrenamiento y como le fue en el dia de validacion que NO vio. La huella evita proponer dos veces lo mismo.';

CREATE OR REPLACE FUNCTION demoras_variantes_optimizar(
  p_escenario integer, p_dias integer DEFAULT 7, p_tolerancia numeric DEFAULT 25)
RETURNS TABLE(propuestas integer, evaluaciones integer, mejor jsonb)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_hasta   date;
  v_train_h date;
  v_train_d date;
  base      jsonb;
  mejor_p   jsonb;
  cand      jsonb;
  eje       record;
  val       jsonb;
  m         record;
  best_le   numeric;
  base_le   numeric;
  v_eval    integer := 0;
  v_prop    integer := 0;
  v_huella  text;
  v_var     smallint;
  v_nuevo   smallint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(2180637409::bigint) THEN
    RETURN;
  END IF;

  -- Validacion = el ultimo dia con datos; entrenamiento = los previos.
  SELECT max(fecha_local) INTO v_hasta FROM demoras_corrida_meta WHERE escenario = p_escenario;
  IF v_hasta IS NULL THEN RETURN; END IF;
  v_train_h := v_hasta - 1;
  v_train_d := GREATEST(v_train_h - (p_dias - 1),
                        (SELECT min(fecha_local) FROM demoras_corrida_meta WHERE escenario = p_escenario));
  IF v_train_d > v_train_h THEN RETURN; END IF;

  -- El punto de partida es el campeon (la parametria vigente).
  base := '{}'::jsonb;
  SELECT le_tol INTO base_le
    FROM demoras_evaluar_perillas(p_escenario, v_train_d, v_train_h, base, p_tolerancia);
  v_eval := v_eval + 1;
  mejor_p := base;

  -- Un eje por vez. Las grillas cubren el rango razonable de cada
  -- perilla; los extremos estan puestos a proposito para que el
  -- optimizador pueda decir "por aca no".
  FOR eje IN
    SELECT * FROM (VALUES
      ('factor_calibracion', ARRAY['0.70','0.75','0.80','0.85','0.90','0.95','1.00','1.05']),
      ('escalon_minutos',    ARRAY['5','10','15']),
      ('min_minutos',        ARRAY['15','20','25','30','35']),
      ('subida_max',         ARRAY['10','15','30','45']),
      ('estadistico',        ARRAY['"MEDIANA"','"MEDIA"','"P75"','"P90"']),
      ('nivel_ritmo',        ARRAY['"CASCADA"','"ZONA"','"MOVIL"'])
    ) AS t(perilla, valores)
  LOOP
    best_le := base_le;
    FOREACH v_huella IN ARRAY eje.valores LOOP
      cand := base || jsonb_build_object(eje.perilla, v_huella::jsonb);
      -- subida y bajada se mueven juntas: es "la escalera", no dos.
      IF eje.perilla = 'subida_max' THEN
        cand := cand || jsonb_build_object('bajada_max', v_huella::jsonb);
      END IF;

      SELECT * INTO m FROM demoras_evaluar_perillas(
        p_escenario, v_train_d, v_train_h, cand, p_tolerancia);
      v_eval := v_eval + 1;

      IF m.le_tol IS NOT NULL AND m.le_tol > coalesce(best_le, -1) THEN
        best_le := m.le_tol;
        mejor_p := mejor_p || (cand - ARRAY(SELECT jsonb_object_keys(base)));
      END IF;
    END LOOP;
  END LOOP;

  -- El combo de los mejores ejes, que puede ser mejor (o peor: los ejes
  -- no son del todo independientes) que cada uno por separado.
  FOR cand IN SELECT unnest(ARRAY[mejor_p]) LOOP
    v_huella := md5(cand::text);
    CONTINUE WHEN EXISTS (SELECT 1 FROM demoras_variantes_propuestas
                           WHERE escenario = p_escenario AND huella = v_huella);
    CONTINUE WHEN cand = '{}'::jsonb;

    -- Entrenamiento y VALIDACION en el dia que no vio.
    SELECT * INTO m FROM demoras_evaluar_perillas(
      p_escenario, v_train_d, v_train_h, cand, p_tolerancia);
    v_eval := v_eval + 1;

    INSERT INTO demoras_variantes_propuestas (
      escenario, perillas, huella, train_desde, train_hasta, train_le_tol, train_n)
    VALUES (p_escenario, cand, v_huella, v_train_d, v_train_h, m.le_tol, m.n)
    RETURNING id INTO v_var;

    SELECT * INTO m FROM demoras_evaluar_perillas(
      p_escenario, v_hasta, v_hasta, cand, p_tolerancia);
    v_eval := v_eval + 1;

    UPDATE demoras_variantes_propuestas
       SET valida_fecha = v_hasta, valida_le_tol = m.le_tol, valida_n = m.n,
           despacho_le_tol = m.despacho_le_tol
     WHERE id = v_var;

    -- Solo entra al catalogo si TAMBIEN gano en el dia de validacion.
    IF m.le_tol IS NOT NULL AND m.despacho_le_tol IS NOT NULL
       AND m.le_tol > m.despacho_le_tol THEN
      SELECT coalesce(max(id), 0) + 1 INTO v_nuevo FROM demoras_variantes;
      INSERT INTO demoras_variantes (
        id, codigo, nombre, descripcion, estadistico, nivel_ritmo, factor,
        escalon_minutos, suavizado, suavizado_paso, min_minutos, activa)
      VALUES (
        v_nuevo, 'AUTO_' || v_nuevo,
        'Propuesta automática #' || v_nuevo,
        'La encontró el optimizador el ' || v_hasta || ' buscando sobre los días '
          || v_train_d || ' a ' || v_train_h || '. En entrenamiento y en el día de validación '
          || '(que no vio) le ganó al Despacho. Todavía tiene que cumplir la regla de promoción.',
        cand->>'estadistico', cand->>'nivel_ritmo',
        (cand->>'factor_calibracion')::numeric, (cand->>'escalon_minutos')::smallint,
        coalesce((cand->>'suavizado')::boolean, true),
        (cand->>'subida_max')::smallint, (cand->>'min_minutos')::smallint, true);

      UPDATE demoras_variantes_propuestas SET variante_id = v_nuevo WHERE id = v_var;
      v_prop := v_prop + 1;
    END IF;
  END LOOP;

  propuestas   := v_prop;
  evaluaciones := v_eval;
  mejor        := mejor_p;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION demoras_variantes_optimizar(integer, integer, numeric) IS
  'Busca mejores combinaciones por descenso por coordenadas sobre la historia capturada, valida en un dia que NO uso para elegir (walk-forward) y solo entonces da de alta la propuesta en el catalogo. Nunca promueve al motor: eso lo decide la regla de promocion y una persona.';

-- ─── 5. Los jobs del ciclo ───────────────────────────────────────────
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- 03:30 Montevideo: cerrar el dia anterior.
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-lab-evaluador';
    PERFORM cron.schedule(
      'demoras-lab-evaluador', '30 6 * * *',
      $job$SELECT demoras_variantes_evaluar((now() AT TIME ZONE 'America/Montevideo')::date - 1, escenario_id) FROM demoras_modelo$job$
    );

    -- 04:00 Montevideo: buscar y proponer.
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-lab-optimizador';
    PERFORM cron.schedule(
      'demoras-lab-optimizador', '0 7 * * *',
      $job$SELECT demoras_variantes_optimizar(escenario_id, 7, 25) FROM demoras_modelo$job$
    );
  END IF;
END
$do$;
