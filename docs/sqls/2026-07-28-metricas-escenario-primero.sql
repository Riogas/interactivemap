-- =====================================================================
-- Métricas de Cumplimiento — ESCENARIO COMO CLAVE PRINCIPAL
-- Fecha: 2026-07-28 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- CONTEXTO / POR QUÉ
-- ------------------
-- La tabla de hechos `metricas_cumplimiento` ya nace por escenario: la
-- columna es NOT NULL y forma parte de la PK (origen, pedido_id, escenario).
-- El job de cálculo y la RPC del dashboard también lo respetan.
--
-- Pero la capa de agregación NO: las 3 vistas vw_metricas_cumplimiento_*
-- agrupan por (chofer|movil|zona, periodo, tipo_servicio, empresa_fletera_id)
-- SIN escenario. Un mismo chofer/móvil/zona que opera en dos escenarios cae
-- en UNA sola fila sumada — números silenciosamente mezclados. Y los índices
-- lideran todos con `fecha`, cuando el patrón de acceso real siempre es
-- `escenario = X AND fecha BETWEEN ...` (comparar con moviles_dia, que sí
-- indexa (escenario_id, fecha, ...)).
--
-- Esta migración pone el escenario primero en TODA la cadena. Es ADITIVA
-- sobre los datos: NO borra ni recomputa un solo hecho (el escenario ya está
-- en cada fila). No hace falta TRUNCATE ni re-backfill.
--
-- QUÉ HACE
-- --------
--   1. escenario_settings.nombre  — catálogo de nombres legibles.
--   2. Índices liderados por escenario (crea antes de dropear los viejos).
--   3. Las 3 vistas recreadas con `escenario` 1ª en SELECT y GROUP BY.
--   4. Vista comparativa cross-escenario.
--   5. metricas_cumplimiento_run(desde, hasta, p_escenario DEFAULT NULL).
--   6. RPC metricas_dashboard escenario-aware (lista de escenarios para el
--      selector + comparativa cross-escenario en el mismo payload).
--
-- ⚠ SUPERSEDE a docs/sqls/2026-07-24-metricas-dashboard-rpc.sql (que NO
--   llegó a aplicarse en la base — verificado 2026-07-28: PGRST202). Este
--   archivo es self-contained: aplicando SOLO este quedan la RPC y todo lo
--   demás al día. Si se aplica el del 24/07 después, PISA la RPC nueva.
--
-- ORDEN: correr el archivo entero, de arriba a abajo, una sola vez.
-- =====================================================================


-- =====================================================================
-- 1. Catálogo de nombres de escenario
-- ---------------------------------------------------------------------
-- Se reusa `escenario_settings` (ya es la tabla de config por escenario,
-- PK escenario_id) en vez de crear un catálogo nuevo. `nombre` es opcional:
-- si está NULL, los consumidores caen a 'Escenario <id>'.
-- =====================================================================
ALTER TABLE escenario_settings ADD COLUMN IF NOT EXISTS nombre text;

COMMENT ON COLUMN escenario_settings.nombre IS
  'Nombre legible del escenario para mostrar en paneles (ej. "Montevideo"). NULL -> los consumidores muestran ''Escenario <id>''.';

-- Sembrar el escenario conocido si todavía no tiene nombre (editar a gusto).
UPDATE escenario_settings SET nombre = 'Escenario 1000'
 WHERE escenario_id = 1000 AND nombre IS NULL;


-- =====================================================================
-- 2. Índices liderados por escenario
-- ---------------------------------------------------------------------
-- Se CREAN primero y recién después se dropean los viejos, para que nunca
-- haya una ventana sin soporte de índice.
--
-- Se CONSERVA idx_metricas_cumpl_fecha (solo `fecha`): lo usa la purga del
-- run cuando corre escenario-agnóstico (p_escenario IS NULL), donde un
-- índice liderado por escenario no sirve.
-- =====================================================================

-- El caballo de batalla: todo consumidor filtra escenario + rango de fecha.
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_esc_fecha
  ON metricas_cumplimiento (escenario, fecha);

-- Scope por empresa fletera dentro de un escenario (filtro de la RPC y de
-- la lista de escenarios; permite index-only scan).
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_esc_fecha_empresa
  ON metricas_cumplimiento (escenario, fecha, empresa_fletera_id);

