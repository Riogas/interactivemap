-- =====================================================================
-- demoras_proximo_hueco — la simulacion
-- Fecha: 2026-07-31 | Idempotente
--
-- Averigua a que hora queda libre cada movil de la zona, hace la fila con
-- los pedidos que ya estan esperando, y ve en que momento le toca al
-- pedido nuevo:
--
--   1. Servidores    -> demoras_servidores (libre_en por movil, ya con
--                       transito_modo aplicado; los descartados no juegan).
--   2. Cola          -> demoras_cola.cola_efectiva (los sin asignar de la
--                       zona; los asignados NO, porque ese trabajo ya esta
--                       adentro de libre_en).
--   3. Reparto       -> cada pedido de la cola va al movil que se libera
--                       primero, y a ese movil se le corre el reloj su
--                       propio ritmo.
--   4. El nuevo      -> al que quede libre primero. La demora es esa espera
--                       mas su propia entrega (incluir_entrega_propia).
--
-- Por que un LOOP en plpgsql y no SQL puro: el reparto es inherentemente
-- secuencial (cada asignacion cambia quien es el minimo para la siguiente).
-- Expresarlo con window functions requiere un recursivo pesado y mucho
-- menos legible. El costo real es chico: ~106 zonas x 3 tipos, con pocos
-- moviles y pocas decenas de cola por zona. Se hace UNA sola pasada sobre
-- los datos (los servidores se agregan a arrays por zona antes del loop) y
-- adentro solo se recorren arrays en memoria.
--
-- Barrido lineal en vez de heap: con la cantidad de moviles que tiene una
-- zona real (unidades, no cientos), un heap es mas codigo y mas riesgo sin
-- ganancia medible.
--
-- Devuelve demora_cruda SIN clamp, suavizado ni redondeo: de eso se sigue
-- ocupando demoras_acabado, que no cambia.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_proximo_hueco(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id              integer,
  tipo_servicio        text,
  demora_cruda         numeric,
  moviles_considerados integer,
  libre_primero        numeric,
  cola_por_delante     integer,
  ritmo_aplicado       numeric,
  sin_capacidad        boolean
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  c            record;
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
  SELECT coalesce(dm.max_minutos, 120)::numeric      AS max_min,
         coalesce(dm.factor_calibracion, 1.0)        AS factor,
         coalesce(dm.incluir_entrega_propia, true)   AS incluir_entrega
    INTO c
    FROM (SELECT p_escenario AS e) x
    LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e;

  FOR z IN
    -- El universo sale de moviles_zonas, NO de los servidores: una zona con
    -- pedidos y CERO moviles activos (el peor caso operativo, y a las 07:00
    -- la mayoria) tiene que devolver fila igual, con sin_capacidad=true.
    -- Si saliera de los servidores, desapareceria sin dejar nada que auditar.
    SELECT u.zona_id, u.tipo,
           coalesce(s.libres, ARRAY[]::numeric[]) AS libres,
           coalesce(s.ritmos, ARRAY[]::numeric[]) AS ritmos,
           coalesce(q.cola_efectiva, 0)           AS cola
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
      demora_cruda         := c.max_min;
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

    -- Reparto de la cola: cada pedido al que se libera primero.
    FOR v_k IN 1 .. z.cola LOOP
      v_idx := 1;
      v_min := v_libres[1];
      FOR v_i IN 2 .. v_n LOOP
        IF v_libres[v_i] < v_min THEN
          v_min := v_libres[v_i];
          v_idx := v_i;
        END IF;
      END LOOP;
      v_libres[v_idx] := v_libres[v_idx] + v_ritmos[v_idx];
    END LOOP;

    -- El pedido nuevo va al que quede libre primero.
    v_idx := 1;
    v_min := v_libres[1];
    FOR v_i IN 2 .. v_n LOOP
      IF v_libres[v_i] < v_min THEN
        v_min := v_libres[v_i];
        v_idx := v_i;
      END IF;
    END LOOP;

    v_espera    := v_min;
    v_ritmo_sel := v_ritmos[v_idx];

    -- El cliente tiene la garrafa cuando el movil se la lleva, no cuando el
    -- movil arranca. incluir_entrega_propia=false deja la demora en la pura
    -- espera, para poder medir las dos definiciones en el backtest.
    v_demora := v_espera + CASE WHEN c.incluir_entrega THEN v_ritmo_sel ELSE 0 END;

    zona_id              := z.zona_id;
    tipo_servicio        := z.tipo;
    demora_cruda         := round(v_demora * c.factor, 2);
    moviles_considerados := v_n;
    cola_por_delante     := z.cola;
    ritmo_aplicado       := v_ritmo_sel;
    sin_capacidad        := false;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION demoras_proximo_hueco(integer, date, timestamptz) IS
  'Simulacion del proximo hueco por (zona, tipo): reparte los pedidos sin asignar entre los moviles activos, cada uno al que se libera primero, y ubica el pedido nuevo en el primer hueco que queda. La demora es esa espera mas la propia entrega (configurable). Devuelve demora_cruda SIN clamp, suavizado ni redondeo: de eso sigue ocupandose demoras_acabado. El universo sale de moviles_zonas y no de los servidores, para que una zona sin ningun movil activo devuelva fila igual con sin_capacidad=true y el techo, en vez de desaparecer sin dejar nada que auditar. libre_primero es el mejor tiempo de liberacion ANTES de repartir la cola, para poder separar cuanto de la demora es cola y cuanto es trabajo ya encima de los moviles.';
