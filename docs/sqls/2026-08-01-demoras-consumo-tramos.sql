-- =====================================================================
-- demoras_consumo_tramos — la simulacion
-- Fecha: 2026-08-01 | Idempotente
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md seccion 3
--
-- La demanda de la zona se consume a una velocidad que AUMENTA cada vez que
-- un movil termina lo que tenia afuera. El pedido nuevo se entrega cuando
-- esa demanda, incluyendolo a el, llega a cero.
--
-- Lo importante es el "cada vez": si un movil se libera a los 15, otro a los
-- 60 y otro a los 90, NO hay que esperar al de 90 para empezar a contar. Ese
-- error -esperar al ultimo- es la diferencia entre 117 y 138 minutos sobre el
-- mismo dato.
--
-- Reemplaza a demoras_proximo_hueco, que asignaba la cola pedido por pedido
-- al primer movil libre y no podia expresar una dedicacion parcial continua.
-- No se borra demoras_proximo_hueco aca -- la Task 6 le saca a su unico
-- consumidor (el orquestador).
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_consumo_tramos(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id              integer,
  tipo_servicio        text,
  demora_cruda         numeric,
  moviles_considerados integer,
  cola_por_delante     integer,
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