-- Equivalentes escenario-first de los 3 índices por dimensión que existían.
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_esc_fecha_movil
  ON metricas_cumplimiento (escenario, fecha, movil);
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_esc_fecha_zona
  ON metricas_cumplimiento (escenario, fecha, zona_nro);
CREATE INDEX IF NOT EXISTS idx_metricas_cumpl_esc_fecha_chofer
  ON metricas_cumplimiento (escenario, fecha, chofer);

-- Ahora sí: los viejos liderados por fecha quedan redundantes.
DROP INDEX IF EXISTS idx_metricas_cumpl_fecha_movil;
DROP INDEX IF EXISTS idx_metricas_cumpl_fecha_zona;
DROP INDEX IF EXISTS idx_metricas_cumpl_fecha_chofer;


-- =====================================================================
-- 3. Vistas de agregación — escenario como PRIMERA clave
-- ---------------------------------------------------------------------
-- DROP + CREATE (no CREATE OR REPLACE): replace no permite insertar una
-- columna al principio, solo agregar al final. Se usa DROP sin CASCADE a
-- propósito: si algo dependiera de estas vistas, queremos que falle acá y
-- enterarnos, en vez de dropearlo en silencio.
--
-- MÉTRICA PRINCIPAL: demora_efectiva_mins (regla de agendados). La bruta
-- queda en la tabla de hechos. promedio_atraso_mins es fin - para CON signo
-- (negativo = entregó antes; AVG ignora los NULL).
-- =====================================================================
DROP VIEW IF EXISTS vw_metricas_cumplimiento_diario;
DROP VIEW IF EXISTS vw_metricas_cumplimiento_semanal;
DROP VIEW IF EXISTS vw_metricas_cumplimiento_mensual;

CREATE VIEW vw_metricas_cumplimiento_diario AS
  SELECT escenario, 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         fecha AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*)                                                          AS cantidad,
         ROUND(AVG(demora_efectiva_mins), 2)                               AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins)                                         AS min_mins,
         MAX(demora_efectiva_mins)                                         AS max_mins,
         ROUND(AVG(atraso_vs_para_mins), 2)                                AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY escenario, chofer, fecha, tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'MOVIL', movil::text, fecha, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, movil, fecha, tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'ZONA', zona_nro::text, fecha, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, zona_nro, fecha, tipo_servicio, empresa_fletera_id;

CREATE VIEW vw_metricas_cumplimiento_semanal AS
  SELECT escenario, 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         date_trunc('week', fecha)::date AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*) AS cantidad, ROUND(AVG(demora_efectiva_mins),2) AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins) AS min_mins, MAX(demora_efectiva_mins) AS max_mins,
         ROUND(AVG(atraso_vs_para_mins),2) AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY escenario, chofer, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'MOVIL', movil::text, date_trunc('week', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, movil, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'ZONA', zona_nro::text, date_trunc('week', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, zona_nro, date_trunc('week', fecha), tipo_servicio, empresa_fletera_id;

CREATE VIEW vw_metricas_cumplimiento_mensual AS
  SELECT escenario, 'CHOFER'::text AS dimension, chofer::text AS dimension_valor,
         date_trunc('month', fecha)::date AS periodo, tipo_servicio, empresa_fletera_id,
         COUNT(*) AS cantidad, ROUND(AVG(demora_efectiva_mins),2) AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins) AS p90_mins,
         MIN(demora_efectiva_mins) AS min_mins, MAX(demora_efectiva_mins) AS max_mins,
         ROUND(AVG(atraso_vs_para_mins),2) AS promedio_atraso_mins
  FROM metricas_cumplimiento
  GROUP BY escenario, chofer, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'MOVIL', movil::text, date_trunc('month', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, movil, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id
  UNION ALL
  SELECT escenario, 'ZONA', zona_nro::text, date_trunc('month', fecha)::date, tipo_servicio, empresa_fletera_id,
         COUNT(*), ROUND(AVG(demora_efectiva_mins),2),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins),
         MIN(demora_efectiva_mins), MAX(demora_efectiva_mins),
         ROUND(AVG(atraso_vs_para_mins),2)
  FROM metricas_cumplimiento
  GROUP BY escenario, zona_nro, date_trunc('month', fecha), tipo_servicio, empresa_fletera_id;

COMMENT ON VIEW vw_metricas_cumplimiento_diario IS
  'Agregados diarios de metricas_cumplimiento POR ESCENARIO. escenario es la 1ª clave de agrupación: dos escenarios NUNCA se suman en la misma fila. Percentiles exactos por grupo; NO promediar estas columnas para recomponer un agregado mayor (promediar promedios da mal) — para eso ir a los hechos.';


-- =====================================================================
-- 4. Vista comparativa cross-escenario
-- ---------------------------------------------------------------------
-- Para responder "¿cómo viene cada escenario?" sin salir de SQL. Trae el
-- nombre desde escenario_settings, con fallback.
-- =====================================================================
DROP VIEW IF EXISTS vw_metricas_cumplimiento_escenarios;

CREATE VIEW vw_metricas_cumplimiento_escenarios AS
  SELECT m.escenario,
         COALESCE(es.nombre, 'Escenario ' || m.escenario)                    AS escenario_nombre,
         m.fecha, m.tipo_servicio, m.empresa_fletera_id,
         COUNT(*)                                                            AS cantidad,
         ROUND(AVG(m.demora_efectiva_mins), 2)                               AS promedio_mins,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY m.demora_efectiva_mins) AS mediana_mins,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY m.demora_efectiva_mins) AS p90_mins,
         ROUND(AVG(m.atraso_vs_para_mins), 2)                                AS promedio_atraso_mins,
         COUNT(*) FILTER (WHERE m.atraso_vs_para_mins <= 0)                   AS cantidad_a_tiempo,
         COUNT(*) FILTER (WHERE m.atraso_vs_para_mins IS NOT NULL)            AS cantidad_con_compromiso
  FROM metricas_cumplimiento m
  LEFT JOIN escenario_settings es ON es.escenario_id = m.escenario
  GROUP BY m.escenario, es.nombre, m.fecha, m.tipo_servicio, m.empresa_fletera_id;

