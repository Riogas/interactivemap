-- ====================================================================
-- Recargo calibrado: la perilla general que corrige la exageracion
-- Fecha: 2026-08-11 | Idempotente | Aplicar via pg-meta o SQL Editor.
-- ====================================================================
--
-- El hallazgo (11/8, prueba honesta: receta aprendida en 6-8/8 y
-- evaluada en 9-11/8 sobre 7.753 urgentes que no vio):
--
--   promesa del motor      acierto <=25'   demora real media
--   en el piso (30')            83,7%            33,8'
--   recargo chico (31-45)       63,6%            38,9'
--   recargo medio (46-60)       51,2%            47,0'
--   recargo grande (61-90)      37,7%            59,2'
--   recargo maximo (91-120)     26,3%            76,7'
--
-- El motor detecta bien la congestion (el orden del real acompana al
-- recargo) pero EXAGERA su tamano ~al doble: recarga 15' cuando la
-- calle agrega 5-9, recarga 50' cuando agrega 29, recarga 85' cuando
-- agrega 47. Diego pidio explicitamente una correccion GENERAL, no
-- factores por zona (y la comparacion le dio la razon: 72,4% centrado
-- de la receta general vs 70,8% de la zonal, misma prueba). Es una
-- sola perilla global:
--
--     promesa = piso + k x (calculo - piso)
--
-- El dial medido fuera de muestra (la eleccion de k es de Diego):
--   k=1,00 (hoy)  68,0%  sesgo -4,8'  infla 19,2%  tarde 12,8%
--   k=0,70        72,4%  sesgo -0,1'  infla 12,8%  tarde 14,8%
--   k=0,60        73,9%  sesgo +1,5'  infla 10,4%  tarde 15,7%
--   k=0,50        75,3%  sesgo +3,1'  infla  7,9%  tarde 16,8%
--
-- Que hace este archivo:
--   1. Columna recargo_factor en el catalogo (NULL = 1,0 = no-op).
--   2. La perilla en demoras_variante_perillas.
--   3. La perilla en demoras_simular_corrida, aplicada sobre la cruda
--      ANTES del acabado (clamp -> escalera -> escalon): la escalera de
--      cada variante opera sobre valores ya encogidos y el escalon
--      redondea al final como siempre. Con 1,0 el codigo ni se ejecuta:
--      el espejo del campeon (CAMPEON == motor) queda intacto.
--   4. El eje recargo_factor en el optimizador nocturno, y su INSERT
--      aprende a persistir la perilla cuando proponga una combinacion
--      que la use.
--   5. Tres variantes nuevas en sombra: RECARGO_050/060/070.
--
-- Ninguna funcion cambia de firma: CREATE OR REPLACE es seguro (el
-- gotcha del DROP aplica solo cuando se agrega un parametro).
-- ====================================================================

-- --- 1. El catalogo --------------------------------------------------
ALTER TABLE demoras_variantes ADD COLUMN IF NOT EXISTS recargo_factor numeric;

COMMENT ON COLUMN demoras_variantes.recargo_factor IS
  'Fraccion del excedente sobre el piso que se conserva: promesa = piso + k x (calculo - piso). NULL o 1,0 = como el campeon. No toca el piso ni el techo.';

-- --- 2. Catalogo -> perillas -----------------------------------------
CREATE OR REPLACE FUNCTION demoras_variante_perillas(p_variante smallint)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'estadistico',        v.estadistico,
           'nivel_ritmo',        v.nivel_ritmo,
           'factor_calibracion', v.factor,
           'escalon_minutos',    v.escalon_minutos,
           'min_minutos',        v.min_minutos,
           'subida_max',         v.suavizado_paso,
           'bajada_max',         v.suavizado_paso,
           'recargo_factor',     v.recargo_factor
         ))
         -- `suavizado` va SIEMPRE (es NOT NULL): un false tiene que
         -- pisar al modelo, y jsonb_strip_nulls no lo sacaria igual.
         || jsonb_build_object('suavizado', v.suavizado)
  FROM demoras_variantes v
  WHERE v.id = p_variante;
$function$;

-- --- 3. El simulador -------------------------------------------------
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
  v_recargo numeric;
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
  v_recargo  := coalesce((cfg->>'recargo_factor')::numeric, 1.0);

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

    -- ── El recargo calibrado (perilla 2026-08-11) ──────────────────
    -- Hallazgo del 11/8 sobre 7.753 urgentes fuera de muestra: cuando
    -- el motor promete el piso acierta 84%, y el acierto cae cuanto mas
    -- recarga (26% en el tramo 91-120), aunque el ORDEN es correcto (a
    -- mas recargo, mas demora real). Detecta bien la congestion pero
    -- exagera su tamaño ~al doble. La perilla se queda con una fraccion
    -- del EXCEDENTE sobre el piso, sin tocar el piso. Con 1.0 (default)
    -- es un no-op exacto: el espejo del campeon no se toca.
    IF v_recargo <> 1.0 AND v_cruda IS NOT NULL AND v_cruda > v_min THEN
      v_cruda := v_min + v_recargo * (v_cruda - v_min);
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

-- --- 4. El optimizador aprende el eje --------------------------------
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
      ('nivel_ritmo',        ARRAY['"CASCADA"','"ZONA"','"MOVIL"']),
      ('recargo_factor',     ARRAY['0.50','0.60','0.70','0.85','1.00'])
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
        escalon_minutos, suavizado, suavizado_paso, min_minutos, activa,
        recargo_factor)
      VALUES (
        v_nuevo, 'AUTO_' || v_nuevo,
        'Propuesta automática #' || v_nuevo,
        'La encontró el optimizador el ' || v_hasta || ' buscando sobre los días '
          || v_train_d || ' a ' || v_train_h || '. En entrenamiento y en el día de validación '
          || '(que no vio) le ganó al Despacho. Todavía tiene que cumplir la regla de promoción.',
        cand->>'estadistico', cand->>'nivel_ritmo',
        (cand->>'factor_calibracion')::numeric, (cand->>'escalon_minutos')::smallint,
        coalesce((cand->>'suavizado')::boolean, true),
        (cand->>'subida_max')::smallint, (cand->>'min_minutos')::smallint, true,
        (cand->>'recargo_factor')::numeric);

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

-- --- 5. Las variantes en sombra --------------------------------------
-- Todo NULL salvo el recargo = "como el campeon, pero con esta perilla".
INSERT INTO demoras_variantes (id, codigo, nombre, descripcion, suavizado, activa, recargo_factor)
VALUES
  (16, 'RECARGO_050', 'Recargo x0,50',
   'Se queda con la mitad del recargo sobre el piso de 30. Prueba fuera de muestra del 11/8: 75,3% de acierto con sesgo +3,1 (la promesa queda un poco corta). Es el extremo "acertar mas" del dial.',
   true, true, 0.50),
  (17, 'RECARGO_060', 'Recargo x0,60',
   'Se queda con el 60% del recargo sobre el piso de 30. Prueba fuera de muestra del 11/8: 73,9% de acierto con sesgo +1,5. El punto medio del dial.',
   true, true, 0.60),
  (18, 'RECARGO_070', 'Recargo x0,70',
   'Se queda con el 70% del recargo sobre el piso de 30. Prueba fuera de muestra del 11/8: 72,4% de acierto con sesgo -0,1: la promesa mas centrada del dial, ni infla ni se queda corta.',
   true, true, 0.70)
ON CONFLICT (id) DO NOTHING;
