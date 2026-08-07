-- =====================================================================
-- EL SIMULADOR PURO: recalcular cualquier corrida, con cualquier
-- parametria, leyendo SOLO de la caja negra
-- Fecha: 2026-08-07 | Idempotente
--
-- Es la pieza central de todo lo que sigue (reproceso desde la pantalla,
-- evaluador nocturno, optimizador). "Puro" significa exactamente esto:
-- NO consulta ni una sola tabla viva (pedidos, services, moviles_dia,
-- moviles_zonas, metricas_cumplimiento). Solo lee:
--   demoras_corrida_meta / _movil / _pedido / _ritmo / _chofer
--   demoras_calculadas   (los agregados exactos que escribio el motor)
--
-- Consecuencia: se puede correr sobre cualquier dia capturado, cuantas
-- veces se quiera, sin depender de que el mundo siga como estaba.
--
-- ─── El contrato de fidelidad ────────────────────────────────────────
-- Simular con la parametria original TIENE que reproducir lo que el
-- motor publico, fila por fila. Ese es el unico control que importa y
-- se verifica en prod (demoras_simular_control) y en el harness.
--
-- MEDIDO el 7/8 sobre 27 corridas capturadas (5.397 filas): 11 filas
-- con la cruda distinta (0,2%) y 8 con la publicada distinta (0,15%).
-- Corrida a corrida, con su escalera correcta, da CERO.
--
-- El residuo tiene una causa conocida e irreducible con este diseño: el
-- trigger de captura corre en un statement POSTERIOR al del motor y, en
-- READ COMMITTED, cada statement toma un snapshot nuevo. Si un pedido
-- se entrega en esos milisegundos, `carga_fuera` de algun movil cambia
-- y la simulacion recalcula distinto. Se concentra en zonas con uno o
-- dos moviles (donde un pedido pesa mucho) y en las corridas de mayor
-- movimiento. Eliminarlo del todo exigiria que el motor mismo persista
-- los aportes que ya calculo -- o sea, modificar demoras_consumo_tramos
-- y demoras_calcular_run, que es justo lo que este diseño evita. No
-- vale la pena por 0,2%.
--
-- ─── De donde sale cada cosa ─────────────────────────────────────────
--  * Aportes por movil: de demoras_corrida_movil. dedicacion y
--    carga_fuera son invariantes al ritmo; ritmo/libera_en/capacidad se
--    RECALCULAN si la variante cambia el ritmo, y si no se usan tal cual.
--  * Ritmo alternativo: cascada armada sobre demoras_corrida_ritmo
--    (niveles crudos) + demoras_corrida_chofer.
--  * Cola: los TOTALES salen de demoras_calculadas (exactos, los conto
--    el motor en el instante justo); el detalle de
--    demoras_corrida_pedido se usa solo para repartir el progreso entre
--    los asignados. Asi el residuo de la captura (~10 s de desfase) no
--    se propaga a los totales.
--  * Fases del arranque: de demoras_calculadas (arranque_fase,
--    demora_cruda, ritmo_usado). No dependen de las perillas del
--    laboratorio; cuando se agreguen variantes de arranque habra que
--    extender esto.
--  * Parametria: demoras_corrida_meta.modelo, con las perillas de la
--    variante encima (merge jsonb).
--
-- Perillas reconocidas en p_perillas (todas opcionales; lo que no venga
-- se toma del modelo de esa corrida):
--   estadistico, nivel_ritmo ('CASCADA'|'ZONA'|'MOVIL'|'GLOBAL'),
--   factor_calibracion, escalon_minutos, min_minutos, max_minutos,
--   subida_max, bajada_max, suavizado (bool), asignados_modo,
--   peso_asignados, atrapados_modo
-- =====================================================================

-- ─── 1. El ritmo de cada movil bajo una parametria alternativa ───────
-- Arma la cascada desde los niveles CRUDOS persistidos. p_nivel:
--   CASCADA -> CHOFER, MOVIL, ZONA, GLOBAL (el orden del motor)
--   ZONA    -> ZONA, GLOBAL   (ignora la personalizacion por movil/chofer)
--   MOVIL   -> MOVIL, ZONA, GLOBAL
--   GLOBAL  -> solo GLOBAL
-- Respeta ritmo_min_muestras igual que la cascada real: un nivel solo
-- gana si llega al minimo.
CREATE OR REPLACE FUNCTION demoras_simular_ritmo(
  p_fecha date, p_escenario integer, p_estadistico text, p_nivel text, p_min_muestras integer)
