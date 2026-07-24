-- =====================================================================
-- Dashboard de Métricas de Cumplimiento — RPC de lectura
-- Fecha: 2026-07-24 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Crea metricas_dashboard(p jsonb), la ÚNICA RPC que consume
-- GET /api/metricas/dashboard (app/api/metricas/dashboard/route.ts) para
-- poblar /dashboard/metricas-cumplimiento. Migración ADITIVA: NO altera
-- metricas_cumplimiento, metricas_cumplimiento_run ni las vistas
-- vw_metricas_cumplimiento_* — es de solo lectura.
--
-- Decisión (ver plan del run 20260724-141300-2wy): `rango` (min/max fecha
-- disponible) viaja SIEMPRE en el mismo payload en vez de una función aparte
-- (`metricas_dashboard_rango`), así un solo round-trip alcanza para poblar
-- el period-picker + los datos del período elegido. En la primera carga la
-- UI manda desde/hasta = null y la función resuelve el último período
-- disponible según `ventana` (eco en `periodo_sel`).
--
-- Percentiles EXACTOS: mediana = percentile_cont(0.5), p90 = percentile_cont(0.9),
-- calculados SIEMPRE directo sobre metricas_cumplimiento (NUNCA sobre las
-- vistas agregadas — promediar promedios da mal, no se recomponen).
-- promedio/mediana/p90/min/max sobre demora_efectiva_mins; atraso/
-- promedio_atraso sobre atraso_vs_para_mins (AVG ignora NULL).
--
-- Seguridad: metricas_cumplimiento NO tiene RLS. El único acceso legítimo es
-- vía getServerSupabaseClient() (service_role, bypassa RLS) — el cliente
-- JAMÁS llama a Supabase directo. SECURITY INVOKER explícito (no escala
-- privilegios: no hay RLS que evadir, así que DEFINER no aportaría nada) +
-- REVOKE de anon/authenticated/PUBLIC + GRANT solo a service_role, como
-- defensa en profundidad (el gate real es la ausencia de acceso directo del
-- cliente y el fail-closed de la API route).
--
-- Contrato de entrada `p` (todos los campos opcionales salvo `escenario`):
--   escenario  int (requerido)
--   desde/hasta date|null   — período seleccionado; null en 1ra carga
--   ventana    'diario'|'semanal'|'mensual' (default 'diario')
--   dimension  'chofer'|'movil'|'zona'      (default 'chofer')
--   tipos      text[]|null  — null o [] = todos los tipos
--   empresas   int[]|null   — null = todas (root); [] = fail-closed (payload vacío)
--
-- Contrato de salida (jsonb):
--   rango        { min_fecha, max_fecha } | null (null = sin datos para el scope)
--   periodo_sel  { desde, hasta } — eco del período resuelto
--   kpis / kpis_prev   { cantidad, promedio, mediana, p90, min, max, promedio_atraso, on_time_pct }
--   serie        [{ periodo, promedio, p90, cantidad }]
--   por_tipo     [{ tipo_servicio, promedio, cantidad }]
--   ranking      [{ valor, promedio, mediana, p90, cantidad, atraso }] (ordenado por promedio ASC)
-- =====================================================================

