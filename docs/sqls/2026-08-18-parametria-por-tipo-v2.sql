-- ====================================================================
-- Parametria por (escenario, tipo_servicio) -- SEGUNDO INTENTO
-- Fecha: 2026-08-18 | Ver 2026-08-18-parametria-por-tipo-REVERTIDA.md
-- ====================================================================
-- El primer intento tiro el motor abajo: demoras_modelo la leen DIECISEIS
-- funciones, varias con subconsulta escalar, y solo se habia tocado el
-- orquestador. Esta version hace el trabajo completo y EN EL ORDEN CORRECTO:
--   1. Se capturan las salidas de las funciones de solo-lectura con el
--      codigo viejo y la fila unica (tablas _a_*).
--   2. Se reemplazan las QUINCE funciones adaptadas (todas las lecturas de
--      demoras_modelo quedan atadas a escenario Y tipo). La 16ta
--      (demoras_modelo_versionar) ya quedo per-tipo en el intento anterior,
--      y demoras_corrida_snapshot ya lee la fila URGENTE explicita.
--   3. Recien entonces se clonan NOCTURNO y SERVICE identicas a URGENTE.
--   4. Se recapturan las mismas salidas (_d_*) y se comparan con EXCEPT ALL.
--      Con filas identicas la salida DEBE ser byte a byte la misma: si un
--      solo byte difiere, RAISE EXCEPTION y la transaccion entera se
--      revierte sola -- el motor nunca ve el estado roto.
-- Todo esto es UNA transaccion (pg-meta: un POST = una transaccion).
-- La verificacion post-commit es forzar demoras_calcular_run() a mano
-- (leccion del incidente: nunca dar por buena una corrida anterior).
-- ====================================================================