RETURNS TABLE(movil integer, zona_id integer, tipo_servicio text, ritmo numeric, origen text)
LANGUAGE sql
STABLE
AS $function$
  WITH universo AS (
    -- Los pares (movil, zona, tipo) que existieron ese dia.
    SELECT DISTINCT m.movil AS mv, m.zona_id AS z, m.tipo_servicio AS t
    FROM demoras_corrida_movil m
    WHERE m.escenario = p_escenario
      AND m.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
      AND m.corrida_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/Montevideo')
  ),
  niveles AS (
    SELECT r.nivel, r.clave, r.tipo_servicio AS t, r.muestras,
           CASE p_estadistico
             WHEN 'MEDIA' THEN r.media
             WHEN 'P75'   THEN r.p75
             WHEN 'P90'   THEN r.p90
             ELSE r.mediana
           END AS valor
    FROM demoras_corrida_ritmo r
    WHERE r.fecha = p_fecha AND r.escenario = p_escenario
  ),
  chof AS (
    SELECT c.movil AS mv, c.tipo_servicio AS t, c.chofer
    FROM demoras_corrida_chofer c
    WHERE c.fecha = p_fecha AND c.escenario = p_escenario
  ),
  -- Los candidatos de cada (movil, zona, tipo), en el orden del nivel
  -- pedido. ord bajo = se prefiere.
  cand AS (
    SELECT u.mv, u.z, u.t, x.ord, x.nivel, n.valor, coalesce(n.muestras, 0) AS muestras
    FROM universo u
    LEFT JOIN chof ch ON ch.mv = u.mv AND ch.t = u.t
    CROSS JOIN LATERAL (
      VALUES ('CHOFER', ch.chofer, 1), ('MOVIL', u.mv::text, 2),
             ('ZONA', u.z::text, 3),   ('GLOBAL', '', 4)
    ) AS x(nivel, clave, ord)
    LEFT JOIN niveles n ON n.nivel = x.nivel AND n.clave = x.clave AND n.t = u.t
    WHERE x.clave IS NOT NULL
      AND CASE p_nivel
            WHEN 'ZONA'   THEN x.nivel IN ('ZONA', 'GLOBAL')
            WHEN 'MOVIL'  THEN x.nivel IN ('MOVIL', 'ZONA', 'GLOBAL')
            WHEN 'GLOBAL' THEN x.nivel = 'GLOBAL'
            ELSE true
          END
  )
  SELECT DISTINCT ON (c.mv, c.z, c.t) c.mv, c.z, c.t, c.valor, c.nivel
  FROM cand c
  WHERE c.valor IS NOT NULL
  ORDER BY c.mv, c.z, c.t,
           (c.muestras >= p_min_muestras) DESC,
           CASE WHEN c.muestras >= p_min_muestras THEN c.ord ELSE -c.ord END ASC;
$function$;

COMMENT ON FUNCTION demoras_simular_ritmo(date, integer, text, text, integer) IS
  'El ritmo de cada movil bajo un estadistico y un nivel de cascada alternativos, armado sobre los niveles CRUDOS de la caja negra (demoras_corrida_ritmo + _chofer). No toca metricas_cumplimiento.';

-- ─── 2. La simulacion de UNA corrida ─────────────────────────────────
CREATE OR REPLACE FUNCTION demoras_simular_corrida(
  p_corrida_at timestamptz, p_escenario integer, p_perillas jsonb DEFAULT '{}'::jsonb,
  p_prev jsonb DEFAULT NULL)
RETURNS TABLE(zona_id integer, tipo_servicio text, demora_cruda numeric,
              demora_suavizada numeric, demora_informada integer)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  meta      demoras_corrida_meta%ROWTYPE;
  cfg       jsonb;
  v_fecha   date;
  -- perillas efectivas
  v_est     text;    v_nivel   text;    v_factor  numeric;
  v_escalon integer; v_min     integer; v_max     integer;
  v_subida  integer; v_bajada  integer; v_suav    boolean;
  v_amodo   text;    v_peso    numeric; v_atrap   text;
  v_minmue  integer; v_traslado numeric; v_rdef   numeric;
  v_recalc  boolean; v_recalc_cola boolean;
  z         record;
  v_q numeric; v_t numeric; v_mu numeric; v_proc numeric; v_i integer;
  v_listo boolean; v_cruda numeric; v_prevv numeric; v_acab record;