COMMENT ON VIEW vw_metricas_cumplimiento_escenarios IS
  'Comparativa cross-escenario al grano (escenario, fecha, tipo_servicio, empresa). cantidad_a_tiempo/cantidad_con_compromiso vienen como CONTEOS a propósito, para que el consumidor calcule el % a tiempo sumando numerador y denominador (promediar porcentajes da mal).';


-- =====================================================================
-- 5. Job de cálculo — ahora acotable a un escenario
-- ---------------------------------------------------------------------
-- Antes: metricas_cumplimiento_run(desde, hasta) purgaba TODO el rango de
-- fechas sin distinguir escenario, así que no había forma de recomputar un
-- escenario sin volar los otros.
--
-- Ahora p_escenario acota purga e inserción. NULL (default) = todos los
-- escenarios -> el cron sigue llamando con 2 argumentos SIN cambios.
--
-- Se DROPEA la versión de 2 argumentos: si convivieran, la llamada con 2
-- args sería ambigua ("function is not unique") y el cron rompería.
-- =====================================================================
DROP FUNCTION IF EXISTS metricas_cumplimiento_run(date, date);

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
  -- Purga del rango a recomputar (así los que dejaron de calificar —p.ej.
  -- cambiaron de sub_estado— desaparecen). Acotada al escenario si viene.
  -- DELETE + INSERT corren en la misma transacción de la función: es atómico.
  DELETE FROM metricas_cumplimiento
   WHERE fecha BETWEEN p_desde AND p_hasta
     AND (p_escenario IS NULL OR escenario = p_escenario);

  WITH src AS (
    SELECT 'PEDIDO'::text AS origen, id AS pedido_id, escenario, servicio_nombre,
           movil, zona_nro, empresa_fletera_id, fletero,
           fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
           demora_movil_desde_asignacion_mins
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
           demora_movil_desde_asignacion_mins
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
      (asignado_efectivo IS NOT NULL AND fch_hora_para IS NOT NULL
        AND asignado_efectivo + interval '60 minute' < fch_hora_para) AS es_agendado,
      CASE WHEN fch_hora_para IS NOT NULL
        THEN EXTRACT(EPOCH FROM (fch_hora_finalizacion - fch_hora_para)) / 60.0
        ELSE NULL END AS atraso_bruto
    FROM calc
  ),
  ins AS (
    INSERT INTO metricas_cumplimiento (
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      fch_hora_asignado, fch_hora_finalizacion, fch_hora_para,
      demora_mins, demora_efectiva_mins, atraso_vs_para_mins, reloj_inicio, asignado_source
    )
    SELECT
      origen, pedido_id, escenario, fecha, tipo_servicio, servicio_nombre,
      movil, zona_nro, empresa_fletera_id, chofer,
      CASE WHEN asignado_source = 'CAMPO' THEN fch_hora_asignado ELSE NULL END,
      fch_hora_finalizacion, fch_hora_para,
      round(demora_bruta, 2),
      round(CASE WHEN es_agendado THEN greatest(0, atraso_bruto) ELSE demora_bruta END, 2),
      round(atraso_bruto, 2),
      CASE WHEN es_agendado THEN 'PARA' ELSE 'ASIGNADO' END,
      asignado_source
    FROM eff
    WHERE asignado_source IS NOT NULL   -- excluye sin_asignado_calculable
      AND demora_bruta >= 0             -- excluye demora_negativa
    ON CONFLICT (origen, pedido_id, escenario) DO UPDATE SET
      fecha                 = EXCLUDED.fecha,
      tipo_servicio         = EXCLUDED.tipo_servicio,
      servicio_nombre       = EXCLUDED.servicio_nombre,
      movil                 = EXCLUDED.movil,
      zona_nro              = EXCLUDED.zona_nro,
      empresa_fletera_id    = EXCLUDED.empresa_fletera_id,
      chofer                = EXCLUDED.chofer,
      fch_hora_asignado     = EXCLUDED.fch_hora_asignado,
      fch_hora_finalizacion = EXCLUDED.fch_hora_finalizacion,
      fch_hora_para         = EXCLUDED.fch_hora_para,
      demora_mins           = EXCLUDED.demora_mins,
      demora_efectiva_mins  = EXCLUDED.demora_efectiva_mins,
      atraso_vs_para_mins   = EXCLUDED.atraso_vs_para_mins,
      reloj_inicio          = EXCLUDED.reloj_inicio,
      asignado_source       = EXCLUDED.asignado_source
    RETURNING 1
  )
  SELECT count(*) INTO v_insertados FROM ins;

  RETURN v_insertados;
