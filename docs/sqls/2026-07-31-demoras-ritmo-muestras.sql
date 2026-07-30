-- =====================================================================
-- demoras_ritmo_muestras — las muestras crudas del ritmo
-- Fecha: 2026-07-31 | Idempotente
--
-- Devuelve UNA FILA POR MUESTRA, sin agregar. demoras_ritmo la usa como su
-- CTE `base` y arma arriba la cascada CHOFER -> MOVIL -> ZONA -> GLOBAL.
--
-- Dos metricas, elegibles por demoras_modelo.ritmo_metrica:
--
--   ENTRE_ENTREGAS (la buena): minutos entre un cumplimiento y el
--     siguiente del MISMO movil, dentro del MISMO dia. Es cada cuanto
--     entrega, o sea el ritmo de trabajo. Es la metrica que el modelo del
--     proximo hueco necesita para calcular cuando se libera un movil.
--
--   ASIGNADO_A_ENTREGA (la vieja): demora_efectiva_mins, o sea
--     entrega - asignacion. NO es ritmo: ya incluye la espera detras de los
--     otros pedidos que el movil tenia arriba. Multiplicarla por la
--     cantidad de pendientes cuenta la cola dos veces (riesgo R1). Se
--     conserva UNICAMENTE para poder correr el modelo viejo sobre los
--     mismos datos y medir la diferencia.
--
-- La particion incluye la fecha LOCAL: el salto entre la ultima entrega de
-- un dia y la primera del siguiente no es un intervalo de trabajo, son 10
-- horas de noche. Sin eso, cada movil aportaria una muestra basura por dia.
--
-- p_hueco_max descarta los intervalos largos (almuerzo, recarga, un rato
-- sin pedidos). p_solo_con_cola es mas fino: cuenta el intervalo solo si el
-- pedido que se entrego YA estaba asignado cuando termino el anterior; si
-- se asigno despues, el movil estuvo esperando y ese tiempo es ocio, no
-- ritmo. Con la bandera prendida se excluyen tambien los hechos sin
-- fch_hora_asignado (asignado_source='DERIVADO'): sin ese dato no se puede
-- afirmar que hubiera cola, y para una metrica de ritmo es preferible
-- perder la muestra que inventarla.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo_muestras(
  p_escenario     integer,
  p_hasta         date,
  p_dias          integer,
  p_metrica       text,
  p_hueco_max     integer,
  p_solo_con_cola boolean
)
RETURNS TABLE (
  zona_nro integer,
  tipo     text,
  movil    integer,
  chofer   text,
  v        numeric
)
LANGUAGE sql
STABLE
AS $fn$
  WITH hechos AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.movil,
           m.chofer,
           m.fch_hora_finalizacion,
           m.fch_hora_asignado,
           m.demora_efectiva_mins
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS no tienen oferta propia en moviles_zonas: no son
      -- parte de ninguna cola del motor.
      AND m.tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  intervalos AS (
    SELECT h.zona_nro, h.tipo, h.movil, h.chofer, h.fch_hora_asignado,
           lag(h.fch_hora_finalizacion) OVER w AS prev_fin,
           EXTRACT(EPOCH FROM (
             h.fch_hora_finalizacion - lag(h.fch_hora_finalizacion) OVER w
           )) / 60.0 AS mins
    FROM hechos h
    WHERE h.movil IS NOT NULL
    WINDOW w AS (
      PARTITION BY h.movil, h.tipo,
                   (h.fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date
      ORDER BY h.fch_hora_finalizacion
    )
  )
  SELECT i.zona_nro, i.tipo, i.movil, i.chofer, round(i.mins::numeric, 2)
    FROM intervalos i
   WHERE p_metrica = 'ENTRE_ENTREGAS'
     AND i.mins IS NOT NULL
     AND i.mins > 0
     AND i.mins <= p_hueco_max
     AND (
       NOT p_solo_con_cola
       OR (i.fch_hora_asignado IS NOT NULL AND i.fch_hora_asignado <= i.prev_fin)
     )
  UNION ALL
  SELECT h.zona_nro, h.tipo, h.movil, h.chofer, h.demora_efectiva_mins
    FROM hechos h
   WHERE p_metrica = 'ASIGNADO_A_ENTREGA';
$fn$;

COMMENT ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, boolean) IS
  'Muestras crudas del ritmo, una fila por muestra. ENTRE_ENTREGAS = minutos entre cumplimientos consecutivos del mismo movil dentro del mismo dia local (el ritmo de trabajo real); ASIGNADO_A_ENTREGA = demora_efectiva_mins, que ya incluye la espera en cola y se conserva solo para poder comparar contra el modelo viejo. p_hueco_max corta almuerzos y ratos sin pedidos; p_solo_con_cola exige que el pedido ya estuviera asignado al terminar el anterior (y descarta los hechos sin fch_hora_asignado, donde eso no se puede afirmar).';
