-- =====================================================================
-- ACIERTO DE LA DEMORA — desfasaje proyectado vs. real, por pedido
-- Fecha: 2026-08-03 | Idempotente
--
-- ✅ ESTADO REAL EN PROD (2026-08-03): los pasos 1-4 (DDL + run v4 + RPC)
-- y el backfill de hechos 5a-5d YA ESTÁN APLICADOS — ejecutados vía
-- pg-meta (/pg/query con la service key) porque el SQL Editor de Studio
-- se quedaba sin timeout con el archivo entero (rollback limpio,
-- verificado). Los pasos pesados 5e/5f NO se corren de este archivo:
-- los ejecuta el job nocturno auto-desprogramable de
-- 2026-08-03-desfasaje-backfill-nocturno.sql (chunks de a 1 minuto,
-- 01:00-05:59 UY). Este archivo queda como referencia completa y para
-- re-aplicar 1-4/5a-5d si hiciera falta (idempotente).
--
-- ⚠ Si igual se corre entero a mano: FUERA DEL HORARIO OPERATIVO. El
-- backfill espeja desfasajes en cientos de miles de filas de `pedidos`,
-- que está en la publicación realtime CON triggers: al COMMIT los
-- clientes conectados reciben el burst de UPDATEs (el filtro por
-- escenario NO descarta pedidos históricos) y los pedidos con fch_para =
-- hoy/ayer disparan el recompute de moviles_dia. También se pisa
-- `updated_at` de los pedidos espejados.
--
-- QUÉ MIDE
-- --------
-- Por cada pedido ENTREGADO: el desfasaje entre la demora que se le
-- proyectó al tomarlo y lo que tardó de verdad. "Tomado 10:00 con 60 min
-- => esperado 11:00; entregado 11:05 son 5 de desfasaje; 10:55 también 5"
-- (el número que importa es el sin signo, pero acá se guarda CON signo:
-- el abs() es gratis al leer y el signo dice si llegamos antes o después).
-- Se calcula contra DOS proyecciones:
--   * informada  : la del AS400 al momento de la toma.
--   * calculada  : la del motor CONSUMO_TRAMOS vigente a la toma.
-- La distribución en franjas de 5 minutos (hasta 90, después "90+") y el
-- KPI "% con desfasaje <= 25" salen de la RPC metricas_desfasaje.
--
-- DECISIONES (cerradas con el usuario 2026-08-03)
-- -----------------------------------------------
-- 1. Se persiste en metricas_cumplimiento (hechos, inmutables, para
--    siempre) Y espejo en pedidos (para mirar un pedido puntual). La
--    fuente es el hecho; el espejo se pisa desde el hecho.
-- 2. Universo: URGENTE y NOCTURNO. SERVICE queda afuera (su "proyección"
--    es un SLA fijo de 4 h: entregar temprano daría franja 90+ siendo
--    algo bueno). ESPECIAL/OTROS afuera.
-- 3. Agendados excluidos (regla existente: asignado + 60' < para). Un
--    nocturno "para las 13" rompe la cuenta toma+demora.
-- 4. Proyección del motor: última corrida de demoras_calculadas con
--    corrida_at <= toma y a lo sumo 20 minutos más vieja (borde de 20:00
--    INCLUIDO). Sin corrida fresca (fuera de ventana del motor, o pedido
--    anterior al 2026-07-29) el desfasaje calculado queda NULL — no
--    inventa.
-- 5. demora_informada = 0 se trata como SIN DATO (el import defaultea a 0
--    cuando el AS400 no manda el campo), nunca como "0 minutos".
--
-- POR QUÉ LA PROYECCIÓN AS400 SALE DEL PROPIO PEDIDO
-- --------------------------------------------------
-- Verificado contra prod (2026-08-03, URGENTE y NOCTURNO, sin excepción):
--     fch_hora_max_ent_comp − fch_hora_para = demora_informada  (exacto)
-- O sea el AS400 ya congela su proyección en cada pedido. Para hechos
-- cuyos orígenes ya no existan, la igualdad permite DERIVARLA de columnas
-- que el hecho ya persiste (max_ent_comp y para) — backfill sin depender
-- de la retención del origen.
-- =====================================================================


-- =====================================================================
-- 1. Columnas nuevas en los hechos
-- =====================================================================
ALTER TABLE metricas_cumplimiento
  ADD COLUMN IF NOT EXISTS demora_informada_mins       numeric,
  ADD COLUMN IF NOT EXISTS desfasaje_informado_mins    numeric,
  ADD COLUMN IF NOT EXISTS demora_proyectada_calc_mins numeric,
  ADD COLUMN IF NOT EXISTS corrida_calc_at             timestamptz,
  ADD COLUMN IF NOT EXISTS desfasaje_calc_mins         numeric;

COMMENT ON COLUMN metricas_cumplimiento.demora_informada_mins IS
  'Demora que el AS400 informó al tomar el pedido (snapshot del origen; 0 del import = sin dato = NULL). Se persiste para todos los tipos.';
COMMENT ON COLUMN metricas_cumplimiento.desfasaje_informado_mins IS
  'fin − (toma + demora_informada), CON signo (negativo = se entregó antes de lo proyectado). Solo URGENTE/NOCTURNO no agendados; NULL en el resto. Para franjas usar abs().';
COMMENT ON COLUMN metricas_cumplimiento.demora_proyectada_calc_mins IS
  'Demora que el motor (demoras_calculadas.demora_informada) proyectaba para (escenario, zona, tipo) en la última corrida <= toma (a lo sumo 20 min más vieja). NULL si no hubo corrida fresca.';
COMMENT ON COLUMN metricas_cumplimiento.corrida_calc_at IS
  'corrida_at de la corrida usada para demora_proyectada_calc_mins (auditoría del lookup).';
COMMENT ON COLUMN metricas_cumplimiento.desfasaje_calc_mins IS
  'fin − (toma + demora_proyectada_calc), CON signo. Mismas exclusiones que desfasaje_informado + NULL sin corrida fresca.';


-- =====================================================================
-- 2. Espejo en pedidos (lectura por pedido puntual; la fuente es el hecho)
-- ---------------------------------------------------------------------
-- Solo pedidos: el universo es URGENTE/NOCTURNO y ambos viven ahí.
-- demora_informada ya existe en la tabla (viene del import).
--
-- NOTA de exposición: pedidos es public-read por diseño legacy (policy
-- SELECT USING(true) + anon key en el browser), así que el espejo queda
-- legible pedido a pedido con la anon key — igual que el resto de la fila
-- (demora_informada, tiempos, etc.). El dato AGREGADO (KPIs/franjas) sí
-- se blinda: la RPC de abajo es solo service_role. Endurecer el RLS de
-- pedidos es un cambio de plataforma fuera de este feature.
-- =====================================================================
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS desfasaje_informado_mins    numeric,
  ADD COLUMN IF NOT EXISTS demora_proyectada_calc_mins numeric,
  ADD COLUMN IF NOT EXISTS corrida_calc_at             timestamptz,
  ADD COLUMN IF NOT EXISTS desfasaje_calc_mins         numeric;

COMMENT ON COLUMN pedidos.desfasaje_informado_mins IS
  'ESPEJO de metricas_cumplimiento.desfasaje_informado_mins (lo escribe metricas_cumplimiento_run; la fuente de verdad es el hecho).';
COMMENT ON COLUMN pedidos.desfasaje_calc_mins IS
  'ESPEJO de metricas_cumplimiento.desfasaje_calc_mins (ver ahí la semántica).';


-- =====================================================================
-- 3. El job: mismo cuerpo que 2026-07-28b + desfasajes + espejo
-- ---------------------------------------------------------------------
-- Firma intacta (el cron llama con 2 args). El lookup del motor es un
-- LATERAL por fila apoyado en idx_demoras_calc_esc_zona_tipo_at
-- (escenario, zona_id, tipo_servicio, corrida_at DESC) — un index scan
-- por hecho del universo, no un join masivo.
-- =====================================================================
CREATE OR REPLACE FUNCTION metricas_cumplimiento_run(
  p_desde     date,
  p_hasta     date,
  p_escenario integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_insertados bigint;
BEGIN
  DELETE FROM metricas_cumplimiento
   WHERE fecha BETWEEN p_desde AND p_hasta
     AND (p_escenario IS NULL OR escenario = p_escenario);

  WITH src AS (
    SELECT 'PEDIDO'::text AS origen, id AS pedido_id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           fch_hora_max_ent_comp,
           demora_movil_desde_asignacion_mins,
           demora_informada
    FROM pedidos
    WHERE estado_nro = 2 AND sub_estado_nro = 3
      AND coalesce(orden_cancelacion, 'N') <> 'S'
      AND escenario IS NOT NULL
      AND (p_escenario IS NULL OR escenario = p_escenario)
      AND fch_hora_finalizacion IS NOT NULL
      AND (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT 'SERVICE', id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           fch_hora_max_ent_comp,
           demora_movil_desde_asignacion_mins,
           demora_informada
    FROM services
    WHERE estado_nro = 2 AND sub_estado_nro = 3
      AND coalesce(orden_cancelacion, 'N') <> 'S'
      AND escenario IS NOT NULL
      AND (p_escenario IS NULL OR escenario = p_escenario)
      AND fch_hora_finalizacion IS NOT NULL
      AND (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
  ),
  calc AS (
    SELECT
      origen, pedido_id, escenario,
      (fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date AS fecha,
      CASE
        WHEN origen = 'SERVICE'                            THEN 'SERVICE'
        WHEN upper(trim(servicio_nombre)) = 'URGENTE'      THEN 'URGENTE'
        WHEN upper(trim(servicio_nombre)) = 'NOCTURNO'     THEN 'NOCTURNO'
        WHEN upper(trim(servicio_nombre)) LIKE 'ESPECIAL%' THEN 'ESPECIAL'
        ELSE 'OTROS'
      END AS tipo_servicio,
      servicio_nombre, movil, zona_nro, empresa_fletera_id,
      nullif(trim(fletero), '') AS chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
      fch_hora_max_ent_comp,
      -- 0 = "sin dato" (default del import cuando el AS400 no manda el campo)
      nullif(demora_informada, 0)::numeric AS demora_informada_valida,
      CASE
        WHEN fch_hora_asignado IS NOT NULL                  THEN 'CAMPO'
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL THEN 'DERIVADO'
        ELSE NULL
      END AS asignado_source,
      CASE
        WHEN fch_hora_asignado IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_asignado)) / 60.0
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL
          THEN demora_movil_desde_asignacion_mins::numeric
        ELSE NULL
      END AS demora_bruta,
      CASE
        WHEN fch_hora_asignado IS NOT NULL THEN fch_hora_asignado
        WHEN demora_movil_desde_asignacion_mins IS NOT NULL
          THEN fch_hora_finalizacion - (demora_movil_desde_asignacion_mins * interval '1 minute')
        ELSE NULL
      END AS asignado_efectivo
    FROM src
  ),
  eff AS (
    SELECT *,
      -- Regla de agendados: sigue sobre fch_hora_para ("para cuándo lo
      -- quiere"), que es su significado correcto.
      (asignado_efectivo IS NOT NULL AND fch_hora_para IS NOT NULL
        AND asignado_efectivo + interval '60 minute' < fch_hora_para) AS es_agendado,
      CASE WHEN fch_hora_para IS NOT NULL
        THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_para)) / 60.0
        ELSE NULL END AS desde_alta_bruto,
      -- Atraso REAL: contra el compromiso (SLA).
      CASE WHEN fch_hora_max_ent_comp IS NOT NULL
        THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_max_ent_comp)) / 60.0
        ELSE NULL END AS atraso_compromiso_bruto
    FROM calc
  ),
  -- Proyección del motor vigente a la TOMA del pedido. El LATERAL solo se
  -- evalúa de verdad para el universo (URGENTE/NOCTURNO no agendados con
  -- toma conocida): las condiciones sobre `e` cortocircuitan el índice.
  proy AS (
    SELECT e.*,
           dc.demora_informada AS demora_proyectada_calc,
           dc.corrida_at       AS corrida_calc_at
    FROM eff e
    LEFT JOIN LATERAL (
      SELECT d.demora_informada, d.corrida_at
        FROM demoras_calculadas d
       WHERE e.tipo_servicio IN ('URGENTE', 'NOCTURNO')
         AND NOT e.es_agendado
         AND e.fch_hora_para IS NOT NULL
         AND d.escenario      = e.escenario
         AND d.zona_id        = e.zona_nro
         AND d.tipo_servicio  = e.tipo_servicio
         AND d.corrida_at    <= e.fch_hora_para
         -- >= : el borde de 20:00 exactos cuenta como fresco (el COMMENT
         -- de la columna promete "a lo sumo 20 min más vieja").
         AND d.corrida_at    >= e.fch_hora_para - interval '20 minutes'
       ORDER BY d.corrida_at DESC
       LIMIT 1
    ) dc ON true
  ),
  ins AS (
    INSERT INTO metricas_cumplimiento (
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
      demora_mins, demora_efectiva_mins, atraso_vs_para_mins,
      atraso_vs_compromiso_mins, reloj_inicio, asignado_source,
      demora_informada_mins, desfasaje_informado_mins,
      demora_proyectada_calc_mins, corrida_calc_at, desfasaje_calc_mins
    )
    SELECT
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      CASE WHEN asignado_source = 'CAMPO' THEN fch_hora_asignado ELSE NULL END,
      fch_hora_finalizacion, fch_hora_para, fch_hora_max_ent_comp,
      round(demora_bruta, 2),
      round(CASE WHEN es_agendado THEN greatest(0, desde_alta_bruto) ELSE demora_bruta END, 2),
      round(desde_alta_bruto, 2),
      round(atraso_compromiso_bruto, 2),
      CASE WHEN es_agendado THEN 'PARA' ELSE 'ASIGNADO' END,
      asignado_source,
      -- Snapshot para todos los tipos (dato es dato); desfasajes solo universo.
      demora_informada_valida,
      CASE WHEN tipo_servicio IN ('URGENTE', 'NOCTURNO')
             AND NOT es_agendado
             AND fch_hora_para IS NOT NULL
             AND demora_informada_valida IS NOT NULL
        THEN round(EXTRACT(EPOCH FROM (fch_hora_finalizacion
               - (fch_hora_para + demora_informada_valida * interval '1 minute'))) / 60.0, 2)
        ELSE NULL
      END,
      demora_proyectada_calc,
      corrida_calc_at,
      CASE WHEN demora_proyectada_calc IS NOT NULL
        THEN round(EXTRACT(EPOCH FROM (fch_hora_finalizacion
               - (fch_hora_para + demora_proyectada_calc * interval '1 minute'))) / 60.0, 2)
        ELSE NULL
      END
    FROM proy
    WHERE asignado_source IS NOT NULL
      AND demora_bruta >= 0
    ON CONFLICT (origen, pedido_id, escenario) DO UPDATE SET
      fecha                       = EXCLUDED.fecha,
      tipo_servicio               = EXCLUDED.tipo_servicio,
      servicio_nombre             = EXCLUDED.servicio_nombre,
      movil                       = EXCLUDED.movil,
      zona_nro                    = EXCLUDED.zona_nro,
      empresa_fletera_id          = EXCLUDED.empresa_fletera_id,
      chofer                      = EXCLUDED.chofer,
      fch_hora_asignado           = EXCLUDED.fch_hora_asignado,
      fch_hora_finalizacion       = EXCLUDED.fch_hora_finalizacion,
      fch_hora_para               = EXCLUDED.fch_hora_para,
      fch_hora_max_ent_comp       = EXCLUDED.fch_hora_max_ent_comp,
      demora_mins                 = EXCLUDED.demora_mins,
      demora_efectiva_mins        = EXCLUDED.demora_efectiva_mins,
      atraso_vs_para_mins         = EXCLUDED.atraso_vs_para_mins,
      atraso_vs_compromiso_mins   = EXCLUDED.atraso_vs_compromiso_mins,
      reloj_inicio                = EXCLUDED.reloj_inicio,
      asignado_source             = EXCLUDED.asignado_source,
      demora_informada_mins       = EXCLUDED.demora_informada_mins,
      desfasaje_informado_mins    = EXCLUDED.desfasaje_informado_mins,
      demora_proyectada_calc_mins = EXCLUDED.demora_proyectada_calc_mins,
      corrida_calc_at             = EXCLUDED.corrida_calc_at,
      desfasaje_calc_mins         = EXCLUDED.desfasaje_calc_mins
    RETURNING 1
  )
  SELECT count(*) INTO v_insertados FROM ins;

  -- Espejo en pedidos: SIEMPRE desde el hecho recién calculado (única
  -- fuente), solo el rango procesado. Services no tiene espejo (fuera del
  -- universo).
  --
  -- El guard IS DISTINCT FROM no es cosmético: pedidos tiene trigger de
  -- updated_at, trigger de recompute de moviles_dia y está en la
  -- publicación realtime. Sin el guard, el cron nocturno ([hoy-3, hoy-1])
  -- reescribía cada noche ~7k filas con valores IDÉNTICOS — un burst de
  -- eventos realtime y recomputes por nada (hallazgo Important del review).
  UPDATE pedidos p
     SET desfasaje_informado_mins    = m.desfasaje_informado_mins,
         demora_proyectada_calc_mins = m.demora_proyectada_calc_mins,
         corrida_calc_at             = m.corrida_calc_at,
         desfasaje_calc_mins         = m.desfasaje_calc_mins
    FROM metricas_cumplimiento m
   WHERE m.origen = 'PEDIDO'
     AND m.fecha BETWEEN p_desde AND p_hasta
     AND (p_escenario IS NULL OR m.escenario = p_escenario)
     AND p.id        = m.pedido_id
     AND p.escenario = m.escenario
     AND (   p.desfasaje_informado_mins    IS DISTINCT FROM m.desfasaje_informado_mins
          OR p.demora_proyectada_calc_mins IS DISTINCT FROM m.demora_proyectada_calc_mins
          OR p.corrida_calc_at             IS DISTINCT FROM m.corrida_calc_at
          OR p.desfasaje_calc_mins         IS DISTINCT FROM m.desfasaje_calc_mins);

  -- Espejo huérfano: si el reproceso PURGÓ un hecho (p.ej. el AS400 mandó
  -- la cancelación después de la entrega), el pedido no puede quedar con
  -- desfasajes que las métricas ya no cuentan. Acotado al rango procesado.
  UPDATE pedidos p
     SET desfasaje_informado_mins    = NULL,
         demora_proyectada_calc_mins = NULL,
         corrida_calc_at             = NULL,
         desfasaje_calc_mins         = NULL
   WHERE (p.fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date BETWEEN p_desde AND p_hasta
     AND (p_escenario IS NULL OR p.escenario = p_escenario)
     AND (   p.desfasaje_informado_mins IS NOT NULL
          OR p.desfasaje_calc_mins IS NOT NULL
          OR p.demora_proyectada_calc_mins IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM metricas_cumplimiento m
        WHERE m.origen = 'PEDIDO' AND m.pedido_id = p.id AND m.escenario = p.escenario
     );

  RETURN v_insertados;
END;
$fn$;

COMMENT ON FUNCTION metricas_cumplimiento_run(date, date, integer) IS
  'Recomputa metricas_cumplimiento para [p_desde, p_hasta] (fecha en America/Montevideo). p_escenario NULL (default) = todos. Además del atraso vs compromiso calcula los DESFASAJES de acierto de demora (informada AS400 y calculada motor, solo URGENTE/NOCTURNO no agendados) y espeja los resultados en pedidos. El cron llama con 2 args.';


-- =====================================================================
-- 4. RPC de lectura: franjas de desfasaje + KPIs
-- ---------------------------------------------------------------------
-- p: { escenario (req), desde?, hasta? (default: últimos 30 días con
--      dato), tipo? ('URGENTE'|'NOCTURNO'; ausente = ambos),
--      empresas?: int[] (fail-closed: [] = payload vacío) }
--
-- Devuelve TRES poblaciones:
--   informada : todos los hechos con desfasaje_informado_mins.
--   calculada : todos los hechos con desfasaje_calc_mins.
--   comun     : hechos con AMBOS — la única base justa para comparar
--               cuál proyección acierta más (audio 2026-08-03).
-- Franjas de 5 min sobre el ABS: 5 = (0,5], 10 = (5,10], ... 90, y 95 =
-- "90+". KPIs: n, % <= 25, % <= 90, p80 (el "80% cae en <= X" leído al revés).
-- =====================================================================
CREATE OR REPLACE FUNCTION metricas_desfasaje(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc            integer;
  v_tipo           text;
  v_desde          date;
  v_hasta          date;
  v_max            date;
  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;
  v_result         jsonb;

  EMPTY_PAYLOAD CONSTANT jsonb := jsonb_build_object(
    'rango', null, 'kpis', null, 'franjas', '[]'::jsonb
  );
BEGIN
  v_esc  := (p->>'escenario')::integer;
  v_tipo := nullif(p->>'tipo', '');
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('URGENTE', 'NOCTURNO') THEN
    v_tipo := NULL;
  END IF;

  -- empresas: mismo contrato fail-closed que metricas_dashboard.
  v_empresas_type := jsonb_typeof(p->'empresas');
  IF v_empresas_type IS NULL OR v_empresas_type = 'null' THEN
    v_empresas := NULL;
  ELSIF v_empresas_type = 'array' THEN
    IF jsonb_array_length(p->'empresas') = 0 THEN
      v_empresas_empty := true;
    ELSE
      SELECT array_agg(x::int) INTO v_empresas FROM jsonb_array_elements_text(p->'empresas') AS x;
    END IF;
  END IF;
  IF v_empresas_empty THEN RETURN EMPTY_PAYLOAD; END IF;

  v_desde := nullif(p->>'desde', '')::date;
  v_hasta := nullif(p->>'hasta', '')::date;
  IF v_desde IS NULL OR v_hasta IS NULL THEN
    SELECT max(fecha) INTO v_max
      FROM metricas_cumplimiento
     WHERE escenario = v_esc
       AND desfasaje_informado_mins IS NOT NULL
       AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas));
    IF v_max IS NULL THEN RETURN EMPTY_PAYLOAD; END IF;
    v_hasta := v_max;
    v_desde := v_max - 29;
  END IF;

  WITH base AS MATERIALIZED (
    SELECT abs(desfasaje_informado_mins) AS d_inf,
           abs(desfasaje_calc_mins)      AS d_cal
    FROM metricas_cumplimiento
    WHERE escenario = v_esc
      AND fecha BETWEEN v_desde AND v_hasta
      AND tipo_servicio IN ('URGENTE', 'NOCTURNO')
      AND (v_tipo IS NULL OR tipo_servicio = v_tipo)
      AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas))
      AND (desfasaje_informado_mins IS NOT NULL OR desfasaje_calc_mins IS NOT NULL)
  ),
  bucket AS (
    -- Franja = tope superior del intervalo de 5: (0,5] -> 5 ... (85,90] -> 90;
    -- todo lo mayor a 90 -> 95 ("90+"). d = 0 cae en la franja 5.
    SELECT d_inf, d_cal,
           CASE WHEN d_inf IS NULL THEN NULL
                ELSE least(greatest(ceil(d_inf / 5.0), 1) * 5, 95)::int END AS b_inf,
           CASE WHEN d_cal IS NULL THEN NULL
                ELSE least(greatest(ceil(d_cal / 5.0), 1) * 5, 95)::int END AS b_cal
    FROM base
  ),
  tot AS (
    SELECT count(d_inf)                                                AS n_inf,
           count(d_cal)                                                AS n_cal,
           count(*) FILTER (WHERE d_inf IS NOT NULL AND d_cal IS NOT NULL) AS n_comun
    FROM bucket
  ),
  -- El LEFT JOIN ON true recorre la población una vez por tope (19x).
  -- A la escala actual (~1.4k pedidos/día del universo, rango máx 90 días
  -- ~ 2.4M visitas de fila por request) es < 200 ms y se prefiere la
  -- claridad; si algún día duele, agrupar por b_inf/b_cal en dos pasadas
  -- y rellenar los topes vacíos contra generate_series.
  franjas AS (
    SELECT f.tope,
           CASE WHEN f.tope = 95 THEN '90+' ELSE f.tope::text END AS label,
           count(*) FILTER (WHERE b.b_inf = f.tope)                                        AS informada_n,
           count(*) FILTER (WHERE b.b_cal = f.tope)                                        AS calculada_n,
           count(*) FILTER (WHERE b.b_inf = f.tope AND b.d_cal IS NOT NULL)                AS comun_informada_n,
           count(*) FILTER (WHERE b.b_cal = f.tope AND b.d_inf IS NOT NULL)                AS comun_calculada_n
    FROM generate_series(5, 95, 5) AS f(tope)
    LEFT JOIN bucket b ON true
    GROUP BY f.tope
  ),
  kpi AS (
    SELECT
      jsonb_build_object(
        'n', t.n_inf,
        'pct_le_25', round((count(*) FILTER (WHERE b.d_inf <= 25))::numeric / nullif(t.n_inf, 0), 4),
        'pct_le_90', round((count(*) FILTER (WHERE b.d_inf <= 90))::numeric / nullif(t.n_inf, 0), 4),
        'p80', round(percentile_cont(0.8) WITHIN GROUP (ORDER BY b.d_inf)::numeric, 1)
      ) AS informada,
      jsonb_build_object(
        'n', t.n_cal,
        'pct_le_25', round((count(*) FILTER (WHERE b.d_cal <= 25))::numeric / nullif(t.n_cal, 0), 4),
        'pct_le_90', round((count(*) FILTER (WHERE b.d_cal <= 90))::numeric / nullif(t.n_cal, 0), 4),
        'p80', round(percentile_cont(0.8) WITHIN GROUP (ORDER BY b.d_cal)::numeric, 1)
      ) AS calculada,
      jsonb_build_object(
        'n', t.n_comun,
        'informada', jsonb_build_object(
          'pct_le_25', round((count(*) FILTER (WHERE b.d_inf <= 25 AND b.d_cal IS NOT NULL))::numeric / nullif(t.n_comun, 0), 4),
          'pct_le_90', round((count(*) FILTER (WHERE b.d_inf <= 90 AND b.d_cal IS NOT NULL))::numeric / nullif(t.n_comun, 0), 4),
          'p80', round((percentile_cont(0.8) WITHIN GROUP (ORDER BY b.d_inf)
                   FILTER (WHERE b.d_cal IS NOT NULL))::numeric, 1)
        ),
        'calculada', jsonb_build_object(
          'pct_le_25', round((count(*) FILTER (WHERE b.d_cal <= 25 AND b.d_inf IS NOT NULL))::numeric / nullif(t.n_comun, 0), 4),
          'pct_le_90', round((count(*) FILTER (WHERE b.d_cal <= 90 AND b.d_inf IS NOT NULL))::numeric / nullif(t.n_comun, 0), 4),
          'p80', round((percentile_cont(0.8) WITHIN GROUP (ORDER BY b.d_cal)
                   FILTER (WHERE b.d_inf IS NOT NULL))::numeric, 1)
        )
      ) AS comun
    FROM bucket b CROSS JOIN tot t
    GROUP BY t.n_inf, t.n_cal, t.n_comun
  )
  SELECT jsonb_build_object(
    'rango', jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'kpis', coalesce(
      (SELECT jsonb_build_object('informada', k.informada, 'calculada', k.calculada, 'comun', k.comun) FROM kpi k),
      -- base vacía: kpi no devuelve fila, pero el shape se mantiene.
      jsonb_build_object(
        'informada', jsonb_build_object('n', 0, 'pct_le_25', null, 'pct_le_90', null, 'p80', null),
        'calculada', jsonb_build_object('n', 0, 'pct_le_25', null, 'pct_le_90', null, 'p80', null),
        'comun', jsonb_build_object('n', 0,
          'informada', jsonb_build_object('pct_le_25', null, 'pct_le_90', null, 'p80', null),
          'calculada', jsonb_build_object('pct_le_25', null, 'pct_le_90', null, 'p80', null))
      )
    ),
    'franjas', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
         'tope', f.tope, 'label', f.label,
         'informada_n', f.informada_n,
         'informada_pct', round(f.informada_n::numeric / nullif(t.n_inf, 0), 4),
         'calculada_n', f.calculada_n,
         'calculada_pct', round(f.calculada_n::numeric / nullif(t.n_cal, 0), 4),
         'comun_informada_n', f.comun_informada_n,
         'comun_informada_pct', round(f.comun_informada_n::numeric / nullif(t.n_comun, 0), 4),
         'comun_calculada_n', f.comun_calculada_n,
         'comun_calculada_pct', round(f.comun_calculada_n::numeric / nullif(t.n_comun, 0), 4)
       ) ORDER BY f.tope)
       FROM franjas f CROSS JOIN tot t),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION metricas_desfasaje(jsonb) IS
  'Franjas de 5 min del desfasaje |proyectado − real| por pedido entregado (URGENTE/NOCTURNO no agendados), para la demora informada (AS400) y la calculada (motor), más la población común para comparar acierto. KPIs: n, % <= 25, % <= 90, p80. Acceso exclusivo service_role. Fail-closed si p.empresas = [].';