-- --- 0. Una sola instantanea para TODA la transaccion: sin esto, entre
-- la foto ANTES y la DESPUES commitean pedidos reales y la comparacion da
-- falsos positivos (medido: 120 difs espurias en READ COMMITTED, 0 reales).
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- --- 1. Fotos ANTES (codigo viejo, una fila) ---
CREATE TEMP TABLE _a_demoras_aportes AS SELECT * FROM demoras_aportes(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _a_demoras_aportes_lab AS SELECT * FROM demoras_aportes_lab(1000, (now() AT TIME ZONE 'America/Montevideo')::date, 'MEDIANA', 'CASCADA');
CREATE TEMP TABLE _a_demoras_cola AS SELECT * FROM demoras_cola(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now());
CREATE TEMP TABLE _a_demoras_cola_detalle AS SELECT * FROM demoras_cola_detalle(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now());
CREATE TEMP TABLE _a_demoras_consumo_tramos AS SELECT * FROM demoras_consumo_tramos(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now());
CREATE TEMP TABLE _a_demoras_consumo_tramos_lab AS SELECT * FROM demoras_consumo_tramos_lab(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now(), 'MEDIANA', 'CASCADA');
CREATE TEMP TABLE _a_demoras_ritmo AS SELECT * FROM demoras_ritmo(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _a_demoras_ritmo_movil AS SELECT * FROM demoras_ritmo_movil(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _a_demoras_ritmo_niveles AS SELECT * FROM demoras_ritmo_niveles(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _a_demoras_ritmo_zona_lab AS SELECT * FROM demoras_ritmo_zona_lab(1000, (now() AT TIME ZONE 'America/Montevideo')::date);

-- --- 2. Las funciones adaptadas ---
-- ..... demoras_aportes .....
CREATE OR REPLACE FUNCTION public.demoras_aportes(p_escenario integer, p_fecha date)
 RETURNS TABLE(zona_id integer, tipo_servicio text, movil integer, es_transito boolean, p_j numeric, ritmo numeric, ritmo_origen text, carga_fuera integer, r_j numeric, mu_j numeric)
 LANGUAGE sql
 STABLE
AS $function$

  WITH cfg AS (

    -- Una fila de parametria POR TIPO: demoras_modelo tiene una fila por

    -- (escenario_id, tipo_servicio). El LEFT JOIN sobre VALUES garantiza que

    -- si falta la fila de un tipo, los defaults la mantienen viva y los JOIN

    -- de abajo no colapsan la funcion a cero filas (mismo motivo que las

    -- subconsultas escalares de antes).

    SELECT t.tipo_servicio,

           coalesce(dm.dedicacion_transito, 0.20)           AS ded,

           coalesce(dm.transito_dedicacion_max_total, 0.60) AS tope,

           coalesce(dm.traslado_fuera_zona_minutos, 15)     AS traslado,

           coalesce(dm.estadistico, 'MEDIANA')              AS estadistico,

           coalesce(dm.ritmo_default_minutos, 30)::numeric  AS ritmo_defecto

    FROM (VALUES ('URGENTE'), ('NOCTURNO'), ('SERVICE')) t(tipo_servicio)

    LEFT JOIN demoras_modelo dm

      ON dm.escenario_id = p_escenario AND dm.tipo_servicio = t.tipo_servicio

  ),

  asign AS (

    SELECT mz.zona_id, mz.tipo_de_servicio AS tipo, mz.movil_id::integer AS movil,

           (mz.prioridad_o_transito <> 1) AS es_transito

    FROM moviles_zonas mz

    JOIN moviles_dia md

      ON md.movil_id = mz.movil_id::integer AND md.escenario_id = mz.escenario_id AND md.fecha = p_fecha

    WHERE mz.escenario_id = p_escenario

      AND coalesce(mz.activa, true) AND md.activo
      AND coalesce(md.estado_nro, 0) <> 4

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

    FROM conteo c JOIN cfg cf ON cf.tipo_servicio = c.tipo

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

  -- Carga de CUALQUIER tipo, con su tipo normalizado a cuestas (C1): el

  -- movil es un solo camion y un service lo ocupa igual que un urgente, asi

  -- que todo entra aca -- pero para decidir mas abajo si un pedido IN-ZONE

  -- cuenta o no hace falta saber de que pool es. `pedidos` trae URGENTE y

  -- NOCTURNO exactos (cualquier otro servicio_nombre, ESPECIAL/OTROS

  -- incluidos, cae en 'OTRO': no pertenece a ningun pool, asi que nunca se

  -- excluye si esta in-zone -- sigue ocupando al movil igual que hoy).

  -- `services` es siempre SERVICE.

  --

  -- MATERIALIZED por el mismo motivo que rit_zona/rit_movil mas abajo: se

  -- lee desde adentro del primer LATERAL (cf_out), correlacionado por

  -- pj.movil/pj.zona_id/pj.tipo, y esta referenciada una sola vez -- sin

  -- forzar MATERIALIZED, Postgres la inlinea y el agregado sobre

  -- pedidos+services se recalcula una vez por fila de pj. Confirmado con

  -- EXPLAIN ANALYZE: sin MATERIALIZED, el plan mostraba "Seq Scan on

  -- pedidos (loops=900)" y "Seq Scan on services (loops=900)" -- no es

  -- hipotetico, es lo que salio en la corrida real contra el fixture de 100

  -- zonas x 3 tipos.

  carga_total AS MATERIALIZED (

    SELECT p.movil, p.zona_nro, p.tipo, count(*)::integer AS n

    FROM (

      SELECT movil, zona_nro,

             CASE upper(trim(coalesce(servicio_nombre,'')))

               WHEN 'NOCTURNO' THEN 'NOCTURNO'

               WHEN 'URGENTE'  THEN 'URGENTE'

               ELSE 'OTRO'

             END AS tipo

        FROM pedidos

       WHERE escenario = p_escenario AND estado_nro = 1

         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL

         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha

      UNION ALL

      SELECT movil, zona_nro, 'SERVICE' AS tipo

        FROM services

       WHERE escenario = p_escenario AND estado_nro = 1

         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL

         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha

    ) p

    GROUP BY p.movil, p.zona_nro, p.tipo

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

  JOIN cfg c ON c.tipo_servicio = pj.tipo

  -- cf_out: TODO lo que el movil tiene, salvo lo que ya cuenta demoras_cola

  -- como demanda de ESTA zona -- o sea lo in-zone del MISMO pool que pj.tipo

  -- (C1). Lo de otras zonas cuenta siempre, de cualquier tipo (r_j = "todo

  -- lo que lleva", spec seccion 2); lo in-zone de OTRO pool tambien cuenta

  -- (nadie mas lo contabiliza); solo lo in-zone del MISMO pool se excluye.

  -- El CASE replica el CTE `pool` de demoras_cola: URGENTE y NOCTURNO

  -- comparten pool, SERVICE va solo. Si pj.tipo no matchea ninguna rama

  -- (no deberia pasar: `asign` ya filtra a los tres tipos), el ELSE deja el

  -- array vacio -- no se excluye nada, el lado conservador.

  LEFT JOIN LATERAL (

    SELECT coalesce(sum(ct.n), 0) AS n

    FROM carga_total ct

    WHERE ct.movil = pj.movil

      AND NOT (

        ct.zona_nro = pj.zona_id

        AND ct.tipo = ANY (

          CASE pj.tipo

            WHEN 'URGENTE'  THEN ARRAY['URGENTE','NOCTURNO']

            WHEN 'NOCTURNO' THEN ARRAY['URGENTE','NOCTURNO']

            WHEN 'SERVICE'  THEN ARRAY['SERVICE']

            ELSE ARRAY[]::text[]

          END

        )

      )

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

$function$;

-- ..... demoras_aportes_lab .....
CREATE OR REPLACE FUNCTION public.demoras_aportes_lab(p_escenario integer, p_fecha date, p_estadistico text, p_nivel text)
 RETURNS TABLE(zona_id integer, tipo_servicio text, movil integer, es_transito boolean, p_j numeric, ritmo numeric, ritmo_origen text, carga_fuera integer, r_j numeric, mu_j numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- Una fila de parametria POR TIPO: demoras_modelo tiene una fila por
    -- (escenario_id, tipo_servicio); si falta la fila de un tipo, los
    -- defaults la mantienen viva y los JOIN de abajo no colapsan.
    SELECT t.tipo_servicio,
           coalesce(dm.dedicacion_transito, 0.20)           AS ded,
           coalesce(dm.transito_dedicacion_max_total, 0.60) AS tope,
           coalesce(dm.traslado_fuera_zona_minutos, 15)     AS traslado,
           p_estadistico                                    AS estadistico,
           coalesce(dm.ritmo_default_minutos, 30)::numeric  AS ritmo_defecto
    FROM (VALUES ('URGENTE'), ('NOCTURNO'), ('SERVICE')) t(tipo_servicio)
    LEFT JOIN demoras_modelo dm
      ON dm.escenario_id = p_escenario AND dm.tipo_servicio = t.tipo_servicio
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
  conteo AS (
    SELECT a.movil, a.tipo,
           count(*) FILTER (WHERE a.es_transito)::numeric     AS n_tra,
           count(*) FILTER (WHERE NOT a.es_transito)::numeric AS n_pri
    FROM asign a GROUP BY a.movil, a.tipo
  ),
  reparto AS (
    SELECT c.movil, c.tipo, c.n_tra, c.n_pri,
           least(c.n_tra * cf.ded, cf.tope) AS suma_tra
    FROM conteo c JOIN cfg cf ON cf.tipo_servicio = c.tipo
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
  -- MATERIALIZED en las tres CTEs de abajo por el mismo motivo medido en
  -- demoras_aportes (2m13s -> 605ms): se leen desde LATERALs correlacionados
  -- y sin MATERIALIZED se re-evaluan una vez por fila.
  carga_total AS MATERIALIZED (
    SELECT p.movil, p.zona_nro, p.tipo, count(*)::integer AS n
    FROM (
      SELECT movil, zona_nro,
             CASE upper(trim(coalesce(servicio_nombre,'')))
               WHEN 'NOCTURNO' THEN 'NOCTURNO'
               WHEN 'URGENTE'  THEN 'URGENTE'
               ELSE 'OTRO'
             END AS tipo
        FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil, zona_nro, 'SERVICE' AS tipo
        FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil, p.zona_nro, p.tipo
  ),
  rit_zona AS MATERIALIZED (
    SELECT r.zona_id AS z, r.tipo_servicio AS t, r.ritmo_media AS media, r.ritmo_mediana AS mediana, r.ritmo_p75 AS p75, r.ritmo_p90 AS p90
    FROM (SELECT 1 WHERE p_nivel IS DISTINCT FROM 'ZONA') g
    CROSS JOIN LATERAL demoras_ritmo(p_escenario, p_fecha) r
    UNION ALL
    SELECT z.zona_id, z.tipo_servicio, z.ritmo_media, z.ritmo_mediana, z.ritmo_p75, z.ritmo_p90
    FROM (SELECT 1 WHERE p_nivel = 'ZONA') g
    CROSS JOIN LATERAL demoras_ritmo_zona_lab(p_escenario, p_fecha) z
  ),
  -- Con p_nivel = 'ZONA' el generador esta vacio y demoras_ritmo_movil
  -- ni se invoca: cada movil cae al ritmo de su zona.
  rit_movil AS MATERIALIZED (
    SELECT m.movil AS mv, m.tipo_servicio AS t, m.ritmo_media AS media, m.ritmo_mediana AS mediana, m.ritmo_p75 AS p75, m.ritmo_p90 AS p90
    FROM (SELECT 1 WHERE p_nivel IS DISTINCT FROM 'ZONA') g
    CROSS JOIN LATERAL demoras_ritmo_movil(p_escenario, p_fecha) m
  )
  SELECT
    pj.zona_id, pj.tipo, pj.movil, pj.es_transito, pj.p_j,
    rr.ritmo, rr.origen,
    coalesce(cf_out.n, 0)::integer AS carga_fuera,
    CASE WHEN coalesce(cf_out.n, 0) = 0 THEN 0
         ELSE round(coalesce(cf_out.n,0) * rr.ritmo + c.traslado, 2) END AS r_j,
    CASE WHEN rr.ritmo > 0 THEN round(pj.p_j / rr.ritmo, 6) ELSE 0 END AS mu_j
  FROM pj
  JOIN cfg c ON c.tipo_servicio = pj.tipo
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(ct.n), 0) AS n
    FROM carga_total ct
    WHERE ct.movil = pj.movil
      AND NOT (
        ct.zona_nro = pj.zona_id
        AND ct.tipo = ANY (
          CASE pj.tipo
            WHEN 'URGENTE'  THEN ARRAY['URGENTE','NOCTURNO']
            WHEN 'NOCTURNO' THEN ARRAY['URGENTE','NOCTURNO']
            WHEN 'SERVICE'  THEN ARRAY['SERVICE']
            ELSE ARRAY[]::text[]
          END
        )
      )
  ) cf_out ON true
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        CASE c.estadistico WHEN 'MEDIA' THEN rm.media WHEN 'P75' THEN rm.p75
                           WHEN 'P90'  THEN rm.p90    ELSE rm.mediana END,
        CASE c.estadistico WHEN 'MEDIA' THEN rz.media WHEN 'P75' THEN rz.p75
                           WHEN 'P90'  THEN rz.p90    ELSE rz.mediana END,
        c.ritmo_defecto) AS ritmo,
      CASE
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rm.media WHEN 'P75' THEN rm.p75
                                 WHEN 'P90'  THEN rm.p90    ELSE rm.mediana END) IS NOT NULL THEN 'MOVIL'
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rz.media WHEN 'P75' THEN rz.p75
                                 WHEN 'P90'  THEN rz.p90    ELSE rz.mediana END) IS NOT NULL THEN 'ZONA'
        ELSE 'DEFECTO'
      END AS origen
    FROM (SELECT 1) x
    LEFT JOIN rit_movil rm ON rm.mv = pj.movil   AND rm.t = pj.tipo
    LEFT JOIN rit_zona  rz ON rz.z  = pj.zona_id AND rz.t = pj.tipo
  ) AS rr;
$function$;

-- ..... demoras_cola .....
CREATE OR REPLACE FUNCTION public.demoras_cola(p_escenario integer, p_fecha date, p_corrida_at timestamp with time zone)
 RETURNS TABLE(zona_id integer, tipo_servicio text, asignados integer, sin_asignar integer, atrapados integer, cola_efectiva numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- Una fila de parametria POR TIPO: cada fila de salida se ata a la fila
    -- de demoras_modelo de SU tipo_servicio. El LEFT JOIN conserva la
    -- degradacion a defaults si falta la fila de ese tipo.
    SELECT t.tipo,
           coalesce(dm.atrapados_modo, 'EXCLUIR')        AS atrapados_modo,
           coalesce(dm.asignados_modo, 'COMPLETO')       AS asignados_modo,
           coalesce(dm.peso_asignados, 0.5)              AS peso,
           coalesce(dm.ritmo_default_minutos, 30)::numeric AS ritmo_default
      FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = p_escenario
                                 AND dm.tipo_servicio = t.tipo
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
                        AND md.activo
                        AND coalesce(md.estado_nro, 0) <> 4)
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
    JOIN cfg c ON c.tipo = r.tipo
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
    JOIN cfg c     ON c.tipo = p.tipo_calculado
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
  FROM agg a JOIN cfg c ON c.tipo = a.tipo;
$function$;

-- ..... demoras_cola_detalle .....
CREATE OR REPLACE FUNCTION public.demoras_cola_detalle(p_escenario integer, p_fecha date, p_corrida_at timestamp with time zone)
 RETURNS TABLE(origen text, pedido_id bigint, zona_nro integer, tipo text, movil integer, es_asignado boolean, movil_activo boolean, asignado_desde timestamp with time zone, asignado_es_proxy boolean, minutos_desde_asignacion numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH sa AS (
    SELECT (SELECT es.pedidos_sa_minutos_antes
              FROM escenario_settings es
             WHERE es.escenario_id = p_escenario) AS mins
  ),
  crudo AS (
    -- OJO: la PK de pedidos/services se llama `id` (NO pedido_id: esa
    -- columna existe en metricas_cumplimiento, no aca).
    SELECT 'PEDIDO'::text AS org, p.id::bigint AS pid,
           p.zona_nro AS zn, p.movil AS mv, p.fch_hora_para AS fpara,
           p.fch_hora_asignado AS fasig, p.updated_at AS upd,
           CASE upper(trim(coalesce(p.servicio_nombre,'')))
             WHEN 'NOCTURNO' THEN 'NOCTURNO'
             WHEN 'URGENTE'  THEN 'URGENTE'
             ELSE NULL
           END AS tp
    FROM pedidos p
    WHERE p.escenario = p_escenario AND p.estado_nro = 1
      AND COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND p.zona_nro IS NOT NULL
    UNION ALL
    SELECT 'SERVICE', s.id::bigint,
           s.zona_nro, s.movil, s.fch_hora_para,
           s.fch_hora_asignado, s.updated_at, 'SERVICE'
    FROM services s
    WHERE s.escenario = p_escenario AND s.estado_nro = 1
      AND COALESCE(s.fch_para, (s.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND s.zona_nro IS NOT NULL
  ),
  visible AS (
    SELECT c.*
    FROM crudo c, sa
    WHERE c.tp IS NOT NULL
      AND (
        (c.mv IS NOT NULL AND c.mv <> 0)
        OR sa.mins IS NULL OR sa.mins = 0
        OR c.fpara IS NULL
        OR c.fpara <= p_corrida_at + (sa.mins * interval '1 minute')
      )
  )
  SELECT v.org, v.pid, v.zn, v.tp, v.mv,
         (v.mv IS NOT NULL AND v.mv <> 0) AS asignado,
         CASE WHEN v.mv IS NOT NULL AND v.mv <> 0 THEN
           EXISTS (SELECT 1 FROM moviles_dia md
                    WHERE md.escenario_id = p_escenario
                      AND md.movil_id     = v.mv
                      AND md.fecha        = p_fecha
                      AND md.activo
                      AND coalesce(md.estado_nro, 0) <> 4)
         ELSE false END AS activo,
         coalesce(v.fasig, v.upd) AS desde,
         (v.fasig IS NULL)        AS proxy,
         CASE WHEN coalesce(v.fasig, v.upd) IS NOT NULL
              THEN round((EXTRACT(EPOCH FROM (p_corrida_at - coalesce(v.fasig, v.upd))) / 60.0)::numeric, 2)
         END AS mins_desde
  FROM visible v;
$function$;

-- ..... demoras_consumo_tramos .....
CREATE OR REPLACE FUNCTION public.demoras_consumo_tramos(p_escenario integer, p_fecha date, p_corrida_at timestamp with time zone)
 RETURNS TABLE(zona_id integer, tipo_servicio text, demora_cruda numeric, moviles_considerados integer, cola_por_delante numeric, capacidad_inicial numeric, capacidad_final numeric, tramos integer, sin_capacidad boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  z        record;
  v_q      numeric;
  v_t      numeric;
  v_mu     numeric;
  v_proc   numeric;
  v_tramo  numeric;
  v_listo  boolean;
  v_i      integer;
BEGIN
  -- Parametria: demoras_modelo paso a tener UNA fila por (escenario_id,
  -- tipo_servicio), asi que ya NO se captura aca una sola vez por escenario
  -- (con tres filas ese SELECT INTO tomaba una fila arbitraria). Cada fila
  -- de salida toma max_minutos/factor_calibracion de la fila de SU tipo, via
  -- el LEFT JOIN a demoras_modelo (alias cfg) en la consulta del FOR de
  -- abajo; el LEFT JOIN conserva los defaults (120 / 1.0) si el escenario no
  -- tiene fila para ese tipo.

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
           coalesce(ev.mus, ARRAY[]::numeric[])     AS mus,
           coalesce(cfg.max_minutos, 120)::numeric  AS max_min,
           coalesce(cfg.factor_calibracion, 1.0)    AS factor
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
    -- Parametria de demoras_modelo atada al tipo de CADA fila de salida:
    -- una fila por (escenario_id, tipo_servicio).
    LEFT JOIN demoras_modelo cfg
           ON cfg.escenario_id = p_escenario AND cfg.tipo_servicio = u.tipo
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
        demora_cruda := round((v_t + v_q / v_mu) * z.factor, 2);
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
        demora_cruda  := z.max_min;
        sin_capacidad := true;
      ELSE
        demora_cruda  := round((v_t + v_q / v_mu) * z.factor, 2);
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
$function$;

-- ..... demoras_consumo_tramos_lab .....
CREATE OR REPLACE FUNCTION public.demoras_consumo_tramos_lab(p_escenario integer, p_fecha date, p_corrida_at timestamp with time zone, p_estadistico text, p_nivel text)
 RETURNS TABLE(zona_id integer, tipo_servicio text, demora_cruda numeric, moviles_considerados integer, cola_por_delante numeric, capacidad_inicial numeric, capacidad_final numeric, tramos integer, sin_capacidad boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  z        record;
  v_q      numeric;
  v_t      numeric;
  v_mu     numeric;
  v_proc   numeric;
  v_tramo  numeric;
  v_listo  boolean;
  v_i      integer;
BEGIN
  -- Parametria: demoras_modelo paso a tener UNA fila por (escenario_id,
  -- tipo_servicio), asi que max_minutos ya NO se captura aca una sola vez
  -- por escenario (con tres filas ese SELECT INTO tomaba una fila
  -- arbitraria). Cada fila de salida toma max_minutos de la fila de SU tipo,
  -- via el LEFT JOIN a demoras_modelo (alias cfg) en la consulta del FOR de
  -- abajo; el LEFT JOIN conserva el default (120) si el escenario no tiene
  -- fila para ese tipo.

  -- Mismos MATERIALIZED y columnas CALIFICADAS que el original: la
  -- funcion es plpgsql y sus OUT params se llaman zona_id/tipo_servicio,
  -- asi que una referencia sin calificar es ambigua y revienta en
  -- RUNTIME (el CREATE pasa sin ruido). Ver el comentario extenso del
  -- original.
  FOR z IN
    WITH ap AS MATERIALIZED (
      SELECT a.zona_id, a.tipo_servicio, a.r_j, a.mu_j
      FROM demoras_aportes_lab(p_escenario, p_fecha, p_estadistico, p_nivel) a
    ),
    ini AS (
      SELECT ap.zona_id, ap.tipo_servicio, sum(ap.mu_j) AS mu
      FROM ap WHERE ap.r_j <= 0
      GROUP BY ap.zona_id, ap.tipo_servicio
    ),
    tot AS (
      SELECT ap.zona_id, ap.tipo_servicio, count(*) AS n
      FROM ap GROUP BY ap.zona_id, ap.tipo_servicio
    ),
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
    SELECT u.zona_id, u.tipo,
           coalesce(q.cola_efectiva, 0)             AS cola,
           coalesce(ini.mu, 0)                      AS mu_inicial,
           coalesce(tot.n, 0)                       AS n_moviles,
           coalesce(ev.rs,  ARRAY[]::numeric[])     AS rs,
           coalesce(ev.mus, ARRAY[]::numeric[])     AS mus,
           coalesce(cfg.max_minutos, 120)::numeric  AS max_min
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
    -- Parametria de demoras_modelo atada al tipo de CADA fila de salida:
    -- una fila por (escenario_id, tipo_servicio).
    LEFT JOIN demoras_modelo cfg
           ON cfg.escenario_id = p_escenario AND cfg.tipo_servicio = u.tipo
  LOOP
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

      IF v_mu > 0 AND v_q <= v_proc THEN
        demora_cruda := v_t + v_q / v_mu;
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
        demora_cruda  := z.max_min;
        sin_capacidad := true;
      ELSE
        demora_cruda  := v_t + v_q / v_mu;
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
$function$;

-- ..... demoras_ritmo .....
CREATE OR REPLACE FUNCTION public.demoras_ritmo(p_escenario integer, p_hasta date)
 RETURNS TABLE(zona_id integer, tipo_servicio text, ritmo_media numeric, ritmo_mediana numeric, ritmo_p75 numeric, ritmo_p90 numeric, ritmo_origen text, ritmo_muestras integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- Defaults defensivos: si falta la fila del escenario, la funcion tiene
    -- que seguir devolviendo algo razonable en vez de colapsar a cero filas.
    -- Una fila por tipo_servicio: cada fila de salida lee la parametria de
    -- la fila de demoras_modelo de SU tipo.
    SELECT x.tipo,
           coalesce(dm.ritmo_dias_ventana, 7)          AS dias,
           coalesce(dm.ritmo_min_muestras, 5)          AS min_muestras,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)    AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)     AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)     AS solo_con_cola
      FROM (SELECT p_escenario AS e, unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e AND dm.tipo_servicio = x.tipo
  ),
  universo AS (
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  base AS (
    SELECT m.zona_nro, m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
    WHERE m.tipo = c.tipo  -- cada tipo usa las muestras calculadas con SU parametria
  ),
  -- ↓↓↓ COPIADO TEXTUAL desde `por_zona AS (` hasta el cierre de
  --     `elegido AS (...)` de docs/sqls/2026-07-30-demoras-ritmo-cascada.sql
  --     (lineas 121-363). Unico cambio: en `elegido`, las dos apariciones
  --     de `p_min_muestras` en el ORDER BY pasan a
  --     `(SELECT cf.min_muestras FROM cfg cf WHERE cf.tipo = candidatos.tipo)`. El resto, comentarios incluidos,
  --     es identico al original.
  por_zona AS (
    SELECT zona_nro AS zona_id, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY zona_nro, tipo
  ),
  global AS (
    SELECT tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY tipo
  ),
  por_movil AS (
    -- Ritmo propio de un movil: estadisticas de demora_efectiva_mins de
    -- los pedidos que llevo, sin importar la zona.
    SELECT movil, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base
    WHERE movil IS NOT NULL
    GROUP BY movil, tipo
  ),
  chofer_top_por_movil AS (
    -- El chofer que mas veces manejo cada movil en la ventana. Empate:
    -- orden alfabetico, determinista.
    SELECT DISTINCT ON (movil) movil, chofer
    FROM (
      SELECT movil, chofer, count(*) AS n
      FROM base
      WHERE movil IS NOT NULL AND chofer IS NOT NULL
      GROUP BY movil, chofer
    ) c
    ORDER BY movil, n DESC, chofer
  ),
  por_chofer AS (
    -- Ritmo propio de un chofer: no depende de la zona ni del movil que
    -- este manejando en el momento de la consulta.
    SELECT chofer, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base
    WHERE chofer IS NOT NULL
    GROUP BY chofer, tipo
  ),
  -- ─── Aporte de cada movil a cada (zona, tipo) ────────────────────────
  -- Replica el prorrateo de demoras_capacidad (peso 1 prioridad / alpha
  -- transito, normalizado por movil dentro de cada tipo).
  alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3) AS a
  ),
  asign AS (
    SELECT mz.movil_id::integer AS movil,
           mz.zona_id,
           mz.tipo_de_servicio  AS tipo,
           CASE WHEN mz.prioridad_o_transito = 1 THEN 1::numeric ELSE (SELECT a FROM alpha) END AS peso
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id     = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha        = p_hasta
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  aporte AS (
    -- peso_norm puede dar 0 (alpha=0 y el movil es transito puro): el
    -- movil sigue "presente" en la zona pero sin aportar peso real. Los
    -- niveles CHOFER/MOVIL de abajo excluyen expresamente estas filas de
    -- `n`, no solo de las estadisticas (Important 4).
    SELECT movil, zona_id, tipo,
           CASE WHEN w > 0 THEN peso / w ELSE 0 END AS peso_norm
    FROM (
      SELECT a.*, sum(a.peso) OVER (PARTITION BY a.movil, a.tipo) AS w
      FROM asign a
    ) p
  ),
  -- ─── Nivel MOVIL: promedio ponderado del ritmo propio de cada movil ──
  -- El FILTER exige peso_norm>0 (aporte real, no solo "esta asignado") Y
  -- pm.n>0 (el movil tiene ritmo propio calculable). Sin el primero,
  -- un movil con peso 0 puede inflar `n` sin aportar nada al blend
  -- (Important 4).
  por_zona_movil AS (
    SELECT ap.zona_id, ap.tipo,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.media)   FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS media,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.mediana) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS mediana,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.p75)     FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS p75,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.p90)     FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS p90,
           coalesce(sum(pm.n) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 0)::integer AS n
    FROM aporte ap
    LEFT JOIN por_movil pm ON pm.movil = ap.movil AND pm.tipo = ap.tipo
    GROUP BY ap.zona_id, ap.tipo
  ),
  -- ─── Nivel CHOFER: promedio ponderado del ritmo propio del chofer de
  -- cada movil ───────────────────────────────────────────────────────
  movil_chofer AS (
    -- Cada movil de la zona x tipo, resuelto a su chofer top y al ritmo
    -- propio de ese chofer.
    SELECT ap.zona_id, ap.tipo, ap.movil, ap.peso_norm,
           ctm.chofer,
           pc.media   AS chofer_media,
           pc.mediana AS chofer_mediana,
           pc.p75     AS chofer_p75,
           pc.p90     AS chofer_p90,
           pc.n       AS chofer_n
    FROM aporte ap
    LEFT JOIN chofer_top_por_movil ctm ON ctm.movil = ap.movil
    LEFT JOIN por_chofer pc ON pc.chofer = ctm.chofer AND pc.tipo = ap.tipo
  ),
  zona_chofer AS (
    -- Un mismo chofer puede manejar mas de un movil de la zona (flota
    -- tercerizada: metricas_cumplimiento.chofer es texto libre del
    -- AS400, se repite entre camiones de la misma fletera). Se suman
    -- los pesos que le corresponden a traves de los moviles que lo
    -- referencian (aportes reales, distintos), pero sus MUESTRAS
    -- (chofer_n) se cuentan UNA sola vez: es el mismo historial del
    -- chofer, no uno distinto por cada movil (Important 3).
    SELECT zona_id, tipo, chofer,
           sum(peso_norm)             AS peso_chofer,
           max(chofer_media)          AS media,
           max(chofer_mediana)        AS mediana,
           max(chofer_p75)            AS p75,
           max(chofer_p90)            AS p90,
           max(coalesce(chofer_n,0))  AS n
    FROM movil_chofer
    WHERE chofer IS NOT NULL AND chofer_n > 0
    GROUP BY zona_id, tipo, chofer
  ),
  por_zona_chofer AS (
    -- Mismo FILTER por peso_chofer>0 que MOVIL: un chofer cuyos moviles
    -- aportaron peso 0 (alpha=0, transito puro) no debe ganar la
    -- cascada con estadisticas NULL (Important 4).
    SELECT zona_id, tipo,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * media)   FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS media,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * mediana) FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS mediana,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * p75)     FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS p75,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * p90)     FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS p90,
           coalesce(sum(n) FILTER (WHERE peso_chofer > 0), 0)::integer AS n
    FROM zona_chofer
    GROUP BY zona_id, tipo
  ),
  -- ─── Orden de la cascada por (escenario, tipo) ───────────────────────
  -- Se parsea, se filtra a niveles validos (CHOFER, MOVIL, ZONA, GLOBAL)
  -- preservando el orden de aparicion; si no queda NINGUNO valido (falta
  -- la fila de config, lista vacia, o basura como 'FRUTA,,XX') cae al
  -- default completo. GLOBAL se saca de la posicion en que haya venido
  -- (si vino) y se reagrega UNA sola vez al final: es la red final,
  -- nunca se pierde ni se cuenta dos veces, y una lista de solo 'GLOBAL'
  -- es una configuracion valida en si misma (no dispara el fallback a
  -- default: 'GLOBAL' no es una lista vacia/mal formada).
  cascada_cruda AS (
    SELECT dc.tipo_servicio AS tipo, trim(u.lvl) AS lvl, u.ord
    FROM demoras_config dc,
         LATERAL unnest(string_to_array(upper(coalesce(dc.ritmo_cascada,'')), ',')) WITH ORDINALITY AS u(lvl, ord)
    WHERE dc.escenario_id = p_escenario
  ),
  cascada_valida AS (
    SELECT tipo, array_agg(lvl ORDER BY ord) AS niveles
    FROM cascada_cruda
    WHERE lvl IN ('CHOFER','MOVIL','ZONA','GLOBAL')
    GROUP BY tipo
  ),
  cascada AS (
    SELECT t.tipo,
           array_remove(coalesce(cv.niveles, ARRAY['CHOFER','MOVIL','ZONA','GLOBAL']), 'GLOBAL')
             || ARRAY['GLOBAL'] AS niveles
    FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
    LEFT JOIN cascada_valida cv ON cv.tipo = t.tipo
  ),
  -- ─── Expandir universo x niveles y elegir el primero que alcance
  -- p_min_muestras (GLOBAL, siempre presente al final, es la red final
  -- aunque tampoco llegue al minimo) ─────────────────────────────────
  candidatos AS (
    SELECT u.zona_id, u.tipo, lv.ord, lv.nivel,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.media
             WHEN 'MOVIL'  THEN pzm.media
             WHEN 'ZONA'   THEN pz.media
             ELSE g.media
           END AS media,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.mediana
             WHEN 'MOVIL'  THEN pzm.mediana
             WHEN 'ZONA'   THEN pz.mediana
             ELSE g.mediana
           END AS mediana,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.p75
             WHEN 'MOVIL'  THEN pzm.p75
             WHEN 'ZONA'   THEN pz.p75
             ELSE g.p75
           END AS p75,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.p90
             WHEN 'MOVIL'  THEN pzm.p90
             WHEN 'ZONA'   THEN pz.p90
             ELSE g.p90
           END AS p90,
           coalesce(CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.n
             WHEN 'MOVIL'  THEN pzm.n
             WHEN 'ZONA'   THEN pz.n
             ELSE g.n
           END, 0) AS n
    FROM universo u
    JOIN cascada c ON c.tipo = u.tipo
    CROSS JOIN LATERAL unnest(c.niveles) WITH ORDINALITY AS lv(nivel, ord)
    LEFT JOIN por_zona_chofer pzc ON pzc.zona_id = u.zona_id AND pzc.tipo = u.tipo
    LEFT JOIN por_zona_movil  pzm ON pzm.zona_id = u.zona_id AND pzm.tipo = u.tipo
    LEFT JOIN por_zona        pz  ON pz.zona_id  = u.zona_id AND pz.tipo  = u.tipo
    LEFT JOIN global          g   ON g.tipo      = u.tipo
  ),
  elegido AS (
    -- Gana el de menor ord entre los que llegan al minimo; si ninguno
    -- llega, gana el de mayor ord (GLOBAL, siempre el ultimo).
    SELECT DISTINCT ON (zona_id, tipo)
           zona_id, tipo, nivel, media, mediana, p75, p90, n
    FROM candidatos
    ORDER BY zona_id, tipo,
             (n >= (SELECT cf.min_muestras FROM cfg cf WHERE cf.tipo = candidatos.tipo)) DESC,
             CASE WHEN n >= (SELECT cf.min_muestras FROM cfg cf WHERE cf.tipo = candidatos.tipo) THEN ord ELSE -ord END ASC
  )
  SELECT zona_id, tipo, media, mediana, p75, p90, nivel, n
  FROM elegido;