BEGIN
  SELECT * INTO meta FROM demoras_corrida_meta
   WHERE corrida_at = p_corrida_at AND escenario = p_escenario;
  IF NOT FOUND THEN RETURN; END IF;

  v_fecha := meta.fecha_local;
  cfg := meta.modelo || coalesce(p_perillas, '{}'::jsonb);

  v_est      := coalesce(cfg->>'estadistico', 'MEDIANA');
  v_nivel    := coalesce(cfg->>'nivel_ritmo', 'CASCADA');
  v_factor   := coalesce((cfg->>'factor_calibracion')::numeric, 1.0);
  v_escalon  := coalesce((cfg->>'escalon_minutos')::integer, 15);
  v_min      := coalesce((cfg->>'min_minutos')::integer, 30);
  v_max      := coalesce((cfg->>'max_minutos')::integer, 120);
  v_subida   := coalesce((cfg->>'subida_max')::integer, 15);
  v_bajada   := coalesce((cfg->>'bajada_max')::integer, 15);
  v_suav     := coalesce((cfg->>'suavizado')::boolean, true);
  v_amodo    := coalesce(cfg->>'asignados_modo', 'COMPLETO');
  v_peso     := coalesce((cfg->>'peso_asignados')::numeric, 0.5);
  v_atrap    := coalesce(cfg->>'atrapados_modo', 'EXCLUIR');
  v_minmue   := coalesce((cfg->>'ritmo_min_muestras')::integer, 5);
  v_traslado := coalesce((cfg->>'traslado_fuera_zona_minutos')::numeric, 15);
  v_rdef     := coalesce((cfg->>'ritmo_default_minutos')::numeric, 30);

  -- Solo se recalcula el ritmo (y con el r_j y mu_j) si la variante
  -- cambia el estadistico o el nivel; si no, se usan los valores que
  -- quedaron capturados -- que es lo que garantiza el espejo exacto.
  v_recalc := (v_est   IS DISTINCT FROM coalesce(meta.modelo->>'estadistico', 'MEDIANA'))
           OR (v_nivel IS DISTINCT FROM 'CASCADA');

  -- Idem con la cola: si la variante no toca sus perillas, se usa el
  -- valor EXACTO que conto el motor (demoras_calculadas.cola_por_delante)
  -- en vez de reconstruirlo del detalle. Es lo que hace que el residuo
  -- de la captura no toque nada mientras no se experimente con la cola.
  v_recalc_cola := (v_amodo IS DISTINCT FROM coalesce(meta.modelo->>'asignados_modo', 'COMPLETO'))
                OR (v_atrap IS DISTINCT FROM coalesce(meta.modelo->>'atrapados_modo', 'EXCLUIR'))
                OR (v_amodo = 'PESO'
                    AND v_peso IS DISTINCT FROM coalesce((meta.modelo->>'peso_asignados')::numeric, 0.5))
                OR v_recalc;  -- PROGRESO se mide contra el ritmo: si cambia, cambia

  FOR z IN
    WITH
    -- El ritmo alternativo, si hace falta.
    rit AS (
      SELECT s.movil AS mv, s.zona_id AS z, s.tipo_servicio AS t, s.ritmo
      FROM (SELECT 1 WHERE v_recalc) g
      CROSS JOIN LATERAL demoras_simular_ritmo(v_fecha, p_escenario, v_est, v_nivel, v_minmue) s
    ),
    -- Los aportes de la corrida, con el ritmo (y por lo tanto r_j y
    -- mu_j) que corresponda a esta parametria.
    ap AS (
      SELECT m.zona_id AS z, m.tipo_servicio AS t, m.movil AS mv,
             coalesce(r.ritmo, m.ritmo, v_rdef) AS ritmo_eff,
             m.dedicacion, m.carga_fuera,
             CASE WHEN NOT v_recalc THEN m.libera_en
                  WHEN coalesce(m.carga_fuera, 0) = 0 THEN 0
                  ELSE round(m.carga_fuera * coalesce(r.ritmo, m.ritmo, v_rdef) + v_traslado, 2)
             END AS r_j,
             CASE WHEN NOT v_recalc THEN m.capacidad
                  WHEN coalesce(r.ritmo, m.ritmo, v_rdef) > 0
                    THEN round(m.dedicacion / coalesce(r.ritmo, m.ritmo, v_rdef), 6)
                  ELSE 0
             END AS mu_j
      FROM demoras_corrida_movil m
      LEFT JOIN rit r ON r.mv = m.movil AND r.z = m.zona_id AND r.t = m.tipo_servicio
      WHERE m.escenario = p_escenario AND m.corrida_at = p_corrida_at
    ),
    ini AS (SELECT ap.z, ap.t, sum(ap.mu_j) AS mu FROM ap WHERE ap.r_j <= 0 GROUP BY ap.z, ap.t),
    ev AS (
      SELECT g.z, g.t, array_agg(g.r ORDER BY g.r) AS rs, array_agg(g.mu ORDER BY g.r) AS mus
      FROM (SELECT ap.z, ap.t, ap.r_j AS r, sum(ap.mu_j) AS mu
            FROM ap WHERE ap.r_j > 0 GROUP BY ap.z, ap.t, ap.r_j) g
      GROUP BY g.z, g.t
    ),
    -- La cola. Los TOTALES vienen del motor (exactos); el detalle solo
    -- reparte el progreso de los asignados activos.
    prog AS (
      SELECT b.zona_id AS z, b.tipo_servicio AS t,
             sum(CASE v_amodo
                   WHEN 'PESO' THEN v_peso
                   WHEN 'PROGRESO' THEN
                     CASE WHEN p.minutos_desde_asignacion IS NULL THEN 1
                          ELSE LEAST(1, GREATEST(0, 1 - p.minutos_desde_asignacion
                                                     / NULLIF(b.ritmo_usado, 0)))
                     END
                   ELSE 1
                 END) AS equivalentes,
             count(*) AS n_detalle
      FROM demoras_calculadas b
      JOIN demoras_corrida_pedido p
        ON p.escenario = b.escenario AND p.corrida_at = b.corrida_at
       AND p.zona_id = b.zona_id
       AND ((b.tipo_servicio IN ('URGENTE','NOCTURNO') AND p.tipo_pedido IN ('URGENTE','NOCTURNO'))
            OR (b.tipo_servicio = 'SERVICE' AND p.tipo_pedido = 'SERVICE'))
       AND p.es_asignado AND p.movil_activo
      WHERE b.escenario = p_escenario AND b.corrida_at = p_corrida_at
      GROUP BY b.zona_id, b.tipo_servicio
    ),
    -- El ritmo PURO de zona, solo si la variante pide nivel ZONA.
    zrit AS (
      SELECT r.clave, r.tipo_servicio AS t,
             CASE v_est WHEN 'MEDIA' THEN r.media WHEN 'P75' THEN r.p75
                        WHEN 'P90'  THEN r.p90    ELSE r.mediana END AS valor
      FROM demoras_corrida_ritmo r
      WHERE r.fecha = v_fecha AND r.escenario = p_escenario AND r.nivel = 'ZONA'
        AND v_nivel = 'ZONA'
    )
    SELECT b.zona_id AS zid, b.tipo_servicio AS tsrv,
           b.arranque_fase, b.demora_cruda AS cruda_motor, b.ritmo_usado AS ritmo_motor,
           b.moviles_activos, b.demora_as400,
           pm.prev_mov, pm.prev_fase,
           b.pendientes_asignados, b.pendientes_sin_asignar, b.pendientes_atrapados,
           coalesce(ini.mu, 0) AS mu_inicial,
           coalesce(ev.rs,  ARRAY[]::numeric[]) AS rs,
           coalesce(ev.mus, ARRAY[]::numeric[]) AS mus,
           -- La cola. Si la variante no toca sus perillas, el valor
           -- EXACTO del motor; si las toca, se reconstruye del detalle
           -- (los asignados activos que el detalle no cubra -- residuo
           -- de la captura -- se completan con 1 cada uno).
           CASE WHEN NOT v_recalc_cola THEN coalesce(b.cola_por_delante, 0)
                ELSE (b.pendientes_sin_asignar
                      + coalesce(pr.equivalentes, 0)
                      + GREATEST(0, (b.pendientes_asignados - b.pendientes_atrapados)
                                    - coalesce(pr.n_detalle, 0))
                      + CASE v_atrap WHEN 'EXCLUIR' THEN 0 ELSE b.pendientes_atrapados END)::numeric
           END AS cola,
           -- El ritmo que ESTA parametria le asigna a la ZONA (lo usan
           -- las ramas del arranque). Sale de las estadisticas de zona
           -- que el motor ya persistio -- NO del promedio de los
           -- aportes, que es otra cosa (ese pondera moviles y da un
           -- numero distinto del que resuelve la cascada de zona).
           CASE WHEN NOT v_recalc THEN b.ritmo_usado
                WHEN v_nivel = 'ZONA' THEN coalesce(zr.valor, b.ritmo_usado)
                ELSE coalesce(CASE v_est WHEN 'MEDIA' THEN b.ritmo_media
                                         WHEN 'P75'   THEN b.ritmo_p75
                                         WHEN 'P90'   THEN b.ritmo_p90
                                         ELSE b.ritmo_mediana END, b.ritmo_usado)
           END AS ritmo_zona
    FROM demoras_calculadas b
    LEFT JOIN ini ON ini.z = b.zona_id AND ini.t = b.tipo_servicio
    LEFT JOIN ev  ON ev.z  = b.zona_id AND ev.t  = b.tipo_servicio
    LEFT JOIN prog pr ON pr.z = b.zona_id AND pr.t = b.tipo_servicio
    LEFT JOIN zrit zr ON zr.clave = b.zona_id::text AND zr.t = b.tipo_servicio
    -- El estado de la zona en la corrida ANTERIOR del motor: lo necesita
    -- el bypass del suavizado (ver el acabado mas abajo).
    LEFT JOIN LATERAL (
      SELECT p2.moviles_activos AS prev_mov, p2.arranque_fase AS prev_fase
      FROM demoras_calculadas p2
      WHERE p2.escenario = p_escenario AND p2.zona_id = b.zona_id
        AND p2.tipo_servicio = b.tipo_servicio
        AND p2.corrida_at >= (v_fecha::timestamp AT TIME ZONE 'America/Montevideo')
        AND p2.corrida_at < p_corrida_at
      ORDER BY p2.corrida_at DESC LIMIT 1
    ) pm ON true
    WHERE b.escenario = p_escenario AND b.corrida_at = p_corrida_at
  LOOP
    -- ── La cruda ──────────────────────────────────────────────────
    IF z.arranque_fase = 'PREDICTIVO' THEN
      -- Se deriva de la cruda del motor mas el delta del ritmo: exacta
      -- para toda variante que no toque el ritmo.
      v_cruda := z.cruda_motor + (z.cola + 1) * (z.ritmo_zona - z.ritmo_motor);
    ELSIF z.arranque_fase = 'GRACIA_VENCIDA' THEN
      v_cruda := z.cruda_motor;
    ELSIF z.arranque_fase IS NULL
          AND coalesce(meta.modelo->>'arranque_sin_movil_modo','TECHO')
              IN ('DESPACHO','DESPACHO_MAS_COLA','PREDICTIVO')
          AND z.moviles_activos <= 0 AND z.demora_as400 IS NOT NULL
          AND (coalesce(meta.modelo->>'arranque_sin_movil_modo','') IN ('DESPACHO_MAS_COLA','PREDICTIVO')
               OR (z.pendientes_asignados + z.pendientes_sin_asignar) = 0) THEN
      v_cruda := z.cruda_motor
                 + CASE WHEN coalesce(meta.modelo->>'arranque_sin_movil_modo','') IN ('DESPACHO_MAS_COLA','PREDICTIVO')
                        THEN z.cola * (z.ritmo_zona - z.ritmo_motor) ELSE 0 END;
    ELSE
      -- Modelo normal: la simulacion de tramos, identica a
      -- demoras_consumo_tramos pero sobre los aportes de la caja negra.
      v_q := z.cola + 1;
      v_t := 0;
      v_mu := z.mu_inicial;
      v_listo := false;

      FOR v_i IN 1 .. coalesce(array_length(z.rs, 1), 0) LOOP
        v_proc := (z.rs[v_i] - v_t) * v_mu;
        IF v_mu > 0 AND v_q <= v_proc THEN
          v_cruda := (v_t + v_q / v_mu) * v_factor;
          v_listo := true;
          EXIT;
        END IF;
        v_q  := v_q - v_proc;
        v_t  := z.rs[v_i];
        v_mu := v_mu + z.mus[v_i];
      END LOOP;

      IF NOT v_listo THEN
        IF v_mu <= 0 THEN
          v_cruda := v_max::numeric;   -- el techo NO lleva factor
        ELSE
          v_cruda := (v_t + v_q / v_mu) * v_factor;
        END IF;
      END IF;
    END IF;

    -- ── El acabado, con la escalera propia de esta simulacion ──────
    -- El BYPASS del suavizado va igual que en el motor: si cambio la
    -- cantidad de moviles activos respecto de la corrida anterior, la
    -- variacion es estructural (entro o salio un movil) y no se frena
    -- con la escalera; idem al ENTRAR en fase TRANSITO. Sin esto el
    -- simulador diverge justo en los momentos de cambio de flota -- lo
    -- encontro el control de fidelidad: 19 zonas en una sola corrida
    -- con la cruda identica y la publicada distinta.
    v_prevv := CASE
                 WHEN NOT v_suav THEN NULL
                 WHEN coalesce((cfg->>'suavizado_bypass_cambio_capacidad')::boolean, false)
                      AND z.prev_mov IS DISTINCT FROM z.moviles_activos THEN NULL
                 WHEN z.arranque_fase = 'TRANSITO'
                      AND z.prev_fase IS DISTINCT FROM 'TRANSITO' THEN NULL
                 ELSE (p_prev -> (z.zid::text || '|' || z.tsrv))::numeric
               END;

    SELECT * INTO v_acab FROM demoras_acabado(
      round(v_cruda, 2), v_prevv, v_min, v_max, v_subida, v_bajada, v_escalon);

    zona_id          := z.zid;
    tipo_servicio    := z.tsrv;
    demora_cruda     := round(v_cruda, 2);
    demora_suavizada := v_acab.suavizada;
    demora_informada := v_acab.informada;
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION demoras_simular_corrida(timestamptz, integer, jsonb, jsonb) IS
  'Recalcula una corrida completa con cualquier parametria, leyendo SOLO de la caja negra (ni una tabla viva). p_prev es el mapa "zona|tipo" -> suavizada de la corrida anterior de ESTA simulacion (la escalera propia). Ver docs/sqls/2026-08-07-simulador-puro.sql.';