REVOKE EXECUTE ON FUNCTION metricas_desfasaje(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_desfasaje(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_desfasaje(jsonb) TO service_role;


-- =====================================================================
-- 5. BACKFILL — sin DELETE sobre hechos existentes
-- ---------------------------------------------------------------------
-- 5a/5b/5c/5d son UPDATEs (imposible perder un hecho). 5e crea hechos
-- NUEVOS solo para fechas ANTERIORES al primer hecho existente, donde el
-- DELETE del run no tiene nada que borrar.
-- =====================================================================

-- 5a. Snapshot de la demora informada desde el ORIGEN (mientras exista).
UPDATE metricas_cumplimiento m
   SET demora_informada_mins = nullif(s.demora_informada, 0)::numeric
  FROM (
    SELECT 'PEDIDO'::text AS origen, id AS pedido_id, escenario, demora_informada FROM pedidos
    UNION ALL
    SELECT 'SERVICE',      id,        escenario, demora_informada FROM services
  ) s
 WHERE m.origen    = s.origen
   AND m.pedido_id = s.pedido_id
   AND m.escenario = s.escenario
   AND m.demora_informada_mins IS NULL
   AND nullif(s.demora_informada, 0) IS NOT NULL;

-- 5b. Fallback para hechos cuyo origen ya no existe: la igualdad
--     verificada max_ent_comp = para + demora_informada permite derivarla
--     de columnas que el hecho ya persiste. Solo universo.
UPDATE metricas_cumplimiento
   SET demora_informada_mins = round(
         (EXTRACT(EPOCH FROM (fch_hora_max_ent_comp - fch_hora_para)) / 60.0)::numeric, 2)
 WHERE demora_informada_mins IS NULL
   AND tipo_servicio IN ('URGENTE', 'NOCTURNO')
   AND fch_hora_max_ent_comp IS NOT NULL
   AND fch_hora_para IS NOT NULL
   AND fch_hora_max_ent_comp > fch_hora_para;

-- 5c. Desfasaje informado (universo, no agendados: reloj_inicio='PARA'
--     ES la marca de agendado que dejó el run).
UPDATE metricas_cumplimiento
   SET desfasaje_informado_mins = round(
         (EXTRACT(EPOCH FROM (fch_hora_finalizacion
            - (fch_hora_para + demora_informada_mins * interval '1 minute'))) / 60.0)::numeric, 2)
 WHERE desfasaje_informado_mins IS NULL
   AND tipo_servicio IN ('URGENTE', 'NOCTURNO')
   AND reloj_inicio = 'ASIGNADO'
   AND fch_hora_para IS NOT NULL
   AND demora_informada_mins IS NOT NULL;

-- 5d. Proyección del motor para hechos desde que existe demoras_calculadas
--     (2026-07-29). El LATERAL usa idx_demoras_calc_esc_zona_tipo_at.
--     OJO: el LATERAL vive en un subquery porque el destino de un UPDATE
--     no puede referenciarse lateralmente desde su propio FROM.
UPDATE metricas_cumplimiento m
   SET demora_proyectada_calc_mins = s.demora_proyectada,
       corrida_calc_at             = s.corrida_at,
       desfasaje_calc_mins         = s.desfasaje
  FROM (
    SELECT h.origen, h.pedido_id, h.escenario,
           dc.demora_informada AS demora_proyectada,
           dc.corrida_at,
           round((EXTRACT(EPOCH FROM (h.fch_hora_finalizacion
             - (h.fch_hora_para + dc.demora_informada * interval '1 minute'))) / 60.0)::numeric, 2) AS desfasaje
      FROM metricas_cumplimiento h
      JOIN LATERAL (
        SELECT d.demora_informada, d.corrida_at
          FROM demoras_calculadas d
         WHERE d.escenario     = h.escenario
           AND d.zona_id       = h.zona_nro
           AND d.tipo_servicio = h.tipo_servicio
           AND d.corrida_at   <= h.fch_hora_para
           AND d.corrida_at   >= h.fch_hora_para - interval '20 minutes'
         ORDER BY d.corrida_at DESC
         LIMIT 1
      ) dc ON true
     WHERE h.fecha >= DATE '2026-07-29'
       AND h.tipo_servicio IN ('URGENTE', 'NOCTURNO')
       AND h.reloj_inicio = 'ASIGNADO'
       AND h.fch_hora_para IS NOT NULL
       AND h.desfasaje_calc_mins IS NULL
  ) s
 WHERE m.origen    = s.origen
   AND m.pedido_id = s.pedido_id
   AND m.escenario = s.escenario;

-- 5e. Hechos NUEVOS para fechas anteriores al primer hecho existente
--     ("lo más atrás que se pueda"): el origen llega a fines de marzo.
--     Semana a semana con NOTICE de progreso; cada vuelta es atómica e
--     idempotente. Si el SQL Editor cortara por timeout, re-pegar SOLO
--     este paso: las semanas ya hechas se recalculan igual (ahí el DELETE
--     borra lo que este mismo backfill acaba de crear — no hay pérdida).
DO $backfill$
DECLARE
  v_primer_hecho date;
  v_ini          date := DATE '2026-03-23';
  v_d            date;
  v_fin_chunk    date;
  v_n            bigint;
BEGIN
  SELECT min(fecha) INTO v_primer_hecho FROM metricas_cumplimiento;
  IF v_primer_hecho IS NULL OR v_primer_hecho <= v_ini THEN
    RAISE NOTICE 'backfill pre-historia: nada para hacer (primer hecho: %)', v_primer_hecho;
    RETURN;
  END IF;

  v_d := v_ini;
  WHILE v_d < v_primer_hecho LOOP
    v_fin_chunk := least(v_d + 6, v_primer_hecho - 1);
    v_n := metricas_cumplimiento_run(v_d, v_fin_chunk);
    RAISE NOTICE 'backfill % .. % -> % hechos', v_d, v_fin_chunk, v_n;
    v_d := v_fin_chunk + 1;
  END LOOP;
END;
$backfill$;

-- 5f. Espejo en pedidos para TODO lo backfilleado (5a-5e solo tocaron
--     hechos; el espejo del día a día lo mantiene el run). Entra también
--     el hecho que SOLO tiene desfasaje del motor (demora informada sin
--     dato — el P6 del harness), y el guard cubre las 4 columnas: sin
--     eso, ese espejo quedaba incompleto para siempre (el cron solo
--     reprocesa [hoy-3, hoy-1]).
UPDATE pedidos p
   SET desfasaje_informado_mins    = m.desfasaje_informado_mins,
       demora_proyectada_calc_mins = m.demora_proyectada_calc_mins,
       corrida_calc_at             = m.corrida_calc_at,
       desfasaje_calc_mins         = m.desfasaje_calc_mins
  FROM metricas_cumplimiento m
 WHERE m.origen = 'PEDIDO'
   AND (m.desfasaje_informado_mins IS NOT NULL OR m.desfasaje_calc_mins IS NOT NULL)
   AND p.id        = m.pedido_id
   AND p.escenario = m.escenario
   AND (   p.desfasaje_informado_mins    IS DISTINCT FROM m.desfasaje_informado_mins
        OR p.demora_proyectada_calc_mins IS DISTINCT FROM m.demora_proyectada_calc_mins
        OR p.corrida_calc_at             IS DISTINCT FROM m.corrida_calc_at
        OR p.desfasaje_calc_mins         IS DISTINCT FROM m.desfasaje_calc_mins);


-- =====================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- =====================================================================
-- 1) Cobertura del desfasaje informado sobre el universo (esperada ~100%
--    de los URGENTE/NOCTURNO no agendados):
--    SELECT tipo_servicio,
--           count(*)                                   AS hechos,
--           count(desfasaje_informado_mins)            AS con_desfasaje,
--           round(100.0 * count(desfasaje_informado_mins) / count(*), 1) AS pct
--      FROM metricas_cumplimiento
--     WHERE tipo_servicio IN ('URGENTE','NOCTURNO')
--     GROUP BY tipo_servicio;
--
-- 2) EL NÚMERO DE ELLA — % acumulado por franja (esperado ~80% en <= 25):
--    SELECT round(100.0 * count(*) FILTER (WHERE abs(desfasaje_informado_mins) <= 25)
--                 / count(*), 1) AS pct_le_25,
--           round(100.0 * count(*) FILTER (WHERE abs(desfasaje_informado_mins) <= 90)
--                 / count(*), 1) AS pct_le_90
--      FROM metricas_cumplimiento
--     WHERE desfasaje_informado_mins IS NOT NULL AND tipo_servicio = 'URGENTE';
--
-- 3) Sanidad: para el universo, el desfasaje informado tiene que coincidir
--    con el atraso vs compromiso (max_ent_comp = para + demora_informada):
--    diferencias > 0.02 son casos donde el AS400 mandó otra demora después
--    de la toma — si aparecen muchos, avisar (rompe el supuesto de
--    inmutabilidad):
--    SELECT count(*)
--      FROM metricas_cumplimiento
--     WHERE desfasaje_informado_mins IS NOT NULL
--       AND atraso_vs_compromiso_mins IS NOT NULL
--       AND abs(desfasaje_informado_mins - atraso_vs_compromiso_mins) > 0.02;
--
-- 4) Hechos nuevos de la pre-historia (esperado: fechas desde fines de
--    marzo/abril):
--    SELECT min(fecha), max(fecha), count(*) FROM metricas_cumplimiento;
--
-- 5) Desfasaje del motor: cuántos hechos desde el 2026-07-29 lo tienen
--    (crece día a día con el motor prendido):
--    SELECT fecha, count(desfasaje_calc_mins) AS con_motor, count(*) AS total
--      FROM metricas_cumplimiento
--     WHERE fecha >= '2026-07-29' AND tipo_servicio IN ('URGENTE','NOCTURNO')
--     GROUP BY fecha ORDER BY fecha;
--
-- 6) La RPC responde:
--    SELECT metricas_desfasaje('{"escenario":1000}'::jsonb) -> 'kpis';
-- =====================================================================