$function$;

-- ..... demoras_ritmo_movil .....
CREATE OR REPLACE FUNCTION public.demoras_ritmo_movil(p_escenario integer, p_hasta date)
 RETURNS TABLE(movil integer, tipo_servicio text, ritmo_media numeric, ritmo_mediana numeric, ritmo_p75 numeric, ritmo_p90 numeric, ritmo_origen text, ritmo_muestras integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- Spine de tipos + LEFT JOIN (ya no subconsultas escalares: con una fila
    -- por (escenario_id, tipo_servicio) en demoras_modelo devolverian mas de
    -- una fila). Si falta la fila del escenario o de un tipo, el LEFT JOIN
    -- deja la fila del spine con defaults: los JOIN de abajo no colapsan la
    -- funcion a cero filas. Mismo patron defensivo que demoras_cola y
    -- demoras_ritmo v2, abierto por tipo.
    SELECT t.tipo,
           coalesce(dm.ritmo_dias_ventana, 7)           AS dias,
           coalesce(dm.ritmo_min_muestras, 5)           AS min_muestras,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)     AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)      AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)      AS solo_con_cola
      FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = p_escenario
                                 AND dm.tipo_servicio = t.tipo
  ),
  base AS (
    SELECT m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
    WHERE m.movil IS NOT NULL
      AND m.tipo = c.tipo  -- cada tipo usa las muestras calculadas con SU parametria
  ),
  -- Estadisticas propias del movil.
  por_movil AS (
    SELECT b.movil, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b
    GROUP BY b.movil, b.tipo
  ),
  -- El chofer que mas veces manejo cada movil en la ventana. Empate:
  -- alfabetico, para que el resultado sea reproducible.
  chofer_top AS (
    SELECT DISTINCT ON (movil, tipo) movil, tipo, chofer
    FROM (
      SELECT b.movil, b.tipo, b.chofer, count(*) AS n
      FROM base b WHERE b.chofer IS NOT NULL
      GROUP BY b.movil, b.tipo, b.chofer
    ) c
    ORDER BY movil, tipo, n DESC, chofer
  ),
  -- Estadisticas propias del chofer, sin importar que movil manejo.
  por_chofer AS (
    SELECT b.chofer, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b WHERE b.chofer IS NOT NULL
    GROUP BY b.chofer, b.tipo
  ),
  -- Cascada por TIPO, leida de demoras_config.ritmo_cascada -- la MISMA
  -- fuente que demoras_ritmo (ver el header de este archivo). Se filtra a
  -- CHOFER/MOVIL (los unicos niveles que aplican a un movil suelto); si
  -- para ese tipo no queda ninguno valido (falta la fila, lista vacia o
  -- basura), cae al default CHOFER,MOVIL.
  cascada_cruda AS (
    SELECT dc.tipo_servicio AS tipo, trim(u.lvl) AS lvl, u.ord
    FROM demoras_config dc,
         LATERAL unnest(string_to_array(upper(coalesce(dc.ritmo_cascada,'')), ',')) WITH ORDINALITY AS u(lvl, ord)
    WHERE dc.escenario_id = p_escenario
  ),
  niveles AS (
    SELECT t.tipo,
           coalesce(
             nullif(array_agg(cc.lvl ORDER BY cc.ord) FILTER (WHERE cc.lvl IN ('CHOFER','MOVIL')), '{}'),
             ARRAY['CHOFER','MOVIL']) AS lista
    FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
    LEFT JOIN cascada_cruda cc ON cc.tipo = t.tipo
    GROUP BY t.tipo
  ),
  candidatos AS (
    SELECT pm.movil, pm.tipo, lv.ord, lv.nivel,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.media   ELSE pm.media   END AS media,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.mediana ELSE pm.mediana END AS mediana,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p75     ELSE pm.p75     END AS p75,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p90     ELSE pm.p90     END AS p90,
           coalesce(CASE lv.nivel WHEN 'CHOFER' THEN pc.n ELSE pm.n END, 0) AS n
    FROM por_movil pm
    JOIN niveles nv ON nv.tipo = pm.tipo
    CROSS JOIN LATERAL unnest(nv.lista) WITH ORDINALITY AS lv(nivel, ord)
    LEFT JOIN chofer_top ct ON ct.movil = pm.movil AND ct.tipo = pm.tipo
    LEFT JOIN por_chofer pc ON pc.chofer = ct.chofer AND pc.tipo = pm.tipo
  )
  -- Gana el primer nivel que llegue al minimo. Si NINGUNO llega, el movil no
  -- devuelve fila y el llamador cae al ritmo de la zona.
  SELECT DISTINCT ON (c.movil, c.tipo)
         c.movil, c.tipo, c.media, c.mediana, c.p75, c.p90, c.nivel, c.n
  FROM candidatos c
  JOIN cfg ON cfg.tipo = c.tipo
  WHERE c.n >= cfg.min_muestras
  ORDER BY c.movil, c.tipo, c.ord;