-- ─── 3. Un dia entero, arrastrando la escalera ───────────────────────
-- p_prev_inicial: la escalera con la que arranca la PRIMERA corrida
-- simulada. Importa cuando el dia no esta capturado entero (por ejemplo
-- el dia en que se activo la caja negra): sin esto, la simulacion
-- arranca sin escalera mientras el motor venia arrastrandola desde la
-- manana, y el control de fidelidad marca diferencias que no son bugs.
CREATE OR REPLACE FUNCTION demoras_simular_dia(
  p_fecha date, p_escenario integer, p_perillas jsonb DEFAULT '{}'::jsonb,
  p_prev_inicial jsonb DEFAULT NULL)
RETURNS TABLE(corrida_at timestamptz, zona_id integer, tipo_servicio text,
              demora_cruda numeric, demora_suavizada numeric, demora_informada integer)
LANGUAGE plpgsql
-- VOLATILE (no STABLE): usa una tabla temporal para no simular dos veces
-- cada corrida. No escribe nada persistente.
AS $function$
DECLARE
  c      record;
  v_prev jsonb := coalesce(p_prev_inicial, '{}'::jsonb);
BEGIN
  -- Se materializa cada corrida UNA sola vez. La version anterior
  -- llamaba al simulador dos veces por corrida (una para devolver y otra
  -- para armar la escalera de la siguiente): con 83 corridas por dia y
  -- un optimizador que evalua decenas de combinaciones, ese descuido
  -- costaba el doble de todo.
  CREATE TEMP TABLE IF NOT EXISTS _sim_corrida (
    zona_id integer, tipo_servicio text, demora_cruda numeric,
    demora_suavizada numeric, demora_informada integer
  ) ON COMMIT DROP;

  FOR c IN
    SELECT m.corrida_at AS at
    FROM demoras_corrida_meta m
    WHERE m.escenario = p_escenario AND m.fecha_local = p_fecha
    ORDER BY m.corrida_at
  LOOP
    TRUNCATE _sim_corrida;
    INSERT INTO _sim_corrida
    SELECT s.zona_id, s.tipo_servicio, s.demora_cruda, s.demora_suavizada, s.demora_informada
    FROM demoras_simular_corrida(c.at, p_escenario, p_perillas, v_prev) s;

    RETURN QUERY
    SELECT c.at, x.zona_id, x.tipo_servicio, x.demora_cruda, x.demora_suavizada, x.demora_informada
    FROM _sim_corrida x;

    -- La escalera: el prev de la proxima corrida es lo que acaba de
    -- publicar ESTA simulacion.
    SELECT coalesce(jsonb_object_agg(x.zona_id::text || '|' || x.tipo_servicio,
                                     to_jsonb(x.demora_suavizada)), '{}'::jsonb)
      INTO v_prev
      FROM _sim_corrida x;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION demoras_simular_dia(date, integer, jsonb) IS
  'Simula un dia completo corrida por corrida, arrastrando la escalera de suavizado de la propia simulacion. Es la unidad de trabajo del reproceso y del optimizador.';

