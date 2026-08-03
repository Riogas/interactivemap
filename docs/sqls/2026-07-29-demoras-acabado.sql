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

  -- 4. redondeo hacia arriba al escalon, acotado por piso y techo
  -- El suavizado puede mover el valor fuera del rango si p_prev estaba fuera;
  -- la config es editable en caliente (demoras_config.min_minutos /
  -- demoras_config.max_minutos, por escenario y tipo),
  -- asi que volvemos a acotar aqui. La informada nunca sale del rango configurado.
  RETURN QUERY SELECT
    v_suav,
    greatest(p_min, least(p_max, (ceil(v_suav::numeric / p_escalon) * p_escalon)))::integer,
    v_marca,
    v_aplico;
END;
$fn$;

COMMENT ON FUNCTION demoras_acabado(numeric,numeric,integer,integer,integer,integer,integer) IS
  'Aplica clamp -> suavizado asimetrico -> redondeo hacia arriba, acotando por piso y techo. Devuelve la suavizada continua (estado para la proxima corrida) y la informada redondeada (salida). La informada nunca sale del rango [p_min, p_max] incluso si el suavizado la movieria fuera, lo que puede ocurrir cuando la config se edita en caliente. p_prev NULL = primera corrida del dia.';

-- ─── Grants: solo service_role (I3, review final de rama) ────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto: sin
-- este REVOKE, anon/authenticated (las claves que viajan al browser) pueden
-- invocarla via RPC. Quedaba sin revocar desde la tanda original (2026-07-29);
-- mismo patron que el resto de las funciones del motor.
REVOKE EXECUTE ON FUNCTION demoras_acabado(numeric,numeric,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_acabado(numeric,numeric,integer,integer,integer,integer,integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_acabado(numeric,numeric,integer,integer,integer,integer,integer) TO service_role;