$function$;

-- ..... demoras_ritmo_niveles .....
CREATE OR REPLACE FUNCTION public.demoras_ritmo_niveles(p_escenario integer, p_hasta date)
 RETURNS TABLE(nivel text, clave text, tipo text, media numeric, mediana numeric, p75 numeric, p90 numeric, muestras integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- TRANSITORIO: parametria global del muestreo (alimenta UNA sola llamada
    -- a demoras_ritmo_muestras, sin nocion de tipo de servicio); pinneada a
    -- la fila 'URGENTE' de demoras_modelo hasta que esta captura se abra
    -- por tipo_servicio.
    SELECT coalesce(dm.ritmo_dias_ventana, 7)           AS dias,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)     AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)      AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)      AS solo_con_cola
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
                                 AND dm.tipo_servicio = 'URGENTE'
  ),
  base AS MATERIALIZED (
    SELECT m.zona_nro, m.tipo AS tp, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
  )
  SELECT 'ZONA', b.zona_nro::text, b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b WHERE b.zona_nro IS NOT NULL GROUP BY b.zona_nro, b.tp
  UNION ALL
  SELECT 'MOVIL', b.movil::text, b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b WHERE b.movil IS NOT NULL GROUP BY b.movil, b.tp
  UNION ALL
  SELECT 'CHOFER', b.chofer, b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b WHERE b.chofer IS NOT NULL GROUP BY b.chofer, b.tp
  UNION ALL
  SELECT 'GLOBAL', '', b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b GROUP BY b.tp;