END;
$fn$;

COMMENT ON FUNCTION metricas_cumplimiento_run(date, date, integer) IS
  'Recomputa metricas_cumplimiento para [p_desde, p_hasta] (fecha en America/Montevideo). p_escenario NULL (default) = todos los escenarios; con valor, purga e inserta SOLO ese escenario. El cron sigue llamando con 2 args. Devuelve la cantidad de hechos escritos.';


-- =====================================================================
-- 6. RPC de lectura del dashboard — escenario-aware
-- ---------------------------------------------------------------------
-- Supersede a docs/sqls/2026-07-24-metricas-dashboard-rpc.sql. Cambios
-- respecto de aquella versión:
--   + `escenarios`  : lista de escenarios CON datos dentro del scope de
--                     empresa, para poblar el selector. Se calcula ANTES
--                     que nada, así que aunque el escenario pedido no tenga
--                     datos, la UI puede ofrecer los que sí.
--   + `comparativa` : mismos período/tipos/empresas, agregado por escenario,
--                     con percentiles EXACTOS (no promedio de promedios).
--   + `escenario_sel`: eco del escenario efectivamente consultado.
--
-- Percentiles EXACTOS: siempre percentile_cont directo sobre
-- metricas_cumplimiento, NUNCA sobre las vistas agregadas.
--
-- Seguridad: metricas_cumplimiento no tiene RLS; el único acceso legítimo
-- es vía getServerSupabaseClient() (service_role). SECURITY INVOKER
-- explícito + REVOKE de anon/authenticated/PUBLIC + GRANT solo a
-- service_role, como defensa en profundidad. El gate real es la ausencia de
-- acceso directo del cliente y el fail-closed de la API route.
--
-- NOTA de scope: `escenario` NO es un límite de autorización — nunca lo fue.
-- El usuario ya elegía el escenario tipeándolo en el login, y la API acepta
-- cualquier entero. El scope real es la allowlist por email + el filtro de
-- empresa fletera. La lista de `escenarios` respeta el filtro de empresa,
-- así que un usuario de fletera solo ve escenarios donde SU empresa operó.
--
-- Contrato de entrada `p` (todos opcionales salvo `escenario`):
--   escenario  int (requerido)
--   desde/hasta date|null   — período seleccionado; null en 1ra carga
--   ventana    'diario'|'semanal'|'mensual' (default 'diario')
--   dimension  'chofer'|'movil'|'zona'      (default 'chofer')
--   tipos      text[]|null  — null o [] = todos los tipos
--   empresas   int[]|null   — null = todas (root); [] = fail-closed
--
-- Contrato de salida (jsonb):
--   escenario_sel int
--   escenarios   [{ escenario, nombre, min_fecha, max_fecha, cantidad }]
--   rango        { min_fecha, max_fecha } | null
--   periodo_sel  { desde, hasta }
--   kpis / kpis_prev { cantidad, promedio, mediana, p90, min, max,
--                      promedio_atraso, on_time_pct }
--   serie        [{ periodo, promedio, p90, cantidad }]
--   por_tipo     [{ tipo_servicio, promedio, cantidad }]
--   ranking      [{ valor, promedio, mediana, p90, cantidad, atraso }]
--   comparativa  [{ escenario, nombre, promedio, mediana, p90, cantidad,
--                   promedio_atraso, on_time_pct }]
-- =====================================================================
CREATE OR REPLACE FUNCTION metricas_dashboard(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $fn$
DECLARE
  v_esc          integer;
  v_ventana      text;
  v_dimension    text;

  v_empresas_type  text;
  v_empresas       int[];
  v_empresas_empty boolean := false;

  v_tipos_type   text;
  v_tipos        text[];

  v_escenarios   jsonb;
  v_comparativa  jsonb;

  v_min          date;
  v_max          date;
  v_desde        date;
  v_hasta        date;
  v_len          integer;
  v_prev_desde   date;
  v_prev_hasta   date;
  v_trend_start  date;

  v_result       jsonb;

  EMPTY_KPIS CONSTANT jsonb := jsonb_build_object(
    'cantidad', 0, 'promedio', null, 'mediana', null, 'p90', null,
    'min', null, 'max', null, 'promedio_atraso', null, 'on_time_pct', null
  );
BEGIN
  -- ── 1. Extracción de params + guardas de tipo ──────────────────────────
  v_esc       := (p->>'escenario')::integer;
  v_ventana   := coalesce(p->>'ventana', 'diario');
  v_dimension := coalesce(p->>'dimension', 'chofer');
  IF v_ventana   NOT IN ('diario','semanal','mensual') THEN v_ventana := 'diario'; END IF;
  IF v_dimension NOT IN ('chofer','movil','zona')      THEN v_dimension := 'chofer'; END IF;

  -- empresas: null/ausente -> NULL (sin restricción, root); [] -> fail-closed;
  -- [...] -> array de int. Guardas de tipo explícitas (sin depender de
  -- short-circuit de AND/OR, que Postgres NO garantiza) para no invocar
  -- jsonb_array_length()/jsonb_array_elements_text() sobre un valor no-array.
  v_empresas_type := jsonb_typeof(p->'empresas');
  IF v_empresas_type IS NULL OR v_empresas_type = 'null' THEN
    v_empresas := NULL;
  ELSIF v_empresas_type = 'array' THEN
    IF jsonb_array_length(p->'empresas') = 0 THEN
      v_empresas := ARRAY[]::int[];
      v_empresas_empty := true;
    ELSE
      SELECT array_agg(x::int) INTO v_empresas FROM jsonb_array_elements_text(p->'empresas') AS x;
    END IF;
  ELSE
    v_empresas := NULL;
  END IF;

  -- tipos: null/[] -> NULL (todos los tipos); [...] -> array de text.
  v_tipos_type := jsonb_typeof(p->'tipos');
  IF v_tipos_type IS NULL OR v_tipos_type = 'null' THEN
    v_tipos := NULL;
  ELSIF v_tipos_type = 'array' THEN
    IF jsonb_array_length(p->'tipos') = 0 THEN
      v_tipos := NULL;
    ELSE
      SELECT array_agg(x) INTO v_tipos FROM jsonb_array_elements_text(p->'tipos') AS x;
    END IF;
  ELSE
    v_tipos := NULL;
  END IF;

  -- Fail-closed: empresas=[] explícito -> payload vacío constante, SIN
  -- escanear metricas_cumplimiento (ni siquiera para listar escenarios).
  IF v_empresas_empty THEN
    RETURN jsonb_build_object(
      'escenario_sel', v_esc,
      'escenarios', '[]'::jsonb,
      'rango', null,
      'periodo_sel', jsonb_build_object('desde', null, 'hasta', null),
      'kpis', EMPTY_KPIS,
      'kpis_prev', EMPTY_KPIS,
      'serie', '[]'::jsonb,
      'por_tipo', '[]'::jsonb,
      'ranking', '[]'::jsonb,
      'comparativa', '[]'::jsonb
    );
  END IF;

  -- ── 2. Escenarios disponibles (pobla el selector) ──────────────────────
  -- Se calcula ANTES del rango: si el escenario pedido no tiene datos, la UI
  -- igual recibe la lista de los que sí, y puede ofrecer el cambio.
  -- Respeta el scope de empresa (nunca revela escenarios ajenos).
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.escenario), '[]'::jsonb)
    INTO v_escenarios
  FROM (
    SELECT m.escenario,
           coalesce(es.nombre, 'Escenario ' || m.escenario) AS nombre,
           min(m.fecha) AS min_fecha,
           max(m.fecha) AS max_fecha,
           count(*)     AS cantidad
    FROM metricas_cumplimiento m
    LEFT JOIN escenario_settings es ON es.escenario_id = m.escenario
    WHERE (v_empresas IS NULL OR m.empresa_fletera_id = ANY(v_empresas))
    GROUP BY m.escenario, es.nombre
  ) e;

  -- ── 3. Rango disponible del escenario seleccionado ─────────────────────
  SELECT min(fecha), max(fecha) INTO v_min, v_max
  FROM metricas_cumplimiento
  WHERE escenario = v_esc
    AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas));

  -- Sin filas para ESTE escenario+scope: devolvemos vacío pero CON la lista
  -- de escenarios, para que el selector siga siendo usable.
  IF v_max IS NULL THEN
    RETURN jsonb_build_object(
      'escenario_sel', v_esc,
      'escenarios', v_escenarios,
      'rango', null,
      'periodo_sel', jsonb_build_object('desde', p->>'desde', 'hasta', p->>'hasta'),
      'kpis', EMPTY_KPIS,
      'kpis_prev', EMPTY_KPIS,
      'serie', '[]'::jsonb,
      'por_tipo', '[]'::jsonb,
      'ranking', '[]'::jsonb,
      'comparativa', '[]'::jsonb
    );
  END IF;

  -- ── 4. Resolución del período (desde/hasta null -> último disponible) ───
  v_desde := NULLIF(p->>'desde', '')::date;
  v_hasta := NULLIF(p->>'hasta', '')::date;

  IF v_desde IS NULL OR v_hasta IS NULL THEN
    IF v_ventana = 'diario' THEN
      v_desde := v_max;
      v_hasta := v_max;
    ELSIF v_ventana = 'semanal' THEN
      v_desde := date_trunc('week', v_max)::date;
      v_hasta := v_desde + 6;
    ELSE
      v_desde := date_trunc('month', v_max)::date;
      v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
    END IF;
  END IF;

  -- Clamp defensivo contra un desde/hasta manipulado desde el cliente.
  IF v_desde < v_min  THEN v_desde := v_min;  END IF;
  IF v_hasta > v_max  THEN v_hasta := v_max;  END IF;
  IF v_hasta < v_desde THEN v_hasta := v_desde; END IF;

  -- ── 5. Período previo (deltas), misma longitud que el elegido ──────────
  v_len        := v_hasta - v_desde;
  v_prev_hasta := v_desde - 1;
  v_prev_desde := v_prev_hasta - v_len;

  -- ── 6. Ventana de tendencia (últimos N períodos), clampeada a v_min ────
  IF v_ventana = 'diario' THEN
    v_trend_start := greatest(v_hasta - 29, v_min);       -- ~30 días
  ELSIF v_ventana = 'semanal' THEN
    v_trend_start := greatest(v_hasta - 83, v_min);       -- ~12 semanas
  ELSE
    v_trend_start := greatest((date_trunc('month', v_hasta) - interval '5 months')::date, v_min); -- 6 meses
  END IF;

  -- ── 7. Comparativa cross-escenario del período elegido ─────────────────
  -- Escaneo aparte: `win` (abajo) está acotado a v_esc, así que no sirve.
  -- Percentiles exactos por escenario; on_time_pct = a_tiempo / con_compromiso.
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.promedio ASC NULLS LAST), '[]'::jsonb)
    INTO v_comparativa
  FROM (
    SELECT m.escenario,
           coalesce(es.nombre, 'Escenario ' || m.escenario) AS nombre,
           round(avg(m.demora_efectiva_mins), 2) AS promedio,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.demora_efectiva_mins)::numeric, 2) AS mediana,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY m.demora_efectiva_mins)::numeric, 2) AS p90,
           count(*) AS cantidad,
           round(avg(m.atraso_vs_para_mins), 2) AS promedio_atraso,
           round(
             (count(*) FILTER (WHERE m.atraso_vs_para_mins <= 0))::numeric
             / nullif(count(*) FILTER (WHERE m.atraso_vs_para_mins IS NOT NULL), 0),
             4
           ) AS on_time_pct
    FROM metricas_cumplimiento m
    LEFT JOIN escenario_settings es ON es.escenario_id = m.escenario
    WHERE m.fecha BETWEEN v_desde AND v_hasta
      AND (v_empresas IS NULL OR m.empresa_fletera_id = ANY(v_empresas))
      AND (v_tipos    IS NULL OR m.tipo_servicio      = ANY(v_tipos))
    GROUP BY m.escenario, es.nombre
  ) c;

  -- ── 8. Un solo escaneo para el escenario elegido (CTE `win`,
  --      MATERIALIZED porque se referencia varias veces). ────────────────
  WITH win AS MATERIALIZED (
    SELECT *
    FROM metricas_cumplimiento
    WHERE escenario = v_esc
      AND fecha BETWEEN least(v_trend_start, v_prev_desde) AND v_hasta
      AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas))
      AND (v_tipos    IS NULL OR tipo_servicio      = ANY(v_tipos))
  ),
  sel AS (
    SELECT * FROM win WHERE fecha BETWEEN v_desde AND v_hasta
  ),
  prev AS (
    SELECT * FROM win WHERE fecha BETWEEN v_prev_desde AND v_prev_hasta
  ),
  kpis_sel AS (
    SELECT
      count(*) AS cantidad,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS mediana,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      round(min(demora_efectiva_mins), 2) AS min,
      round(max(demora_efectiva_mins), 2) AS max,
      round(avg(atraso_vs_para_mins), 2) AS promedio_atraso,
      round(
        (count(*) FILTER (WHERE atraso_vs_para_mins <= 0))::numeric
        / nullif(count(*) FILTER (WHERE atraso_vs_para_mins IS NOT NULL), 0),
        4
      ) AS on_time_pct
    FROM sel
  ),
  kpis_prev_calc AS (
    SELECT
      count(*) AS cantidad,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS mediana,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      round(min(demora_efectiva_mins), 2) AS min,
      round(max(demora_efectiva_mins), 2) AS max,
      round(avg(atraso_vs_para_mins), 2) AS promedio_atraso,
      round(
        (count(*) FILTER (WHERE atraso_vs_para_mins <= 0))::numeric
        / nullif(count(*) FILTER (WHERE atraso_vs_para_mins IS NOT NULL), 0),
        4
      ) AS on_time_pct
    FROM prev
  ),
  serie_calc AS (
    SELECT
      CASE v_ventana
        WHEN 'diario'  THEN fecha
        WHEN 'semanal' THEN date_trunc('week', fecha)::date
        ELSE date_trunc('month', fecha)::date
      END AS periodo,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      count(*) AS cantidad
    FROM win
    WHERE fecha BETWEEN v_trend_start AND v_hasta
    GROUP BY 1
    ORDER BY 1
  ),
  por_tipo_calc AS (
    SELECT
      tipo_servicio,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      count(*) AS cantidad
    FROM sel
    GROUP BY tipo_servicio
    ORDER BY tipo_servicio
  ),
  ranking_calc AS (
    SELECT
      CASE v_dimension
        WHEN 'chofer' THEN coalesce(nullif(trim(chofer), ''), '(sin chofer)')
        WHEN 'movil'  THEN CASE WHEN movil IS NULL OR movil = 0 THEN '(sin móvil)' ELSE movil::text END
        ELSE               CASE WHEN zona_nro IS NULL THEN '(sin zona)' ELSE zona_nro::text END
      END AS valor,
      round(avg(demora_efectiva_mins), 2) AS promedio,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS mediana,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY demora_efectiva_mins)::numeric, 2) AS p90,
      count(*) AS cantidad,
      round(avg(atraso_vs_para_mins), 2) AS atraso
    FROM sel
    GROUP BY 1
    ORDER BY promedio ASC
  )
  SELECT jsonb_build_object(
    'escenario_sel', v_esc,
    'escenarios', v_escenarios,
    'rango', jsonb_build_object('min_fecha', v_min, 'max_fecha', v_max),
    'periodo_sel', jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'kpis', (SELECT to_jsonb(k) FROM kpis_sel k),
    'kpis_prev', (SELECT to_jsonb(k) FROM kpis_prev_calc k),
    'serie', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM serie_calc s), '[]'::jsonb),
    'por_tipo', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM por_tipo_calc t), '[]'::jsonb),
    'ranking', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM ranking_calc r), '[]'::jsonb),
    'comparativa', v_comparativa
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION metricas_dashboard(jsonb) IS
  'Lectura agregada POR ESCENARIO (KPIs con percentiles exactos, tendencia, por-tipo, ranking) + lista de escenarios disponibles + comparativa cross-escenario, para /dashboard/metricas-cumplimiento. Solo lectura. Acceso exclusivo vía service_role. Fail-closed si p.empresas = []. Contrato completo en el header de docs/sqls/2026-07-28-metricas-escenario-primero.sql.';

