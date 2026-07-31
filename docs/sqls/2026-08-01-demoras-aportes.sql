-- =====================================================================
-- demoras_aportes — cuanto y desde cuando aporta cada movil a cada zona
-- Fecha: 2026-08-01 | Idempotente
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md seccion 2
--
-- Reemplaza a demoras_servidores. La diferencia de fondo: aquella calculaba
-- "a que hora queda libre este movil" contando TODA su carga; esta calcula
-- dos cosas separadas:
--
--   r_j   cuando entra a aportar a ESTA zona = lo que tiene FUERA de la zona,
--         mas el traslado de vuelta (una sola vez).
--   mu_j  cuanto aporta una vez adentro = su dedicacion a la zona dividida
--         por su ritmo, en pedidos por minuto.
--
-- Los pedidos que el movil tiene DENTRO de la zona NO entran en r_j: son
-- demanda de la zona y los cuenta demoras_cola. Contarlos en los dos lados
-- seria el doble conteo que este modelo vino a evitar.
--
-- El reparto de p_j (spec seccion 2):
--   1. Cada zona de transito se lleva dedicacion_transito.
--   2. Si la suma de los transitos del movil pasa
--      transito_dedicacion_max_total, se achican TODOS a prorrata.
--   3. Las zonas de prioridad se reparten lo que queda, en partes iguales.
-- Asi la prioridad nunca baja de (1 - tope) por mas zonas de transito que
-- se le agreguen al movil.
--
-- ORDEN DE APLICACION: demoras_servidores (docs/sqls/2026-07-31-demoras-servidores.sql)
-- NO se toca ni se borra aca -- sigue leyendo dm.transito_modo,
-- dm.transito_castigo_minutos y dm.transito_margen_minutos, que la Task 1
-- (docs/sqls/2026-08-01-demoras-modelo-tramos.sql) ya dio de baja de
-- demoras_modelo. Esta funcion es su reemplazo: la Task 6 saca al unico
-- consumidor de demoras_servidores (el orquestador) y la deja sin lector.
-- Hasta esa task, demoras_servidores sigue existiendo pero rota en runtime
-- si alguien la invoca -- protegido por la misma precondicion de toda la
-- tanda (motor_activo = false en produccion).
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_aportes(p_escenario integer, p_fecha date)
RETURNS TABLE (
  zona_id       integer,
  tipo_servicio text,
  movil         integer,
  es_transito   boolean,
  p_j           numeric,
  ritmo         numeric,
  ritmo_origen  text,
  carga_fuera   integer,
  r_j           numeric,
  mu_j          numeric
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    -- Subconsultas escalares y no FROM: si falta la fila del escenario, un
    -- FROM deja el CTE vacio y los CROSS JOIN de abajo colapsan la funcion a
    -- cero filas.
    SELECT coalesce((SELECT dm.dedicacion_transito           FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 0.20) AS ded,
           coalesce((SELECT dm.transito_dedicacion_max_total FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 0.60) AS tope,
           coalesce((SELECT dm.traslado_fuera_zona_minutos   FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 15)   AS traslado,
           coalesce((SELECT dm.estadistico                   FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 'MEDIANA') AS estadistico,
           coalesce((SELECT dm.ritmo_default_minutos         FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 30)::numeric AS ritmo_defecto
  ),
  asign AS (
    SELECT mz.zona_id, mz.tipo_de_servicio AS tipo, mz.movil_id::integer AS movil,
           (mz.prioridad_o_transito <> 1) AS es_transito
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id = mz.movil_id::integer AND md.escenario_id = mz.escenario_id AND md.fecha = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true) AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  -- Cuantas zonas de cada clase tiene el movil DENTRO de este tipo.
  conteo AS (
    SELECT movil, tipo,
           count(*) FILTER (WHERE es_transito)::numeric     AS n_tra,
           count(*) FILTER (WHERE NOT es_transito)::numeric AS n_pri
    FROM asign GROUP BY movil, tipo
  ),
  -- El reparto. suma_tra es lo que se llevan TODOS los transitos juntos,
  -- topeado; lo que queda se lo reparten las prioridades.
  reparto AS (
    SELECT c.movil, c.tipo, c.n_tra, c.n_pri,
           least(c.n_tra * cf.ded, cf.tope) AS suma_tra
    FROM conteo c CROSS JOIN cfg cf
  ),
  pj AS (
    SELECT a.zona_id, a.tipo, a.movil, a.es_transito,
           CASE
             WHEN a.es_transito THEN
               CASE WHEN r.n_tra > 0 THEN round(r.suma_tra / r.n_tra, 4) ELSE 0 END
             ELSE
               CASE WHEN r.n_pri > 0 THEN round((1 - r.suma_tra) / r.n_pri, 4) ELSE 0 END
           END AS p_j
    FROM asign a
    JOIN reparto r ON r.movil = a.movil AND r.tipo = a.tipo
  ),
  -- Carga FUERA de la zona: todo lo que el movil tiene pendiente en OTRAS
  -- zonas, de CUALQUIER tipo. El movil es un solo camion y un service lo
  -- ocupa igual que un urgente.
  --
  -- MATERIALIZED por el mismo motivo que rit_zona/rit_movil mas abajo: se
  -- lee desde adentro del primer LATERAL (cf_out), correlacionado por
  -- pj.movil/pj.zona_id, y esta referenciada una sola vez -- sin forzar
  -- MATERIALIZED, Postgres la inlinea y el agregado sobre pedidos+services
  -- se recalcula una vez por fila de pj. Confirmado con EXPLAIN ANALYZE: sin
  -- MATERIALIZED, el plan mostraba "Seq Scan on pedidos (loops=900)" y "Seq
  -- Scan on services (loops=900)" -- no es hipotetico, es lo que salio en la
  -- corrida real contra el fixture de 100 zonas x 3 tipos.
  carga_total AS MATERIALIZED (
    SELECT p.movil, p.zona_nro, count(*)::integer AS n
    FROM (
      SELECT movil, zona_nro FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil, zona_nro FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil, p.zona_nro
  ),
  -- MATERIALIZED es obligatorio en las tres CTEs de abajo, no cosmetico.
  -- Las tres se leen desde ADENTRO de un LATERAL correlacionado por
  -- pj.movil/pj.zona_id/pj.tipo (mas abajo, en el SELECT final). Una CTE
  -- referenciada UNA sola vez se inlinea desde Postgres 12 (a menos que se
  -- fuerce MATERIALIZED) -- y al inlinearse DENTRO del LATERAL, Postgres
  -- vuelve a evaluarla una vez POR CADA FILA del lado izquierdo, no una sola
  -- vez para todo el escenario. rit_zona y rit_movil envuelven a
  -- demoras_ritmo()/demoras_ritmo_movil(), que escanean TODO
  -- metricas_cumplimiento para resolver la cascada del ritmo; carga_total
  -- agrupa TODO pedidos+services. Sin MATERIALIZED, un escenario de 100
  -- zonas x 3 tipos (900 filas de moviles_zonas, 168.300 hechos historicos)
  -- repetia ese escaneo ~900 veces -- medido en 2m13s por demoras_aportes.
  -- Con MATERIALIZED (las tres CTEs se calculan UNA vez, se leen de una
  -- tabla temporal en memoria desde el LATERAL) el mismo fixture midio
  -- 605ms -- ~146x mas rapido, mismos resultados (checksum identico del
  -- resultado completo antes y despues). Ver
  -- .superpowers/sdd/2026-07-31-motor-demora-consumo-tramos/task-4-report.md,
  -- seccion "Fix round 2", para las mediciones y el EXPLAIN ANALYZE.
  rit_zona AS MATERIALIZED (
    SELECT r.zona_id, r.tipo_servicio, r.ritmo_media, r.ritmo_mediana, r.ritmo_p75, r.ritmo_p90
    FROM demoras_ritmo(p_escenario, p_fecha) r
  ),
  rit_movil AS MATERIALIZED (
    SELECT m.movil, m.tipo_servicio, m.ritmo_media, m.ritmo_mediana, m.ritmo_p75, m.ritmo_p90
    FROM demoras_ritmo_movil(p_escenario, p_fecha) m
  )
  SELECT
    pj.zona_id, pj.tipo, pj.movil, pj.es_transito, pj.p_j,
    rr.ritmo, rr.origen,
    coalesce(cf_out.n, 0)::integer AS carga_fuera,
    -- r_j: lo de afuera por su ritmo, mas el traslado UNA sola vez. Un movil
    -- sin nada afuera entra en el minuto cero y no paga traslado.
    CASE WHEN coalesce(cf_out.n, 0) = 0 THEN 0
         ELSE round(coalesce(cf_out.n,0) * rr.ritmo + c.traslado, 2) END AS r_j,
    CASE WHEN rr.ritmo > 0 THEN round(pj.p_j / rr.ritmo, 6) ELSE 0 END AS mu_j
  FROM pj
  CROSS JOIN cfg c
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(ct.n), 0) AS n
    FROM carga_total ct
    WHERE ct.movil = pj.movil AND ct.zona_nro <> pj.zona_id
  ) cf_out ON true
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        CASE c.estadistico WHEN 'MEDIA' THEN rm.ritmo_media WHEN 'P75' THEN rm.ritmo_p75
                           WHEN 'P90'  THEN rm.ritmo_p90    ELSE rm.ritmo_mediana END,
        CASE c.estadistico WHEN 'MEDIA' THEN rz.ritmo_media WHEN 'P75' THEN rz.ritmo_p75
                           WHEN 'P90'  THEN rz.ritmo_p90    ELSE rz.ritmo_mediana END,
        c.ritmo_defecto) AS ritmo,
      CASE
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rm.ritmo_media WHEN 'P75' THEN rm.ritmo_p75
                                 WHEN 'P90'  THEN rm.ritmo_p90    ELSE rm.ritmo_mediana END) IS NOT NULL THEN 'MOVIL'
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rz.ritmo_media WHEN 'P75' THEN rz.ritmo_p75
                                 WHEN 'P90'  THEN rz.ritmo_p90    ELSE rz.ritmo_mediana END) IS NOT NULL THEN 'ZONA'
        ELSE 'DEFECTO'
      END AS origen
    FROM (SELECT 1) x
    LEFT JOIN rit_movil rm ON rm.movil   = pj.movil   AND rm.tipo_servicio = pj.tipo
    LEFT JOIN rit_zona  rz ON rz.zona_id = pj.zona_id AND rz.tipo_servicio = pj.tipo
  ) AS rr;
$fn$;

COMMENT ON FUNCTION demoras_aportes(integer, date) IS
  'Cuanto y desde cuando aporta cada movil activo a cada (zona, tipo). r_j = lo que tiene FUERA de la zona por su ritmo, mas el traslado de vuelta una sola vez; los pedidos que tiene DENTRO de la zona NO entran, son demanda de la zona y los cuenta demoras_cola. mu_j = p_j / ritmo, en pedidos por minuto. p_j reparte: cada transito se lleva dedicacion_transito, el conjunto de transitos se topea en transito_dedicacion_max_total achicandolos a prorrata, y las prioridades se reparten el resto -- asi la prioridad nunca baja de (1 - tope). Reemplaza a demoras_servidores.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto: sin
-- este REVOKE, anon/authenticated (las claves que viajan al browser) pueden
-- invocarla via RPC. Mismo patron que el resto de las funciones de esta
-- tanda (docs/sqls/2026-08-01-demoras-cola-v2.sql y las anteriores).
REVOKE EXECUTE ON FUNCTION demoras_aportes(integer, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_aportes(integer, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_aportes(integer, date) TO service_role;