$function$;

-- ..... demoras_ritmo_zona_lab .....
CREATE OR REPLACE FUNCTION public.demoras_ritmo_zona_lab(p_escenario integer, p_hasta date)
 RETURNS TABLE(zona_id integer, tipo_servicio text, ritmo_media numeric, ritmo_mediana numeric, ritmo_p75 numeric, ritmo_p90 numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- TRANSITORIO: parametria global del muestreo (alimenta UNA sola llamada
    -- a demoras_ritmo_muestras, sin nocion de tipo de servicio); pinneada a
    -- la fila 'URGENTE' de demoras_modelo hasta que esta captura se abra
    -- por tipo_servicio.
    SELECT coalesce(dm.ritmo_dias_ventana, 7)           AS dias,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)     AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)      AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)      AS solo_con_cola
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
                                 AND dm.tipo_servicio = 'URGENTE'
  ),
  cfg_tipo AS (
    -- min_muestras por tipo de servicio: cada fila de salida usa el de la
    -- fila de demoras_modelo de SU tipo (default defensivo si falta la fila).
    SELECT t.tipo,
           coalesce(dm.ritmo_min_muestras, 5)           AS min_muestras
      FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = p_escenario
                                 AND dm.tipo_servicio = t.tipo
  ),
  base AS (
    SELECT m.zona_nro, m.tipo, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
  ),
  por_zona AS (
    SELECT b.zona_nro, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b GROUP BY b.zona_nro, b.tipo
  ),
  global AS (
    SELECT b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90
    FROM base b GROUP BY b.tipo
  ),
  -- El universo es el mismo que el de demoras_ritmo: las zonas x tipo
  -- con oferta activa. Una zona sin muestras propias igual devuelve
  -- fila, con el global.
  universo AS (
    SELECT DISTINCT mz.zona_id AS z, mz.tipo_de_servicio AS t
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  )
  SELECT u.z, u.t,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.media   ELSE g.media   END,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.mediana ELSE g.mediana END,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.p75     ELSE g.p75     END,
         CASE WHEN coalesce(pz.n, 0) >= c.min_muestras THEN pz.p90     ELSE g.p90     END
  FROM universo u
  JOIN cfg_tipo c ON c.tipo = u.t
  LEFT JOIN por_zona pz ON pz.zona_nro = u.z AND pz.tipo = u.t
  LEFT JOIN global   g  ON g.tipo = u.t;