-- ─── Grants: exclusivo service_role ───────────────────────────────────
REVOKE EXECUTE ON FUNCTION metricas_dashboard(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_dashboard(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_dashboard(jsonb) TO service_role;


-- =====================================================================
-- VERIFICACIÓN (correr después de aplicar)
-- =====================================================================
-- 1) Las 3 vistas + la comparativa ahora tienen `escenario`:
--    SELECT table_name, ordinal_position, column_name
--      FROM information_schema.columns
--     WHERE table_name LIKE 'vw_metricas_cumplimiento%' AND column_name = 'escenario'
--     ORDER BY table_name;
--    -- esperado: 4 filas, todas con ordinal_position = 1
--
-- 2) Índices escenario-first presentes y los viejos por-dimensión ya no:
--    SELECT indexname FROM pg_indexes
--     WHERE tablename = 'metricas_cumplimiento' ORDER BY indexname;
--    -- esperado: idx_metricas_cumpl_esc_fecha, _esc_fecha_chofer,
--    --           _esc_fecha_empresa, _esc_fecha_movil, _esc_fecha_zona,
--    --           idx_metricas_cumpl_fecha  (y NO los _fecha_movil/_zona/_chofer)
--
-- 3) El run acepta 2 y 3 argumentos, y el de 2 no quedó duplicado:
--    SELECT pg_get_function_identity_arguments(oid)
--      FROM pg_proc WHERE proname = 'metricas_cumplimiento_run';
--    -- esperado: UNA sola fila -> "date, date, integer"
--
-- 4) Recomputar UN escenario sin tocar los demás (idempotente, seguro):
--    SELECT metricas_cumplimiento_run('2026-07-27','2026-07-27', 1000);
--
-- 5) La RPC responde con los campos nuevos:
--    SELECT jsonb_pretty(metricas_dashboard('{"escenario":1000}'::jsonb));
--    -- esperado: escenario_sel=1000, escenarios=[{escenario:1000,...}],
--    --           comparativa con 1 fila, y kpis/serie/ranking poblados.
--
-- 6) Escenario inexistente -> vacío PERO con la lista de escenarios:
--    SELECT jsonb_pretty(metricas_dashboard('{"escenario":999999999}'::jsonb));
--    -- esperado: rango=null, kpis en cero, escenarios NO vacío.
--
-- 7) Fail-closed (empresas=[] explícito) -> todo vacío, sin escanear:
--    SELECT metricas_dashboard('{"escenario":1000,"empresas":[]}'::jsonb);
--
-- 8) Control de no-regresión: el total de hechos no cambió (esta migración
--    NO toca datos). Antes de aplicar valía 168315 (2026-07-28):
--    SELECT count(*) FROM metricas_cumplimiento;
-- =====================================================================
