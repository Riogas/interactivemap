-- =====================================================================
-- demoras_acabado — clamp, suavizado asimetrico y redondeo
-- Fecha: 2026-07-29 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- El ORDEN es parte del contrato y no es negociable:
--   crudo -> clamp -> suavizado -> redondeo
-- Si se redondea antes de suavizar, el suavizado opera sobre escalones y
-- se traba en falso.
--
-- Devuelve DOS numeros a proposito:
--   suavizada  continua, sin redondear -> es el estado que arrastra a la
--              proxima corrida. Sin esto el redondeo se comeria los
--              incrementos chicos y el valor nunca se moveria.
--   informada  redondeada -> es la salida que se muestra.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_acabado(
  p_crudo   numeric,
  p_prev    numeric,   -- NULL = primera corrida del dia
  p_min     integer,
  p_max     integer,
  p_subida  integer,
  p_bajada  integer,
  p_escalon integer
)
RETURNS TABLE (
  suavizada          numeric,
  informada          integer,
  clampeado          text,
  suavizado_aplicado boolean
)
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_clamp  numeric;
  v_suav   numeric;
  v_marca  text := NULL;
  v_aplico boolean := false;
BEGIN
  -- 1-2. clamp
  v_clamp := p_crudo;
  IF v_clamp < p_min THEN v_clamp := p_min; v_marca := 'MIN'; END IF;
  IF v_clamp > p_max THEN v_clamp := p_max; v_marca := 'MAX'; END IF;

  -- 3. suavizado asimetrico contra la corrida anterior
  IF p_prev IS NULL THEN
    v_suav := v_clamp;
  ELSIF v_clamp > p_prev THEN
    v_suav := least(v_clamp, p_prev + p_subida);
    v_aplico := (v_suav < v_clamp);
  ELSIF v_clamp < p_prev THEN
    v_suav := greatest(v_clamp, p_prev - p_bajada);
    v_aplico := (v_suav > v_clamp);
  ELSE
    v_suav := v_clamp;
  END IF;

  -- 4. redondeo hacia arriba al escalon, sin salirse del techo
  RETURN QUERY SELECT
    v_suav,
    least(p_max, (ceil(v_suav::numeric / p_escalon) * p_escalon))::integer,
    v_marca,
    v_aplico;
END;
$fn$;

COMMENT ON FUNCTION demoras_acabado(numeric,numeric,integer,integer,integer,integer,integer) IS
  'Aplica clamp -> suavizado asimetrico -> redondeo hacia arriba. Devuelve la suavizada continua (estado para la proxima corrida) y la informada redondeada (salida). p_prev NULL = primera corrida del dia.';