$function$;

-- ..... demoras_proximo_hueco .....
CREATE OR REPLACE FUNCTION public.demoras_proximo_hueco(p_escenario integer, p_fecha date, p_corrida_at timestamp with time zone)
 RETURNS TABLE(zona_id integer, tipo_servicio text, demora_cruda numeric, moviles_considerados integer, libre_primero numeric, cola_por_delante integer, ritmo_aplicado numeric, sin_capacidad boolean)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  z            record;
  v_libres     numeric[];
  v_ritmos     numeric[];
  v_n          integer;
  v_i          integer;
  v_k          integer;
  v_idx        integer;
  v_min        numeric;
  v_espera     numeric;
  v_ritmo_sel  numeric;
  v_demora     numeric;
BEGIN
  FOR z IN
    -- El universo sale de moviles_zonas, NO de los servidores: una zona con
    -- pedidos y CERO moviles activos (el peor caso operativo, y a las 07:00
    -- la mayoria) tiene que devolver fila igual, con sin_capacidad=true.
    -- Si saliera de los servidores, desapareceria sin dejar nada que auditar.
    SELECT u.zona_id, u.tipo,
           coalesce(s.libres, ARRAY[]::numeric[]) AS libres,
           coalesce(s.ritmos, ARRAY[]::numeric[]) AS ritmos,
           coalesce(q.cola_efectiva, 0)           AS cola,
           -- Parametria del tipo de ESTA fila: demoras_modelo tiene una
           -- fila por (escenario_id, tipo_servicio), cada tipo usa la suya.
           coalesce(dm.max_minutos, 120)::numeric      AS max_min,
           coalesce(dm.factor_calibracion, 1.0)        AS factor,
           coalesce(dm.incluir_entrega_propia, true)   AS incluir_entrega
    FROM (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
      FROM moviles_zonas mz
      WHERE mz.escenario_id = p_escenario
        AND coalesce(mz.activa, true)
        AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ) u
    LEFT JOIN (
      -- Una sola pasada: los servidores de TODAS las zonas se agregan a
      -- arrays de una, y el loop de abajo solo toca memoria.
      SELECT sv.zona_id, sv.tipo_servicio AS tipo,
             array_agg(sv.libre_en ORDER BY sv.movil) AS libres,
             array_agg(sv.ritmo    ORDER BY sv.movil) AS ritmos
      FROM demoras_servidores(p_escenario, p_fecha) sv
      WHERE NOT sv.descartado
      GROUP BY sv.zona_id, sv.tipo_servicio
    ) s ON s.zona_id = u.zona_id AND s.tipo = u.tipo
    LEFT JOIN demoras_cola(p_escenario, p_fecha, p_corrida_at) q
           ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo
    LEFT JOIN demoras_modelo dm
           ON dm.escenario_id = p_escenario AND dm.tipo_servicio = u.tipo
  LOOP
    v_libres := z.libres;
    v_ritmos := z.ritmos;
    v_n      := coalesce(array_length(v_libres, 1), 0);

    IF v_n = 0 THEN
      -- Sin nadie trabajando la zona, la respuesta honesta a "cuanto
      -- demora" no es "poco": un pedido que entre ahora no tiene quien lo
      -- atienda. Se informa el techo, y la bandera deja constancia de que
      -- ese numero salio de una definicion y no de un calculo (el endpoint
      -- de comparativa lo usa para excluir estas filas de la calibracion).
      zona_id              := z.zona_id;
      tipo_servicio        := z.tipo;
      demora_cruda         := z.max_min;
      moviles_considerados := 0;
      libre_primero        := NULL;
      cola_por_delante     := z.cola;
      ritmo_aplicado       := NULL;
      sin_capacidad        := true;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- El mejor tiempo de liberacion ANTES de repartir la cola. Se devuelve
    -- para poder auditar cuanto de la demora es cola y cuanto es el trabajo
    -- que los moviles ya tenian encima.
    SELECT min(x) INTO libre_primero FROM unnest(v_libres) AS x;

    -- Reparto de la cola: cada pedido al que se libera primero. A igual
    -- libre_en, gana el de MENOR ritmo (entrega antes), no el primero del
    -- array. El empate no es una rareza: al arranque del dia TODOS los
    -- moviles activos estan en libre_en = 0, asi que el empate es la
    -- situacion NORMAL, y "el primero del array" (que hoy es el de
    -- movil_id mas bajo, por el ORDER BY del array_agg de mas arriba) no es
    -- una decision de nadie -- es un efecto lateral del orden de lectura.
    -- El segundo criterio usa "<" ESTRICTO, no "<=": si tambien empatan en
    -- ritmo, el resultado tiene que seguir siendo determinista, y el orden
    -- estable del array_agg ya alcanza para eso.
    FOR v_k IN 1 .. z.cola LOOP
      v_idx := 1;
      v_min := v_libres[1];
      FOR v_i IN 2 .. v_n LOOP
        IF v_libres[v_i] < v_min
           OR (v_libres[v_i] = v_min AND v_ritmos[v_i] < v_ritmos[v_idx]) THEN
          v_min := v_libres[v_i];
          v_idx := v_i;
        END IF;
      END LOOP;
      v_libres[v_idx] := v_libres[v_idx] + v_ritmos[v_idx];
    END LOOP;

    -- El pedido nuevo va al que quede libre primero. Mismo criterio de
    -- desempate que el reparto de arriba (menor ritmo, "<" estricto): si
    -- los dos barridos usaran reglas distintas, el reparto y la ubicacion
    -- del pedido nuevo se contradirian entre si.
    v_idx := 1;
    v_min := v_libres[1];
    FOR v_i IN 2 .. v_n LOOP
      IF v_libres[v_i] < v_min
         OR (v_libres[v_i] = v_min AND v_ritmos[v_i] < v_ritmos[v_idx]) THEN
        v_min := v_libres[v_i];
        v_idx := v_i;
      END IF;
    END LOOP;

    v_espera    := v_min;
    v_ritmo_sel := v_ritmos[v_idx];

    -- El cliente tiene la garrafa cuando el movil se la lleva, no cuando el
    -- movil arranca. incluir_entrega_propia=false deja la demora en la pura
    -- espera, para poder medir las dos definiciones en el backtest.
    v_demora := v_espera + CASE WHEN z.incluir_entrega THEN v_ritmo_sel ELSE 0 END;

    zona_id              := z.zona_id;
    tipo_servicio        := z.tipo;
    demora_cruda         := round(v_demora * z.factor, 2);
    moviles_considerados := v_n;
    cola_por_delante     := z.cola;
    ritmo_aplicado       := v_ritmo_sel;
    sin_capacidad        := false;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ..... demoras_servidores .....
