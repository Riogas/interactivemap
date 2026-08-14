-- ====================================================================
-- Baja momentanea (estado 4): no operativo para el motor de demoras
-- Fecha: 2026-08-14 | Idempotente | Aplicar via pg-meta o SQL Editor.
-- ====================================================================
--
-- El AS400 va a empezar a usar el estado 4 = "baja momentanea": el
-- movil tuvo un inconveniente y no trabaja por ~30-45 minutos, pero
-- puede tener pedidos pendientes arriba. Semantica pedida por Diego
-- (audio/chat 14/8): para el calculo de la demora ese movil NO debe
-- considerarse, y sus pedidos tampoco -- "como si la zona no tuviera
-- nada si solo estuviese ese movil con sus pedidos".
--
-- El problema: `moviles_dia.activo` se calcula con la regla de la UI
-- (isMovilActiveForUI: estado NULL o IN (0,1,2,4)) -- el 4 esta
-- deliberadamente INCLUIDO para que el movil se siga viendo en el mapa
-- mientras dura la baja. Si no se toca nada, el motor lo contaria como
-- capacidad plena. Son dos conceptos distintos:
--
--   * visible para la UI  -> estado 4 SI  (moviles_dia.activo, intacto)
--   * operativo p/el motor -> estado 4 NO  (este archivo)
--
-- Que hace: agrega `AND coalesce(md.estado_nro, 0) <> 4` en las CINCO
-- compuertas donde el motor y su caja negra miran md.activo:
--   1. demoras_aportes        (el movil no aporta mu a la zona)
--   2. demoras_capacidad      (no cuenta en moviles_activos/capacidad)
--   3. demoras_cola           (sus pedidos pasan a ATRAPADOS, y con
--      atrapados_modo=EXCLUIR -- la perilla vigente -- salen de la cola)
--   4. demoras_cola_detalle   (espejo de demoras_cola, lockstep)
--   5. demoras_corrida_snapshot (el movil_activo de los OTRO capturados)
--
-- Consecuencias ya cubiertas por la maquinaria existente:
--   * Zona con SOLO ese movil -> sin capacidad -> rama de fallback.
--   * Cuando vuelve (estado 0/1/2) reaparece con su carga, y el bypass
--     del suavizado por cambio de capacidad deja saltar la promesa.
--   * Caja negra y simulador heredan (capturan movil_activo/atrapados).
--   * Si un pedido atrapado se reasigna a otro movil, deja de ser
--     atrapado y vuelve a contar solo.
--
-- Hoy NO hay ningun movil en estado 4 (verificado): el comportamiento
-- actual no cambia en nada hasta que el AS400 empiece a mandarlo.
--
-- Las definiciones de abajo son las VIGENTES en prod (pg_get_functiondef
-- del 14/8) con el filtro agregado: ninguna cambia de firma.
-- ====================================================================

-- --- demoras_aportes ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.demoras_aportes(p_escenario integer, p_fecha date)
 RETURNS TABLE(zona_id integer, tipo_servicio text, movil integer, es_transito boolean, p_j numeric, ritmo numeric, ritmo_origen text, carga_fuera integer, r_j numeric, mu_j numeric)
 LANGUAGE sql
 STABLE
AS $function$

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

  CROSS JOIN cfg c

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

-- --- demoras_capacidad -------------------------------------------------
CREATE OR REPLACE FUNCTION public.demoras_capacidad(p_escenario integer, p_fecha date)
 RETURNS TABLE(zona_id integer, tipo_servicio text, capacidad_efectiva numeric, moviles_activos integer, moviles_prioridad integer, moviles_transito integer, alpha_usado numeric)
 LANGUAGE sql
 STABLE
AS $function$

  WITH alpha AS (

    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es

                      WHERE es.escenario_id = p_escenario), 0.3) AS a

  ),

  -- Asignaciones vigentes de moviles ACTIVOS hoy.

  asign AS (

    SELECT mz.movil_id::integer AS movil,

           mz.zona_id,

           mz.tipo_de_servicio  AS tipo,

           CASE WHEN mz.prioridad_o_transito = 1 THEN 1::numeric ELSE (SELECT a FROM alpha) END AS peso,

           (mz.prioridad_o_transito = 1) AS es_prioridad

    FROM moviles_zonas mz

    JOIN moviles_dia md

      ON md.movil_id   = mz.movil_id::integer

     AND md.escenario_id = mz.escenario_id

     AND md.fecha      = p_fecha

    WHERE mz.escenario_id = p_escenario

      AND coalesce(mz.activa, true)

      AND md.activo
      AND coalesce(md.estado_nro, 0) <> 4

      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')

  ),

  -- W: suma de pesos de ESE movil dentro de ESE tipo.

  pesos AS (

    SELECT a.*, sum(a.peso) OVER (PARTITION BY a.movil, a.tipo) AS w

    FROM asign a

  )

  SELECT

    p.zona_id,

    p.tipo                                                   AS tipo_servicio,

    -- Redondeo a 4 decimales (réplica lib/zonas-cap-entrega.ts:76-77).

    -- Nota: suma de fracciones redondeadas independientemente ≠ 1.0 exacto.

    -- Residuo típico ~1e-4, no es invariante duro.

    round(sum(CASE WHEN p.w > 0 THEN p.peso / p.w ELSE 0 END), 4) AS capacidad_efectiva,

    count(DISTINCT p.movil)::integer                          AS moviles_activos,

    count(DISTINCT p.movil) FILTER (WHERE p.es_prioridad)::integer     AS moviles_prioridad,

    count(DISTINCT p.movil) FILTER (WHERE NOT p.es_prioridad)::integer AS moviles_transito,

    (SELECT a FROM alpha)                                     AS alpha_usado

  FROM pesos p

  GROUP BY p.zona_id, p.tipo;

