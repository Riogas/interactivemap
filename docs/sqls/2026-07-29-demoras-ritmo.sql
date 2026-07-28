-- =====================================================================
-- demoras_ritmo — cuanto tarda un pedido, por (zona, tipo)
-- Fecha: 2026-07-29 | Idempotente
--
-- Se calculan y devuelven LAS CUATRO estadisticas sobre
-- demora_efectiva_mins de los ultimos p_dias. Cual alimenta el calculo lo
-- decide la config (demora_estadistico); guardar las cuatro permite
-- reprocesar el historico con otra sin recalcular nada.
--
-- Si la zona no llega a p_min_muestras hechos, cae al global del tipo.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo(
  p_escenario    integer,
  p_hasta        date,
  p_dias         integer DEFAULT 7,
  p_min_muestras integer DEFAULT 5
)
RETURNS TABLE (
  zona_id        integer,
  tipo_servicio  text,
  ritmo_media    numeric,
  ritmo_mediana  numeric,
  ritmo_p75      numeric,
  ritmo_p90      numeric,
  ritmo_origen   text,
  ritmo_muestras integer
)
LANGUAGE sql
STABLE
AS $fn$
  WITH base AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.demora_efectiva_mins AS v
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS quedan FUERA del motor de demora por decision del
      -- usuario (2026-07-28): no se pliegan a URGENTE ni a ningun otro
      -- balde. Solo se informa demora de los tres tipos que tienen oferta
      -- propia en moviles_zonas.
      AND m.tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
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
  )
  SELECT z.zona_id,
         z.tipo,
         CASE WHEN z.n >= p_min_muestras THEN z.media   ELSE g.media   END,
         CASE WHEN z.n >= p_min_muestras THEN z.mediana ELSE g.mediana END,
         CASE WHEN z.n >= p_min_muestras THEN z.p75     ELSE g.p75     END,
         CASE WHEN z.n >= p_min_muestras THEN z.p90     ELSE g.p90     END,
         CASE WHEN z.n >= p_min_muestras THEN 'ZONA'    ELSE 'GLOBAL'  END,
         CASE WHEN z.n >= p_min_muestras THEN z.n       ELSE g.n       END
  FROM por_zona z
  LEFT JOIN global g ON g.tipo = z.tipo;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date, integer, integer) IS
  'Las cuatro estadisticas (media/mediana/p75/p90) de demora_efectiva_mins por (zona, tipo) sobre los ultimos p_dias. Cae al global del tipo si la zona no llega a p_min_muestras. ESPECIAL y OTROS se pliegan a URGENTE.';