CREATE OR REPLACE FUNCTION public.demoras_servidores(p_escenario integer, p_fecha date)
 RETURNS TABLE(zona_id integer, tipo_servicio text, movil integer, carga integer, ritmo numeric, ritmo_origen text, libre_en numeric, es_transito boolean, descartado boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH cfg AS (
    -- Una fila de parametria POR TIPO: demoras_modelo tiene PK
    -- (escenario_id, tipo_servicio) y cada (zona, tipo) usa la de SU tipo.
    -- transito_modo/transito_castigo_minutos/transito_margen_minutos se
    -- retiraron de la tabla el 2026-08-01 (docs/sqls/2026-08-01-demoras-
    -- modelo-tramos.sql, baja de PROXIMO_HUECO): quedan fijados a los
    -- defaults que ya tenia el coalesce (la funcion venia rota por esas
    -- columnas; con NULL en ellas el resultado era exactamente este).
    SELECT t.tipo                                              AS tipo,
           'SOLO_SI_NO_HAY'::text                              AS modo,
           20::numeric                                         AS castigo,
           15::numeric                                         AS margen,
           coalesce(dm.estadistico, 'MEDIANA')                AS estadistico,
           coalesce(dm.ritmo_default_minutos, 30)::numeric    AS ritmo_defecto
      FROM (VALUES ('URGENTE'),('NOCTURNO'),('SERVICE')) t(tipo)
      LEFT JOIN demoras_modelo dm
             ON dm.escenario_id = p_escenario AND dm.tipo_servicio = t.tipo
  ),
  alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3)::numeric AS a
  ),
  -- Moviles ACTIVOS con asignacion vigente a cada (zona, tipo).
  asign AS (
    SELECT mz.zona_id,
           mz.tipo_de_servicio AS tipo,
           mz.movil_id::integer AS movil,
           (mz.prioridad_o_transito <> 1) AS es_transito
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id     = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha        = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  -- Carga real de cada movil: pendientes asignados en TODAS las zonas y de
  -- TODOS los tipos -- SIN filtrar servicio_nombre, a diferencia de
  -- demoras_cola y demoras_ritmo_muestras, que SI excluyen ESPECIAL/OTROS.
  -- Es DELIBERADO, no la ausencia por omision del mismo filtro (Important 4,
  -- review final): ESPECIAL/OTROS no tienen oferta propia en moviles_zonas,
  -- asi que no son DEMANDA de ninguna zona (por eso demoras_cola los saca de
  -- la cola). Pero SI son TRABAJO real que ocupa al movil -- el camion que
  -- entrega un ESPECIAL en otra zona no esta disponible mientras tanto, ni
  -- mas ni menos que si llevara un URGENTE -- y libre_en necesita saber
  -- CUANDO queda libre, no de que tipo es lo que lo ocupa. Contarlos aca es
  -- lo mismo que ya hace esta carga con el trabajo de OTRAS zonas: hace
  -- falta contarlo para saber cuando el movil se libera, aunque no compita
  -- por el pedido nuevo. Un asignado cuenta siempre (regla canonica de la
  -- ventana SA), asi que aca no hay filtro horario.
  carga_movil AS (
    SELECT p.movil, count(*)::integer AS n
    FROM (
      SELECT movil FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil
  ),
  -- Ritmo de la ZONA: el blend ponderado de toda la cascada. Es el fallback
  -- para un movil sin historial propio.
  rit_zona AS (
    SELECT r.zona_id, r.tipo_servicio, r.ritmo_media, r.ritmo_mediana,
           r.ritmo_p75, r.ritmo_p90
    FROM demoras_ritmo(p_escenario, p_fecha) r
  ),
  -- Ritmo PROPIO de cada movil. Es el que manda: el pedido nuevo va al que
  -- se libera primero, y sin ritmo por movil dos moviles solo se
  -- diferenciarian por cuantos pedidos llevan.
  rit_movil AS (
    SELECT m.movil, m.tipo_servicio, m.ritmo_media, m.ritmo_mediana,
           m.ritmo_p75, m.ritmo_p90
    FROM demoras_ritmo_movil(p_escenario, p_fecha) m
  ),
  crudo AS (
    SELECT a.zona_id, a.tipo, a.movil, a.es_transito,
           coalesce(cm.n, 0) AS carga,
           -- Cascada de tres pasos, en este orden:
           --   1. El ritmo PROPIO del movil (chofer o movil, segun resolvio
           --      demoras_ritmo_movil).
           --   2. Si no tiene historial propio, el de la ZONA (blend).
           --   3. Si la zona tampoco tiene, el piso configurado.
           -- El piso no es opcional: con ritmo NULL, libre_en seria NULL y el
           -- movil desapareceria de la simulacion sin dejar rastro.
           coalesce(
             CASE c.estadistico
               WHEN 'MEDIA' THEN rm.ritmo_media
               WHEN 'P75'   THEN rm.ritmo_p75
               WHEN 'P90'   THEN rm.ritmo_p90
               ELSE rm.ritmo_mediana
             END,
             CASE c.estadistico
               WHEN 'MEDIA' THEN rz.ritmo_media
               WHEN 'P75'   THEN rz.ritmo_p75
               WHEN 'P90'   THEN rz.ritmo_p90
               ELSE rz.ritmo_mediana
             END,
             c.ritmo_defecto) AS ritmo,
           -- De donde salio el ritmo de ESTE movil. Sin esto no se puede
           -- contestar "por que este movil se libera antes que el otro".
           CASE
             WHEN (CASE c.estadistico
                     WHEN 'MEDIA' THEN rm.ritmo_media
                     WHEN 'P75'   THEN rm.ritmo_p75
                     WHEN 'P90'   THEN rm.ritmo_p90
                     ELSE rm.ritmo_mediana END) IS NOT NULL THEN 'MOVIL'
             WHEN (CASE c.estadistico
                     WHEN 'MEDIA' THEN rz.ritmo_media
                     WHEN 'P75'   THEN rz.ritmo_p75
                     WHEN 'P90'   THEN rz.ritmo_p90
                     ELSE rz.ritmo_mediana END) IS NOT NULL THEN 'ZONA'
             ELSE 'DEFECTO'
           END AS ritmo_origen
    FROM asign a
    JOIN cfg c ON c.tipo = a.tipo
    LEFT JOIN carga_movil cm ON cm.movil = a.movil
    LEFT JOIN rit_zona  rz ON rz.zona_id = a.zona_id AND rz.tipo_servicio = a.tipo
    LEFT JOIN rit_movil rm ON rm.movil   = a.movil   AND rm.tipo_servicio = a.tipo
  ),
  con_libre AS (
    SELECT k.*,
           round(
             ((k.carga * k.ritmo)
              + CASE WHEN k.es_transito AND c.modo = 'CASTIGO' THEN c.castigo ELSE 0 END)
             * CASE WHEN k.es_transito AND c.modo = 'ALPHA' AND al.a > 0
                    THEN 1 / al.a ELSE 1 END
           , 2) AS libre_en
    FROM crudo k JOIN cfg c ON c.tipo = k.tipo CROSS JOIN alpha al
  ),
  -- Mejor prioridad de cada (zona, tipo): la referencia contra la que se
  -- mide si vale la pena mandar un transito.
  mejor_prioridad AS (
    SELECT zona_id, tipo, min(libre_en) AS libre_min
    FROM con_libre
    WHERE NOT es_transito
    GROUP BY zona_id, tipo
  )
  SELECT l.zona_id, l.tipo, l.movil, l.carga, l.ritmo, l.ritmo_origen,
         l.libre_en, l.es_transito,
         (l.es_transito
          AND c.modo = 'SOLO_SI_NO_HAY'
          AND mp.libre_min IS NOT NULL
          AND mp.libre_min <= l.libre_en + c.margen) AS descartado
  FROM con_libre l
  JOIN cfg c ON c.tipo = l.tipo
  LEFT JOIN mejor_prioridad mp ON mp.zona_id = l.zona_id AND mp.tipo = l.tipo;
$function$;

-- ..... demoras_corrida_backfill .....
CREATE OR REPLACE FUNCTION public.demoras_corrida_backfill(p_minutos_max integer DEFAULT 15, p_max_corridas integer DEFAULT 4)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  r          record;
  v_corridas integer := 0;
BEGIN
  -- Lock propio, distinto del motor y del laboratorio.
  IF NOT pg_try_advisory_xact_lock(2180637407::bigint) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT dc.escenario, dc.corrida_at
    FROM (
      SELECT DISTINCT d.escenario, d.corrida_at
      FROM demoras_calculadas d
      WHERE d.corrida_at >= now() - make_interval(mins => p_minutos_max)
        AND NOT EXISTS (
          SELECT 1 FROM demoras_corrida_meta cm
          WHERE cm.escenario = d.escenario AND cm.corrida_at = d.corrida_at)
    ) dc
    ORDER BY dc.corrida_at, dc.escenario
    LIMIT p_max_corridas
  LOOP
    PERFORM demoras_corrida_snapshot(r.corrida_at, r.escenario);
    v_corridas := v_corridas + 1;
  END LOOP;

  -- El ritmo del dia (caro, estable): aca y no en la corrida.
  -- demoras_modelo ahora tiene una fila por (escenario_id, tipo_servicio):
  -- deduplicamos para invocar la captura UNA vez por escenario.
  PERFORM demoras_corrida_ritmo_dia((now() AT TIME ZONE 'America/Montevideo')::date, m.escenario_id)
  FROM (SELECT DISTINCT escenario_id FROM demoras_modelo) m;

  RETURN v_corridas;
END;
$function$;

-- ..... demoras_corrida_ritmo_dia .....
CREATE OR REPLACE FUNCTION public.demoras_corrida_ritmo_dia(p_fecha date, p_escenario integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_n integer := 0; v_paso integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM demoras_modelo WHERE escenario_id = p_escenario) THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM demoras_corrida_ritmo
                  WHERE fecha = p_fecha AND escenario = p_escenario) THEN
    INSERT INTO demoras_corrida_ritmo (
      fecha, escenario, nivel, clave, tipo_servicio, media, mediana, p75, p90, muestras)
    SELECT p_fecha, p_escenario, r.nivel, r.clave, r.tipo, r.media, r.mediana, r.p75, r.p90, r.muestras
    FROM demoras_ritmo_niveles(p_escenario, p_fecha) r
    ON CONFLICT (fecha, escenario, nivel, clave, tipo_servicio) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  -- El mapeo movil -> chofer top del dia (mismo criterio y desempate
  -- que demoras_ritmo_movil: mas apariciones, despues alfabetico).
  IF NOT EXISTS (SELECT 1 FROM demoras_corrida_chofer
                  WHERE fecha = p_fecha AND escenario = p_escenario) THEN
    INSERT INTO demoras_corrida_chofer (fecha, escenario, movil, tipo_servicio, chofer)
    SELECT DISTINCT ON (c.movil, c.tipo) p_fecha, p_escenario, c.movil, c.tipo, c.chofer
    FROM (
      SELECT m.movil, m.tipo, m.chofer, count(*) AS n
      -- Captura una-vez-por-dia sin nocion de tipo de parametria: pinneada
      -- TRANSITORIAMENTE a la fila 'URGENTE' de demoras_modelo hasta que la
      -- captura del ritmo se abra por tipo_servicio.
      FROM demoras_modelo dm,
           LATERAL demoras_ritmo_muestras(
             p_escenario, p_fecha,
             coalesce(dm.ritmo_dias_ventana, 7),
             coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS'),
             coalesce(dm.ritmo_hueco_max_minutos, 90),
             coalesce(dm.ritmo_hueco_min_minutos, 5),
             coalesce(dm.ritmo_solo_con_cola, false)) m
      WHERE dm.escenario_id = p_escenario
        AND dm.tipo_servicio = 'URGENTE'
        AND m.movil IS NOT NULL AND m.chofer IS NOT NULL
      GROUP BY m.movil, m.tipo, m.chofer
    ) c
    ORDER BY c.movil, c.tipo, c.n DESC, c.chofer
    ON CONFLICT (fecha, escenario, movil, tipo_servicio) DO NOTHING;
    GET DIAGNOSTICS v_paso = ROW_COUNT;
    v_n := v_n + v_paso;
  END IF;

  RETURN v_n;
END;
$function$;

-- ..... demoras_calcular_run .....
CREATE OR REPLACE FUNCTION public.demoras_calcular_run(p_corrida_at timestamp with time zone DEFAULT now())
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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
  FOR m IN SELECT * FROM demoras_modelo ORDER BY escenario_id, tipo_servicio LOOP
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
         AND dc.tipo_servicio = m.tipo_servicio
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
$function$;

-- --- 3. Ahora si: NOCTURNO y SERVICE identicas a URGENTE ---
INSERT INTO demoras_modelo
SELECT (jsonb_populate_record(NULL::demoras_modelo,
          to_jsonb(m) || jsonb_build_object('tipo_servicio', t.tipo))).*
FROM demoras_modelo m
CROSS JOIN (VALUES ('NOCTURNO'), ('SERVICE')) AS t(tipo)
WHERE m.tipo_servicio = 'URGENTE'
ON CONFLICT (escenario_id, tipo_servicio) DO NOTHING;

-- --- 4. Fotos DESPUES (codigo nuevo, tres filas identicas) ---
CREATE TEMP TABLE _d_demoras_aportes AS SELECT * FROM demoras_aportes(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _d_demoras_aportes_lab AS SELECT * FROM demoras_aportes_lab(1000, (now() AT TIME ZONE 'America/Montevideo')::date, 'MEDIANA', 'CASCADA');
CREATE TEMP TABLE _d_demoras_cola AS SELECT * FROM demoras_cola(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now());
CREATE TEMP TABLE _d_demoras_cola_detalle AS SELECT * FROM demoras_cola_detalle(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now());
CREATE TEMP TABLE _d_demoras_consumo_tramos AS SELECT * FROM demoras_consumo_tramos(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now());
CREATE TEMP TABLE _d_demoras_consumo_tramos_lab AS SELECT * FROM demoras_consumo_tramos_lab(1000, (now() AT TIME ZONE 'America/Montevideo')::date, now(), 'MEDIANA', 'CASCADA');
CREATE TEMP TABLE _d_demoras_ritmo AS SELECT * FROM demoras_ritmo(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _d_demoras_ritmo_movil AS SELECT * FROM demoras_ritmo_movil(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _d_demoras_ritmo_niveles AS SELECT * FROM demoras_ritmo_niveles(1000, (now() AT TIME ZONE 'America/Montevideo')::date);
CREATE TEMP TABLE _d_demoras_ritmo_zona_lab AS SELECT * FROM demoras_ritmo_zona_lab(1000, (now() AT TIME ZONE 'America/Montevideo')::date);

-- --- 5. El veredicto ---
DO $veredicto$
DECLARE d bigint; tot bigint := 0; rep text := '';
BEGIN
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_aportes EXCEPT ALL TABLE _d_demoras_aportes) UNION ALL (TABLE _d_demoras_aportes EXCEPT ALL TABLE _a_demoras_aportes)) x;
  rep := rep || ' demoras_aportes=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_aportes_lab EXCEPT ALL TABLE _d_demoras_aportes_lab) UNION ALL (TABLE _d_demoras_aportes_lab EXCEPT ALL TABLE _a_demoras_aportes_lab)) x;
  rep := rep || ' demoras_aportes_lab=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_cola EXCEPT ALL TABLE _d_demoras_cola) UNION ALL (TABLE _d_demoras_cola EXCEPT ALL TABLE _a_demoras_cola)) x;
  rep := rep || ' demoras_cola=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_cola_detalle EXCEPT ALL TABLE _d_demoras_cola_detalle) UNION ALL (TABLE _d_demoras_cola_detalle EXCEPT ALL TABLE _a_demoras_cola_detalle)) x;
  rep := rep || ' demoras_cola_detalle=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_consumo_tramos EXCEPT ALL TABLE _d_demoras_consumo_tramos) UNION ALL (TABLE _d_demoras_consumo_tramos EXCEPT ALL TABLE _a_demoras_consumo_tramos)) x;
  rep := rep || ' demoras_consumo_tramos=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_consumo_tramos_lab EXCEPT ALL TABLE _d_demoras_consumo_tramos_lab) UNION ALL (TABLE _d_demoras_consumo_tramos_lab EXCEPT ALL TABLE _a_demoras_consumo_tramos_lab)) x;
  rep := rep || ' demoras_consumo_tramos_lab=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_ritmo EXCEPT ALL TABLE _d_demoras_ritmo) UNION ALL (TABLE _d_demoras_ritmo EXCEPT ALL TABLE _a_demoras_ritmo)) x;
  rep := rep || ' demoras_ritmo=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_ritmo_movil EXCEPT ALL TABLE _d_demoras_ritmo_movil) UNION ALL (TABLE _d_demoras_ritmo_movil EXCEPT ALL TABLE _a_demoras_ritmo_movil)) x;
  rep := rep || ' demoras_ritmo_movil=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_ritmo_niveles EXCEPT ALL TABLE _d_demoras_ritmo_niveles) UNION ALL (TABLE _d_demoras_ritmo_niveles EXCEPT ALL TABLE _a_demoras_ritmo_niveles)) x;
  rep := rep || ' demoras_ritmo_niveles=' || d; tot := tot + d;
  SELECT count(*) INTO d FROM ((TABLE _a_demoras_ritmo_zona_lab EXCEPT ALL TABLE _d_demoras_ritmo_zona_lab) UNION ALL (TABLE _d_demoras_ritmo_zona_lab EXCEPT ALL TABLE _a_demoras_ritmo_zona_lab)) x;
  rep := rep || ' demoras_ritmo_zona_lab=' || d; tot := tot + d;
  IF tot > 0 THEN
    RAISE EXCEPTION 'LA SALIDA CAMBIO: se aborta todo. difs_total=% detalle:%', tot, rep;
  END IF;
  RAISE NOTICE 'OK: 0 diferencias en 10 funciones comparadas';
END $veredicto$;