-- ─── 4. El control de fidelidad ──────────────────────────────────────
-- Simular con la parametria original tiene que reproducir lo publicado.
-- Devuelve las divergencias: cero es lo unico aceptable.
CREATE OR REPLACE FUNCTION demoras_simular_control(p_fecha date, p_escenario integer)
RETURNS TABLE(corridas integer, filas integer, difs_informada integer,
              difs_cruda integer, peor_cruda numeric)
LANGUAGE sql
-- VOLATILE porque demoras_simular_dia lo es (tabla temporal).
AS $function$
  WITH prev0 AS (
    -- La escalera del motor en la corrida ANTERIOR a la primera
    -- capturada del dia: sin esto el control marca como divergencia el
    -- arranque frio de la simulacion.
    SELECT coalesce(jsonb_object_agg(d.zona_id::text || '|' || d.tipo_servicio,
                                     to_jsonb(d.demora_suavizada)), '{}'::jsonb) AS p
    FROM demoras_calculadas d
    WHERE d.escenario = p_escenario
      AND d.corrida_at = (
        SELECT max(d2.corrida_at) FROM demoras_calculadas d2
        WHERE d2.escenario = p_escenario
          AND d2.corrida_at >= (p_fecha::timestamp AT TIME ZONE 'America/Montevideo')
          AND d2.corrida_at < (SELECT min(m.corrida_at) FROM demoras_corrida_meta m
                               WHERE m.escenario = p_escenario AND m.fecha_local = p_fecha))
  ),
  sim AS (
    -- Sin perillas: la parametria de cada corrida, tal como estaba.
    SELECT s.* FROM prev0, demoras_simular_dia(p_fecha, p_escenario, '{}'::jsonb, prev0.p) s
  ),
  j AS (
    SELECT s.corrida_at AS at, s.demora_informada AS si, s.demora_cruda AS sc,
           d.demora_informada AS mi, d.demora_cruda AS mc
    FROM sim s
    JOIN demoras_calculadas d
      ON d.corrida_at = s.corrida_at AND d.escenario = p_escenario
     AND d.zona_id = s.zona_id AND d.tipo_servicio = s.tipo_servicio
  )
  SELECT count(DISTINCT at)::integer,
         count(*)::integer,
         count(*) FILTER (WHERE si IS DISTINCT FROM mi)::integer,
         count(*) FILTER (WHERE abs(coalesce(sc,0) - coalesce(mc,0)) > 0.02)::integer,
         round(max(abs(coalesce(sc,0) - coalesce(mc,0))), 3)
  FROM j;
$function$;

COMMENT ON FUNCTION demoras_simular_control(date, integer) IS
  'Control de fidelidad del simulador: simula el dia con la parametria original y cuenta divergencias contra lo que el motor publico. Cero divergencias es lo unico aceptable; cualquier otra cosa significa que el simulador (o la caja negra) esta mal.';