CREATE OR REPLACE FUNCTION metricas_dashboard(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER -- explícito: ver nota de seguridad arriba, no escala privilegios.
AS $fn$
DECLARE
  v_esc          integer;
  v_ventana      text;
  v_dimension    text;

  v_empresas_type text;
  v_empresas      int[];
  v_empresas_empty boolean := false;

  v_tipos_type   text;
  v_tipos        text[];

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
  IF v_ventana NOT IN ('diario','semanal','mensual') THEN v_ventana := 'diario'; END IF;
  IF v_dimension NOT IN ('chofer','movil','zona') THEN v_dimension := 'chofer'; END IF;

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
    v_empresas := NULL; -- tipo inesperado -> defensivo, sin restricción
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

  -- Fail-closed (AC4/AC15 spec): empresas=[] explícito -> payload vacío
  -- constante, SIN escanear metricas_cumplimiento.
  IF v_empresas_empty THEN
    RETURN jsonb_build_object(
      'rango', null,
      'periodo_sel', jsonb_build_object('desde', null, 'hasta', null),
      'kpis', EMPTY_KPIS,
      'kpis_prev', EMPTY_KPIS,
      'serie', '[]'::jsonb,
      'por_tipo', '[]'::jsonb,
      'ranking', '[]'::jsonb
    );
  END IF;

  -- ── 2. Rango disponible (acota el period-picker) ───────────────────────
  SELECT min(fecha), max(fecha) INTO v_min, v_max
  FROM metricas_cumplimiento
  WHERE escenario = v_esc
    AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas));

  -- Edge case "rango vacío / sin datos": sin filas para el escenario+scope.
  IF v_max IS NULL THEN
    RETURN jsonb_build_object(
      'rango', null,
      'periodo_sel', jsonb_build_object('desde', p->>'desde', 'hasta', p->>'hasta'),
      'kpis', EMPTY_KPIS,
      'kpis_prev', EMPTY_KPIS,
      'serie', '[]'::jsonb,
      'por_tipo', '[]'::jsonb,
      'ranking', '[]'::jsonb
    );
  END IF;

  -- ── 3. Resolución del período (desde/hasta null -> último disponible) ──
  v_desde := NULLIF(p->>'desde', '')::date;
  v_hasta := NULLIF(p->>'hasta', '')::date;

  IF v_desde IS NULL OR v_hasta IS NULL THEN
    IF v_ventana = 'diario' THEN
      v_desde := v_max;
      v_hasta := v_max;
    ELSIF v_ventana = 'semanal' THEN
      v_desde := date_trunc('week', v_max)::date;
      v_hasta := v_desde + 6;
    ELSE -- mensual
      v_desde := date_trunc('month', v_max)::date;
      v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
    END IF;
  END IF;

  -- Clamp defensivo: el período elegido nunca puede quedar fuera de lo
  -- disponible (protege contra un desde/hasta manipulado desde el cliente).
  IF v_desde < v_min THEN v_desde := v_min; END IF;
  IF v_hasta > v_max THEN v_hasta := v_max; END IF;
  IF v_hasta < v_desde THEN v_hasta := v_desde; END IF;

  -- ── 4. Período previo (para los deltas), misma longitud que el elegido ─
  v_len        := v_hasta - v_desde;
  v_prev_hasta := v_desde - 1;
  v_prev_desde := v_prev_hasta - v_len;

  -- ── 5. Ventana de tendencia (últimos N períodos terminando en v_hasta),
  --      clampeada a v_min (edge case "tendencia en el borde"). ──────────
  IF v_ventana = 'diario' THEN
    v_trend_start := greatest(v_hasta - 29, v_min);       -- ~30 días
  ELSIF v_ventana = 'semanal' THEN
    v_trend_start := greatest(v_hasta - 83, v_min);       -- ~12 semanas
  ELSE
    v_trend_start := greatest((date_trunc('month', v_hasta) - interval '5 months')::date, v_min); -- 6 meses
  END IF;

  -- ── 6-11. Un solo escaneo (CTE `win`, MATERIALIZED porque se referencia
  --      varias veces) con todos los filtros de scope/tipos aplicados una
  --      sola vez; el resto son agregaciones sobre `win`/`sel`/`prev`. ────
  WITH win AS MATERIALIZED (
    SELECT *
    FROM metricas_cumplimiento
    WHERE escenario = v_esc
      AND fecha BETWEEN least(v_trend_start, v_prev_desde) AND v_hasta
      AND (v_empresas IS NULL OR empresa_fletera_id = ANY(v_empresas))
      AND (v_tipos IS NULL OR tipo_servicio = ANY(v_tipos))
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
    'rango', jsonb_build_object('min_fecha', v_min, 'max_fecha', v_max),
    'periodo_sel', jsonb_build_object('desde', v_desde, 'hasta', v_hasta),
    'kpis', (SELECT to_jsonb(k) FROM kpis_sel k),
    'kpis_prev', (SELECT to_jsonb(k) FROM kpis_prev_calc k),
    'serie', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM serie_calc s), '[]'::jsonb),
    'por_tipo', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM por_tipo_calc t), '[]'::jsonb),
    'ranking', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM ranking_calc r), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION metricas_dashboard(jsonb) IS
  'Lectura agregada (KPIs con percentiles exactos, tendencia, por-tipo, ranking) para /dashboard/metricas-cumplimiento. Solo lectura sobre metricas_cumplimiento; no altera nada. Acceso exclusivo vía service_role (ver GRANTs abajo). Fail-closed si p.empresas = [] (array vacío explícito). Contrato completo documentado en el header de este archivo.';

-- ─── Grants: exclusivo service_role (ver nota de seguridad del header) ────
REVOKE EXECUTE ON FUNCTION metricas_dashboard(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metricas_dashboard(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION metricas_dashboard(jsonb) TO service_role;

-- =====================================================================
-- Verificación (correr post-apply)
-- =====================================================================
-- Smoke sin datos (escenario inexistente) -> rango null, kpis en cero/null,
-- arrays vacíos, sin error:
--   SELECT metricas_dashboard('{"escenario":999999999}'::jsonb);
--
-- Smoke con datos reales (ajustar el escenario al que corrió el backfill de
-- metricas_cumplimiento_run — ver docs/METRICAS_CUMPLIMIENTO.md):
--   SELECT metricas_dashboard('{"escenario":1000,"ventana":"diario","dimension":"chofer"}'::jsonb);
--   SELECT metricas_dashboard('{"escenario":1000,"ventana":"semanal","dimension":"movil"}'::jsonb);
--   SELECT metricas_dashboard('{"escenario":1000,"ventana":"mensual","dimension":"zona","tipos":["URGENTE","NOCTURNO"]}'::jsonb);
--
-- Fail-closed (empresas=[] explícito) -> kpis.cantidad=0, arrays [], SIN
-- escanear metricas_cumplimiento (ver plan de ejecución con EXPLAIN si hace
-- falta confirmar que no hay Seq Scan sobre la tabla grande):
--   SELECT metricas_dashboard('{"escenario":1000,"empresas":[]}'::jsonb);
--
-- Verificar grants (debe listar únicamente service_role con EXECUTE):
--   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--   WHERE routine_name = 'metricas_dashboard';
-- =====================================================================
