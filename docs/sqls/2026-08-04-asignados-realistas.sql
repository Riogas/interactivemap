-- =====================================================================
-- ASIGNADOS REALISTAS: la cola descuenta el trabajo ya hecho
-- Fecha: 2026-08-04 | Idempotente | Requiere: tanda CONSUMO_TRAMOS +
-- 2026-08-04-arranque-despacho.sql aplicados.
--
-- EL PROBLEMA (medido): el modelo cuenta cada pedido ASIGNADO como un
-- pedido entero por delante, pero el asignado mediano ya lleva ~12 min
-- arriba del movil (con ritmo ~13): se le cobra al pedido nuevo trabajo
-- que esta a un minuto de terminarse. Es la mayor parte de los ~21
-- puntos de acierto (<=25') que el modelo pierde contra el Despacho
-- incluso publicando su cruda — y explica que el error CREZCA con la
-- cola y desaparezca con cola 0.
--
-- LA PERILLA (por escenario, como todo):
--   demoras_modelo.asignados_modo:
--     'COMPLETO' (default) -> historico: cada asignado activo cuenta 1.
--     'PESO'               -> cuenta peso_asignados (0..1) fijo.
--     'PROGRESO'           -> cuenta lo que le FALTA: 1 - (minutos desde
--                             la asignacion / ritmo de la zona), acotado
--                             a [0,1].
--       MOMENTO DE ASIGNACION (medido 2026-08-04): fch_hora_asignado
--       viene NULL en el 89% de los PENDIENTES (el sender la emite recien
--       hacia el cierre; los entregados la tienen al 100%). Fallback:
--       updated_at del pedido — la ultima transicion de un estado-1
--       asignado es tipicamente la asignacion (mediana 18,8 min vs 12 de
--       en-curso real), y el proxy es CONSERVADOR: cualquier update
--       posterior lo rejuvenece y descuenta MENOS, nunca de mas. Sin
--       ninguna de las dos, cuenta 1 (no se inventa progreso).
--   demoras_modelo.peso_asignados (default 0.5): solo aplica en PESO.
--
-- LA VARA del PROGRESO: el ritmo_usado de la ULTIMA corrida persistida
-- de esa (zona, tipo) — lookup por indice, sin re-escanear el historico
-- (la cascada del ritmo adentro de demoras_cola duplicaria el costo de
-- la corrida; el ritmo es estable dentro del dia). Fallback:
-- demoras_modelo.ritmo_default_minutos.
--
-- EFECTOS DE TIPO: cola_efectiva pasa a NUMERIC (2,5 asignados
-- equivalentes es el punto de la perilla) -> DROP + CREATE de
-- demoras_cola y demoras_consumo_tramos (cambia su RETURNS), y
-- demoras_calculadas.cola_por_delante pasa a numeric. Los conteos
-- crudos (asignados / sin_asignar / atrapados) SIGUEN siendo enteros
-- fisicos: la auditoria no cambia de significado. demoras_calcular_run
-- (plpgsql) no necesita recrearse: resuelve las funciones en runtime.
-- Con asignados_modo = 'COMPLETO' el resultado es identico al historico
-- (equivalentes = conteo) — la regresion completa del harness lo prueba.
--
-- NOTA: demoras_proximo_hueco / demoras_servidores (obsoletas, sin
-- consumidores) quedan rotas frente al nuevo RETURNS de demoras_cola si
-- alguien las llamara a mano; ya estaban marcadas obsoletas.
-- =====================================================================

ALTER TABLE demoras_modelo
  ADD COLUMN IF NOT EXISTS asignados_modo text NOT NULL DEFAULT 'COMPLETO',
  ADD COLUMN IF NOT EXISTS peso_asignados numeric NOT NULL DEFAULT 0.5;

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_asignados_modo_chk;
ALTER TABLE demoras_modelo ADD CONSTRAINT demoras_modelo_asignados_modo_chk
  CHECK (asignados_modo IN ('COMPLETO', 'PESO', 'PROGRESO'));
ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_peso_asignados_chk;
ALTER TABLE demoras_modelo ADD CONSTRAINT demoras_modelo_peso_asignados_chk
  CHECK (peso_asignados >= 0 AND peso_asignados <= 1);

COMMENT ON COLUMN demoras_modelo.asignados_modo IS
  'Cuanto pesa un pedido ASIGNADO activo en la cola: COMPLETO = 1 (historico); PESO = peso_asignados fijo; PROGRESO = lo que le falta segun el tiempo que lleva asignado contra el ritmo de la zona (ultima corrida; fallback ritmo_default_minutos). Sin fch_hora_asignado cuenta 1.';
COMMENT ON COLUMN demoras_modelo.peso_asignados IS
  'Peso fijo 0..1 de cada asignado activo en la cola. Solo aplica con asignados_modo = PESO.';

-- cola_por_delante ahora guarda pedidos EQUIVALENTES (puede ser 2,5).
ALTER TABLE demoras_calculadas ALTER COLUMN cola_por_delante TYPE numeric;
COMMENT ON COLUMN demoras_calculadas.cola_por_delante IS
  'La cola que consumio la simulacion, en pedidos EQUIVALENTES: con asignados_modo PESO/PROGRESO los asignados cuentan fraccionado (el que esta por terminar vale ~0). Con COMPLETO coincide con el conteo fisico.';


-- =====================================================================
-- demoras_cola v3 — cola_efectiva numeric + asignados por modo
-- (cuerpo de la v2 + el CTE marcado/ritmos; los conteos crudos y el
-- pooling URGENTE+NOCTURNO no cambian)
-- =====================================================================
DROP FUNCTION IF EXISTS demoras_cola(integer, date, timestamptz);

CREATE FUNCTION demoras_cola(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id       integer,
  tipo_servicio text,
  asignados     integer,
  sin_asignar   integer,
  atrapados     integer,
  cola_efectiva numeric
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    SELECT coalesce(dm.atrapados_modo, 'EXCLUIR')        AS atrapados_modo,
           coalesce(dm.asignados_modo, 'COMPLETO')       AS asignados_modo,
           coalesce(dm.peso_asignados, 0.5)              AS peso,
           coalesce(dm.ritmo_default_minutos, 30)::numeric AS ritmo_default
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  sa AS (
    -- Ventana de visibilidad de los sin-asignar (ver v2: subconsulta
    -- escalar deliberada — sin fila de settings degrada a "sin filtro").
    SELECT (SELECT es.pedidos_sa_minutos_antes
              FROM escenario_settings es
             WHERE es.escenario_id = p_escenario) AS mins
  ),
  crudo AS (
    SELECT zona_nro, movil, fch_hora_para, fch_hora_asignado, updated_at,
           CASE upper(trim(coalesce(servicio_nombre,'')))
             WHEN 'NOCTURNO' THEN 'NOCTURNO'
             WHEN 'URGENTE'  THEN 'URGENTE'
             ELSE NULL
           END AS tipo
    FROM pedidos
    WHERE escenario = p_escenario AND estado_nro = 1
      AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND zona_nro IS NOT NULL
    UNION ALL
    SELECT zona_nro, movil, fch_hora_para, fch_hora_asignado, updated_at, 'SERVICE'
    FROM services
    WHERE escenario = p_escenario AND estado_nro = 1
      AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND zona_nro IS NOT NULL
  ),
  visible AS (
    SELECT c.*
    FROM crudo c, sa
    WHERE c.tipo IS NOT NULL
      AND (
        (c.movil IS NOT NULL AND c.movil <> 0)
        OR sa.mins IS NULL OR sa.mins = 0
        OR c.fch_hora_para IS NULL
        OR c.fch_hora_para <= p_corrida_at + (sa.mins * interval '1 minute')
      )
  ),
  -- El estado de cada pedido, calculado UNA vez (el EXISTS de atrapados
  -- se repetia por FILTER en la v2; aca ademas lo necesita el modo).
  marcado AS (
    SELECT v.zona_nro, v.tipo,
           -- Momento de asignacion: el campo real si esta; si no, el proxy
           -- updated_at (ver cabecera — conservador por construccion).
           coalesce(v.fch_hora_asignado, v.updated_at) AS asignado_desde,
           (v.movil IS NOT NULL AND v.movil <> 0) AS es_asignado,
           CASE WHEN v.movil IS NOT NULL AND v.movil <> 0 THEN
             EXISTS (SELECT 1 FROM moviles_dia md
                      WHERE md.escenario_id = p_escenario
                        AND md.movil_id     = v.movil
                        AND md.fecha        = p_fecha
                        AND md.activo)
           ELSE false END AS movil_activo
    FROM visible v
  ),
  pool AS (
    SELECT 'URGENTE'::text  AS tipo_calculado, unnest(ARRAY['URGENTE','NOCTURNO']) AS tipo_pedido
    UNION ALL
    SELECT 'NOCTURNO',       unnest(ARRAY['URGENTE','NOCTURNO'])
    UNION ALL
    SELECT 'SERVICE',        'SERVICE'
  ),
  -- La vara del PROGRESO: ritmo_usado de la ultima corrida persistida de
  -- (zona, tipo). Lookup por idx_demoras_calc_esc_zona_tipo_at, uno por
  -- (zona, tipo) del universo con demanda — NO por pedido.
  ritmos AS (
    SELECT r.zona_id, r.tipo,
           coalesce(
             (SELECT dc.ritmo_usado FROM demoras_calculadas dc
               WHERE dc.escenario = p_escenario AND dc.zona_id = r.zona_id
                 AND dc.tipo_servicio = r.tipo AND dc.ritmo_usado IS NOT NULL
               ORDER BY dc.corrida_at DESC LIMIT 1),
             c.ritmo_default) AS ritmo_ref
    FROM (SELECT DISTINCT m.zona_nro AS zona_id, p.tipo_calculado AS tipo
            FROM marcado m JOIN pool p ON p.tipo_pedido = m.tipo) r
    CROSS JOIN cfg c
  ),
  agg AS (
    SELECT m.zona_nro AS zona_id, p.tipo_calculado AS tipo,
           count(*) FILTER (WHERE m.es_asignado)::integer                        AS asignados,
           count(*) FILTER (WHERE NOT m.es_asignado)::integer                    AS sin_asignar,
           count(*) FILTER (WHERE m.es_asignado AND NOT m.movil_activo)::integer AS atrapados,
           -- Los asignados ACTIVOS, pesados segun el modo. COMPLETO
           -- reproduce el conteo historico exacto.
           sum(CASE WHEN m.es_asignado AND m.movil_activo THEN
                 CASE c.asignados_modo
                   WHEN 'PESO'     THEN c.peso
                   WHEN 'PROGRESO' THEN
                     CASE WHEN m.asignado_desde IS NULL THEN 1
                          ELSE LEAST(1, GREATEST(0,
                            1 - (EXTRACT(EPOCH FROM (p_corrida_at - m.asignado_desde)) / 60.0)
                                / NULLIF(rr.ritmo_ref, 0)))
                     END
                   ELSE 1
                 END
               ELSE 0 END)::numeric AS asignados_equivalentes
    FROM marcado m
    JOIN pool p    ON p.tipo_pedido = m.tipo
    JOIN ritmos rr ON rr.zona_id = m.zona_nro AND rr.tipo = p.tipo_calculado
    CROSS JOIN cfg c
    GROUP BY m.zona_nro, p.tipo_calculado
  )
  SELECT a.zona_id, a.tipo, a.asignados, a.sin_asignar, a.atrapados,
         (a.sin_asignar
          + coalesce(a.asignados_equivalentes, 0)
          + CASE c.atrapados_modo
              WHEN 'EXCLUIR'          THEN 0
              WHEN 'COMO_SIN_ASIGNAR' THEN a.atrapados
              ELSE a.atrapados
            END)::numeric AS cola_efectiva
  FROM agg a CROSS JOIN cfg c;
$fn$;

COMMENT ON FUNCTION demoras_cola(integer, date, timestamptz) IS
  'Demanda pendiente por (zona, tipo). v3: cola_efectiva es NUMERIC y los asignados activos pesan segun demoras_modelo.asignados_modo (COMPLETO=1 historico; PESO=peso fijo; PROGRESO=lo que les falta segun el tiempo desde la asignacion (fch_hora_asignado, fallback updated_at — proxy conservador) vs ritmo de la ultima corrida, fallback ritmo_default). Conteos crudos siguen fisicos y pooleados URGENTE+NOCTURNO (I5). Ventana SA canonica y fch_para NULL tolerado, igual que v2.';

REVOKE EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) TO service_role;


-- =====================================================================
-- demoras_consumo_tramos v2 — cola_por_delante numeric (la Q en pedidos
-- equivalentes). Cuerpo identico al de 2026-08-01 salvo el tipo del OUT
-- (generado programaticamente desde ese archivo). DROP previo: cambiar
-- el RETURNS exige recrear.
-- =====================================================================
DROP FUNCTION IF EXISTS demoras_consumo_tramos(integer, date, timestamptz);

CREATE FUNCTION demoras_consumo_tramos(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id              integer,
  tipo_servicio        text,
  demora_cruda         numeric,
  moviles_considerados integer,
  cola_por_delante     numeric,
  capacidad_inicial    numeric,
  capacidad_final      numeric,
  tramos               integer,
  sin_capacidad        boolean
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  c        record;
  z        record;
  v_q      numeric;
  v_t      numeric;
  v_mu     numeric;
  v_proc   numeric;
  v_tramo  numeric;
  v_listo  boolean;
  v_i      integer;
BEGIN
  SELECT coalesce(dm.max_minutos, 120)::numeric    AS max_min,
         coalesce(dm.factor_calibracion, 1.0)      AS factor
    INTO c
    FROM (SELECT p_escenario AS e) x
    LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e;

  -- UNA SOLA llamada a demoras_aportes para toda la corrida, agregada por
  -- (zona, tipo) en arrays paralelos. El loop de abajo solo toca memoria.
  --
  -- Esto NO es una optimizacion prematura: demoras_aportes llama por dentro a
  -- la cascada del ritmo, que escanea las ~168.000 entregas del historico y
  -- calcula percentiles. Llamarla adentro del loop serian 106 zonas x 3 tipos
  -- x 3 llamadas = 954 ejecuciones POR ESCENARIO. Medido: entre 50 y 477 ms
  -- cada una, o sea entre 48 segundos y 7,5 minutos por escenario, contra los
  -- 265 ms que tarda hoy una corrida completa. Con el cron cada 10 minutos y
  -- varios escenarios, el motor no llega a terminar antes del disparo
  -- siguiente y el advisory lock empieza a rechazar corridas.
  --
  -- Es el mismo patron que ya usaba demoras_proximo_hueco y que su revision
  -- valido.
  --
  -- Los eventos vienen YA AGRUPADOS por r_j: dos moviles que se liberan en el
  -- mismo minuto entran en el MISMO tramo. Sin ese GROUP BY un empate abriria
  -- dos tramos, el segundo de duracion cero -- no cambia el resultado, pero
  -- ensucia el conteo de tramos que se persiste para auditoria.
  FOR z IN
    -- MATERIALIZED es obligatorio, no cosmetico: desde Postgres 12 un CTE
    -- referenciado una sola vez se inlinea, y este se referencia TRES veces
    -- (capacidad inicial, conteo de moviles, eventos). Sin la palabra, el
    -- planner puede evaluar demoras_aportes una vez por referencia, y cada
    -- evaluacion escanea las ~168.000 entregas del historico para la cascada
    -- del ritmo. Con MATERIALIZED se evalua UNA vez por escenario.
    WITH ap AS MATERIALIZED (
      SELECT a.zona_id, a.tipo_servicio, a.r_j, a.mu_j
      FROM demoras_aportes(p_escenario, p_fecha) a
    ),
    -- Capacidad de arranque: los que ya estan adentro (r_j <= 0).
    --
    -- OJO: zona_id/tipo_servicio van CALIFICADOS (ap.zona_id, no zona_id a
    -- secas) en las cuatro CTEs de aca abajo. La funcion es plpgsql y sus
    -- OUT params se llaman EXACTAMENTE zona_id/tipo_servicio (ver
    -- RETURNS TABLE); con plpgsql.variable_conflict=error (el default de
    -- Postgres), un GROUP BY zona_id sin calificar es ambiguo entre la
    -- columna de la CTE y el parametro de salida, y la funcion revienta en
    -- RUNTIME con "column reference zona_id is ambiguous" -- el CREATE pasa
    -- sin ruido (el cuerpo plpgsql no se valida al crearse) y el cron falla
    -- en silencio en la primera corrida. Confirmado con el harness.
    ini AS (
      SELECT ap.zona_id, ap.tipo_servicio, sum(ap.mu_j) AS mu
      FROM ap WHERE ap.r_j <= 0
      GROUP BY ap.zona_id, ap.tipo_servicio
    ),
    -- Cuantos moviles considera la zona en total (para auditoria).
    tot AS (
      SELECT ap.zona_id, ap.tipo_servicio, count(*) AS n
      FROM ap GROUP BY ap.zona_id, ap.tipo_servicio
    ),
    -- Los eventos de liberacion, agrupados por minuto y en orden. El GROUP BY
    -- por r_j es lo que hace que dos moviles que se liberan en el mismo minuto
    -- entren en el MISMO tramo: aca el empate no necesita desempate, se suman
    -- las capacidades.
    ev AS (
      SELECT g.zona_id, g.tipo_servicio,
             array_agg(g.r  ORDER BY g.r) AS rs,
             array_agg(g.mu ORDER BY g.r) AS mus
      FROM (
        SELECT ap.zona_id, ap.tipo_servicio, ap.r_j AS r, sum(ap.mu_j) AS mu
        FROM ap WHERE ap.r_j > 0
        GROUP BY ap.zona_id, ap.tipo_servicio, ap.r_j
      ) g
      GROUP BY g.zona_id, g.tipo_servicio
    )
    -- El universo sale de moviles_zonas y NO de los aportes: una zona sin
    -- ningun movil activo tiene que devolver fila igual, con sin_capacidad y
    -- el techo. A las 07:00 el 72% de la flota esta inactiva y ese es justo
    -- el caso que hay que poder auditar.
    SELECT u.zona_id, u.tipo,
           coalesce(q.cola_efectiva, 0)             AS cola,
           coalesce(ini.mu, 0)                      AS mu_inicial,
           coalesce(tot.n, 0)                       AS n_moviles,
           coalesce(ev.rs,  ARRAY[]::numeric[])     AS rs,
           coalesce(ev.mus, ARRAY[]::numeric[])     AS mus
    FROM (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
      FROM moviles_zonas mz
      WHERE mz.escenario_id = p_escenario
        AND coalesce(mz.activa, true)
        AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ) u
    LEFT JOIN demoras_cola(p_escenario, p_fecha, p_corrida_at) q
           ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo
    LEFT JOIN ini ON ini.zona_id = u.zona_id AND ini.tipo_servicio = u.tipo
    LEFT JOIN tot ON tot.zona_id = u.zona_id AND tot.tipo_servicio = u.tipo
    LEFT JOIN ev  ON ev.zona_id  = u.zona_id AND ev.tipo_servicio  = u.tipo
  LOOP
    -- Q incluye el pedido que entra ahora.
    v_q     := z.cola + 1;
    v_t     := 0;
    v_listo := false;
    tramos  := 0;
    v_mu    := z.mu_inicial;

    moviles_considerados := z.n_moviles;
    capacidad_inicial    := round(v_mu, 6);

    FOR v_i IN 1 .. coalesce(array_length(z.rs, 1), 0) LOOP
      v_tramo := z.rs[v_i] - v_t;
      v_proc  := v_tramo * v_mu;

      -- Con capacidad cero no se procesa nada y no se puede dividir: se
      -- avanza al evento y listo. Es el caso "todos ocupados afuera".
      IF v_mu > 0 AND v_q <= v_proc THEN
        demora_cruda := round((v_t + v_q / v_mu) * c.factor, 2);
        -- El tramo en el que se ENCONTRO la respuesta tambien cuenta: sin
        -- este incremento, un caso que se resuelve en el primer tramo queda
        -- en tramos=0, como si no se hubiera consumido nada. Ver el bloque
        -- "el tramo final tambien cuenta" mas abajo para el caso simetrico
        -- por fuera del loop.
        tramos  := tramos + 1;
        v_listo := true;
        EXIT;
      END IF;

      v_q     := v_q - v_proc;
      v_t     := z.rs[v_i];
      v_mu    := v_mu + z.mus[v_i];
      tramos  := tramos + 1;
    END LOOP;

    capacidad_final := round(v_mu, 6);

    IF NOT v_listo THEN
      IF v_mu <= 0 THEN
        -- Nadie ahora y nadie por venir: la respuesta honesta no es "poco".
        demora_cruda  := c.max_min;
        sin_capacidad := true;
      ELSE
        demora_cruda  := round((v_t + v_q / v_mu) * c.factor, 2);
        -- El tramo final -con todos los que ya se liberaron- tambien es un
        -- tramo: si el loop agoto los eventos y la cola recien se termina de
        -- vaciar DESPUES del ultimo, ese ultimo tramo abierto tiene que
        -- contar igual que los anteriores. Sin este incremento, un caso con
        -- tres eventos de liberacion nunca puede pasar de tramos=3, aunque
        -- la simulacion en verdad haya atravesado CUATRO regimenes de
        -- capacidad distintos (el inicial mas los tres saltos) para llegar a
        -- la respuesta -- es exactamente el "4" de la tabla de
        -- DEMORA_MODELO_TRAMOS.md seccion 4 (0->15, 15->60, 60->90, 90->117).
        tramos        := tramos + 1;
        sin_capacidad := false;
      END IF;
    ELSE
      sin_capacidad := false;
    END IF;

    zona_id          := z.zona_id;
    tipo_servicio    := z.tipo;
    cola_por_delante := z.cola;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION demoras_consumo_tramos(integer, date, timestamptz) IS
  'Simulacion por tramos: la demanda de la zona se consume a una velocidad que aumenta cada vez que un movil termina lo que tenia afuera. Devuelve demora_cruda SIN clamp, suavizado ni redondeo (de eso se ocupa demoras_acabado). El universo sale de moviles_zonas y no de los aportes, para que una zona sin ningun movil activo devuelva fila con sin_capacidad y el techo en vez de desaparecer. Dos moviles que se liberan en el mismo minuto entran en el mismo tramo: aca el empate no necesita desempate, se suman las capacidades. tramos cuenta TODOS los regimenes de capacidad atravesados para llegar a la respuesta, incluido el ultimo (el que se abre con el evento final o el que resuelve dentro del loop), no solo los intermedios. Reemplaza a demoras_proximo_hueco.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto: sin
-- este REVOKE, anon/authenticated (las claves que viajan al browser) pueden
-- invocarla via RPC. Mismo patron que el resto de las funciones de esta
-- tanda (docs/sqls/2026-08-01-demoras-aportes.sql y las anteriores).
REVOKE EXECUTE ON FUNCTION demoras_consumo_tramos(integer, date, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_consumo_tramos(integer, date, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_consumo_tramos(integer, date, timestamptz) TO service_role;


-- =====================================================================
-- ACTIVACION (escenario 1000): modo PROGRESO — "que sea mas realista".
-- Revertir: UPDATE demoras_modelo SET asignados_modo = 'COMPLETO'
--           WHERE escenario_id = 1000;
-- =====================================================================
UPDATE demoras_modelo
   SET asignados_modo = 'PROGRESO'
 WHERE escenario_id = 1000
   AND asignados_modo IS DISTINCT FROM 'PROGRESO';