$function$;

-- --- demoras_cola ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.demoras_cola(p_escenario integer, p_fecha date, p_corrida_at timestamp with time zone)
 RETURNS TABLE(zona_id integer, tipo_servicio text, asignados integer, sin_asignar integer, atrapados integer, cola_efectiva numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

-- --- demoras_cola_detalle ----------------------------------------------
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

-- --- demoras_corrida_snapshot ------------------------------------------
CREATE OR REPLACE FUNCTION public.demoras_corrida_snapshot(p_corrida_at timestamp with time zone, p_escenario integer, p_forzar boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  m         demoras_modelo%ROWTYPE;
  v_local   timestamp;
  v_fecha   date;
  v_hora    time;
  v_dia     text;
  v_n       integer := 0;
  v_paso    integer;
BEGIN
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = p_escenario;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Nada que capturar si la corrida no existe.
  IF NOT EXISTS (SELECT 1 FROM demoras_calculadas
                  WHERE corrida_at = p_corrida_at AND escenario = p_escenario) THEN
    RETURN 0;
  END IF;

  -- LA PRIMERA CAPTURA ES LA BUENA: no se re-captura una corrida que ya
  -- tiene caja negra. El estado del mundo se degrada con cada segundo
  -- que pasa (medido: con 660 s de desfase el simulador divergia en 121
  -- filas de 201; con 10 s, en 11), asi que re-capturar mas tarde solo
  -- puede EMPEORAR lo guardado. Paso de verdad al re-aplicar esta misma
  -- migracion: piso una captura de 10 s con una de 240 s y las
  -- divergencias saltaron de 11 a 54.
  IF NOT p_forzar AND EXISTS (SELECT 1 FROM demoras_corrida_meta
                               WHERE corrida_at = p_corrida_at AND escenario = p_escenario) THEN
    RETURN 0;
  END IF;

  v_local := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha := v_local::date;
  v_hora  := v_local::time;
  v_dia   := demoras_dia_tipo(v_fecha);

  -- 4a. Meta: parametria, calendario y universo.
  INSERT INTO demoras_corrida_meta (
    corrida_at, escenario, fecha_local, hora_local, dia_tipo, modelo_version,
    modelo, config, ventanas, espera_max, alpha_transito, zonas_activas, capturado_at)
  SELECT p_corrida_at, p_escenario, v_fecha, v_hora, v_dia, m.version,
         to_jsonb(m),
         (SELECT jsonb_agg(to_jsonb(dc)) FROM demoras_config dc WHERE dc.escenario_id = p_escenario),
         (SELECT jsonb_agg(to_jsonb(dv)) FROM demoras_ventanas dv
           WHERE dv.escenario_id = p_escenario AND dv.dia_tipo = v_dia),
         (SELECT jsonb_agg(to_jsonb(de)) FROM demoras_espera_max de
           WHERE de.escenario_id = p_escenario AND de.dia_tipo = v_dia),
         (SELECT es.peso_transito_alpha FROM escenario_settings es WHERE es.escenario_id = p_escenario),
         (SELECT array_agg(DISTINCT d.zona_id) FROM demoras d
           WHERE d.escenario_id = p_escenario AND d.descripcion = 'URGENTE' AND d.activa),
         now()
  ON CONFLICT (corrida_at, escenario) DO UPDATE SET
    modelo = EXCLUDED.modelo, config = EXCLUDED.config, ventanas = EXCLUDED.ventanas,
    espera_max = EXCLUDED.espera_max, alpha_transito = EXCLUDED.alpha_transito,
    zonas_activas = EXCLUDED.zonas_activas, modelo_version = EXCLUDED.modelo_version,
    capturado_at = EXCLUDED.capturado_at;

  -- 4b. Los aportes por movil: EL dato irrecuperable.
  INSERT INTO demoras_corrida_movil (
    corrida_at, escenario, zona_id, tipo_servicio, movil,
    es_transito, dedicacion, ritmo, ritmo_origen, carga_fuera, libera_en, capacidad)
  SELECT p_corrida_at, p_escenario, a.zona_id, a.tipo_servicio, a.movil,
         a.es_transito, a.p_j, a.ritmo, a.ritmo_origen, a.carga_fuera, a.r_j, a.mu_j
  FROM demoras_aportes(p_escenario, v_fecha) a
  ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio, movil) DO UPDATE SET
    es_transito = EXCLUDED.es_transito, dedicacion = EXCLUDED.dedicacion,
    ritmo = EXCLUDED.ritmo, ritmo_origen = EXCLUDED.ritmo_origen,
    carga_fuera = EXCLUDED.carga_fuera, libera_en = EXCLUDED.libera_en,
    capacidad = EXCLUDED.capacidad;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 4c. Los pedidos que formaban la cola.
  INSERT INTO demoras_corrida_pedido (
    corrida_at, escenario, origen, pedido_id, zona_id, tipo_pedido, movil,
    es_asignado, movil_activo, asignado_desde, asignado_es_proxy, minutos_desde_asignacion)
  SELECT p_corrida_at, p_escenario, d.origen, d.pedido_id, d.zona_nro, d.tipo, d.movil,
         d.es_asignado, d.movil_activo, d.asignado_desde, d.asignado_es_proxy,
         d.minutos_desde_asignacion
  FROM demoras_cola_detalle(p_escenario, v_fecha, p_corrida_at) d
  ON CONFLICT (corrida_at, escenario, origen, pedido_id) DO UPDATE SET
    zona_id = EXCLUDED.zona_id, tipo_pedido = EXCLUDED.tipo_pedido, movil = EXCLUDED.movil,
    es_asignado = EXCLUDED.es_asignado, movil_activo = EXCLUDED.movil_activo,
    asignado_desde = EXCLUDED.asignado_desde, asignado_es_proxy = EXCLUDED.asignado_es_proxy,
    minutos_desde_asignacion = EXCLUDED.minutos_desde_asignacion;
  GET DIAGNOSTICS v_paso = ROW_COUNT;
  v_n := v_n + v_paso;

  -- 4c-bis. Los ESPECIALES/OTROS a bordo (pregunta de Diego, audio 12/8).
  -- El motor SI los cuenta en carga_fuera (demoras_aportes.carga_total:
  -- "todo entra aca, ESPECIAL/OTROS incluidos") pero el detalle por
  -- pedido no los guardaba: viajaban solo dentro del numero agregado.
  -- Sin este detalle no se puede backtestear un peso distinto para el
  -- especial -- y los datos del 12/8 dicen que importa: 137 especiales
  -- a bordo con rotacion de ~10 por dia (los llevan y los postergan),
  -- en 34 de 96 moviles activos, max 56 en uno solo.
  -- MISMO filtro que carga_total: estado 1, movil asignado, zona, fch
  -- del dia, y el balde OTRO = todo lo que no es URGENTE/NOCTURNO
  -- exactos. `prog` en el simulador filtra por pool, asi que estas
  -- filas NO se cuelan en la reconstruccion de la cola.
  INSERT INTO demoras_corrida_pedido (
    corrida_at, escenario, origen, pedido_id, zona_id, tipo_pedido, movil,
    es_asignado, movil_activo, asignado_desde, asignado_es_proxy, minutos_desde_asignacion)
  SELECT p_corrida_at, p_escenario, 'PEDIDO', p.id::bigint, p.zona_nro, 'OTRO', p.movil,
         true,
         EXISTS (SELECT 1 FROM moviles_dia md
                  WHERE md.escenario_id = p_escenario AND md.movil_id = p.movil
                    AND md.fecha = v_fecha AND md.activo
                    AND coalesce(md.estado_nro, 0) <> 4),
         coalesce(p.fch_hora_asignado, p.updated_at),
         (p.fch_hora_asignado IS NULL),
         CASE WHEN coalesce(p.fch_hora_asignado, p.updated_at) IS NOT NULL
              THEN round((EXTRACT(EPOCH FROM (p_corrida_at - coalesce(p.fch_hora_asignado, p.updated_at))) / 60.0)::numeric, 2)
         END
  FROM pedidos p
  WHERE p.escenario = p_escenario AND p.estado_nro = 1
    AND p.movil IS NOT NULL AND p.movil <> 0 AND p.zona_nro IS NOT NULL
    AND COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
    AND upper(trim(coalesce(p.servicio_nombre,''))) NOT IN ('URGENTE','NOCTURNO')
  ON CONFLICT (corrida_at, escenario, origen, pedido_id) DO UPDATE SET
    zona_id = EXCLUDED.zona_id, tipo_pedido = EXCLUDED.tipo_pedido, movil = EXCLUDED.movil,
    es_asignado = EXCLUDED.es_asignado, movil_activo = EXCLUDED.movil_activo,
    asignado_desde = EXCLUDED.asignado_desde, asignado_es_proxy = EXCLUDED.asignado_es_proxy,
    minutos_desde_asignacion = EXCLUDED.minutos_desde_asignacion;
  GET DIAGNOSTICS v_paso = ROW_COUNT;
  v_n := v_n + v_paso;

  RETURN v_n;
END;
$function$;

