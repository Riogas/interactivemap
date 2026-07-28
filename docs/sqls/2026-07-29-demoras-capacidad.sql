-- =====================================================================
-- demoras_capacidad — capacidad efectiva por (zona, tipo)
-- Fecha: 2026-07-29 | Idempotente
--
-- Un movil NO vale uno. Su presencia se reparte entre las zonas que
-- atiende, con peso 1 si es de prioridad y alpha si es de transito, y se
-- NORMALIZA dentro de cada tipo de servicio. Asi un movil que atiende 4
-- zonas nunca suma 4 moviles de capacidad.
--
-- Mismo mecanismo que lib/zonas-cap-entrega.ts, pero aplicado a la
-- PRESENCIA del movil en vez de a unidades de lote (el tamano del lote se
-- descarto explicitamente del modelo de demora).
--
-- Solo cuenta moviles con moviles_dia.activo = true.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_capacidad(p_escenario integer, p_fecha date)
RETURNS TABLE (
  zona_id            integer,
  tipo_servicio      text,
  capacidad_efectiva numeric,
  moviles_activos    integer,
  moviles_prioridad  integer,
  moviles_transito   integer,
  alpha_usado        numeric
)
LANGUAGE sql
STABLE
AS $fn$
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
    round(sum(CASE WHEN p.w > 0 THEN p.peso / p.w ELSE 0 END), 4) AS capacidad_efectiva,
    count(DISTINCT p.movil)::integer                          AS moviles_activos,
    count(DISTINCT p.movil) FILTER (WHERE p.es_prioridad)::integer     AS moviles_prioridad,
    count(DISTINCT p.movil) FILTER (WHERE NOT p.es_prioridad)::integer AS moviles_transito,
    (SELECT a FROM alpha)                                     AS alpha_usado
  FROM pesos p
  GROUP BY p.zona_id, p.tipo;
$fn$;

COMMENT ON FUNCTION demoras_capacidad(integer, date) IS
  'Capacidad efectiva por (zona, tipo): suma del aporte prorrateado de los moviles ACTIVOS. peso 1 prioridad / alpha transito, normalizado por tipo. Un movil nunca suma mas de 1 en total.';
