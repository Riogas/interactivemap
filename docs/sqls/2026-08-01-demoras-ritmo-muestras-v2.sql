-- =====================================================================
-- demoras_ritmo_muestras v2 — piso del ritmo
-- Fecha: 2026-08-01 | Idempotente
--
-- Agrega p_hueco_min: el corte de huecos hasta ahora solo miraba para
-- arriba (p_hueco_max, para descartar almuerzos y recargas). Faltaba el de
-- abajo. Medido en produccion el 2026-07-31: de 194 zonas, 12 tenian ritmos
-- menores a 5 minutos, y una de 0.13 -- ocho segundos por entrega. Eso no
-- son moviles rapidos: son choferes marcando varias entregas juntas en el
-- AS400. Sin piso, esos intervalos casi nulos arrastran la mediana del
-- movil hacia abajo, lo hacen parecer instantaneo, y la zona informa mucho
-- menos demora de la real.
--
-- HAY QUE DROPEAR la version de 6 parametros: p_hueco_min no tiene default,
-- asi que una llamada de 6 argumentos no matchea la firma nueva de 7 -- pero
-- si no se dropea la vieja, sigue existiendo y siendo llamable por codigo
-- viejo, y quedan dos comportamientos vivos (uno con piso, uno sin).
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
-- sin pedidos). p_hueco_min descarta los intervalos casi nulos (marcacion
-- en lote). p_solo_con_cola es mas fino: cuenta el intervalo solo si el
-- pedido que se entrego YA estaba asignado cuando termino el anterior; si
-- se asigno despues, el movil estuvo esperando y ese tiempo es ocio, no
-- ritmo. Con la bandera prendida se excluyen tambien los hechos sin
-- fch_hora_asignado (asignado_source='DERIVADO'): sin ese dato no se puede
-- afirmar que hubiera cola, y para una metrica de ritmo es preferible
-- perder la muestra que inventarla.
--
-- ORDEN DE APLICACION: demoras_ritmo (docs/sqls/2026-07-31-demoras-ritmo-v2.sql)
-- y demoras_ritmo_movil (docs/sqls/2026-07-31-demoras-ritmo-movil.sql)
-- siguen llamando a esta funcion con 6 argumentos (sin p_hueco_min). Los dos
-- quedan sin lector con motor_activo=false: en demoras_calcular_run los
-- llaman via un CTE (`rit`, `hueco`->demoras_servidores->demoras_ritmo_movil)
-- que se hace LEFT JOIN contra `universo`, y `universo` se arma con un INNER
-- JOIN contra `cfg` filtrado por demoras_config.motor_activo -- con el motor
-- apagado ese universo queda vacio y Postgres nunca llega a ejecutar el lado
-- del LEFT JOIN que dispara la funcion (verificado con EXPLAIN y un marcador
-- de efecto de lado: mismo mecanismo que ya dejaba a salvo a
-- demoras_servidores del DROP COLUMN de transito_* en
-- docs/sqls/2026-08-01-demoras-modelo-tramos.sql). Es la misma precondicion
-- de toda esta tanda (ver el plan, seccion Global Constraints).
--
-- A DIFERENCIA de ese caso, esta firma nueva de 7 argumentos SI necesitaba
-- que alguien actualizara a los dos llamadores antes de reactivar
-- motor_activo -- si no, el cron vuelve a fallar en silencio cada 10
-- minutos, esta vez para SIEMPRE y no solo durante la ventana de
-- aplicacion. Eso ya se hizo: docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql
-- (Task 2, fix round 1) recrea demoras_ritmo y demoras_ritmo_movil para
-- pasar demoras_modelo.ritmo_hueco_min_minutos como septimo argumento. Se
-- aplica DESPUES de este archivo (archivo 14 vs. 13 en el bundle unico,
-- docs/DEMORA_INFORMADA.md seccion 1) -- no pegar este archivo solo sin el
-- 14 detras.
-- =====================================================================
DROP FUNCTION IF EXISTS demoras_ritmo_muestras(integer, date, integer, text, integer, boolean);

CREATE OR REPLACE FUNCTION demoras_ritmo_muestras(
  p_escenario     integer,
  p_hasta         date,
  p_dias          integer,
  p_metrica       text,
  p_hueco_max     integer,
  p_hueco_min     integer,
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
     AND i.mins >= p_hueco_min
     AND (
       NOT p_solo_con_cola
       OR (i.fch_hora_asignado IS NOT NULL AND i.fch_hora_asignado <= i.prev_fin)
     )
  UNION ALL
  SELECT h.zona_nro, h.tipo, h.movil, h.chofer, h.demora_efectiva_mins
    FROM hechos h
   WHERE p_metrica = 'ASIGNADO_A_ENTREGA';
$fn$;

COMMENT ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean) IS
  'Muestras crudas del ritmo, una fila por muestra. ENTRE_ENTREGAS = minutos entre cumplimientos consecutivos del mismo movil dentro del mismo dia local (el ritmo de trabajo real); ASIGNADO_A_ENTREGA = demora_efectiva_mins, que ya incluye la espera en cola y se conserva solo para poder comparar contra el modelo viejo. p_hueco_max corta almuerzos y ratos sin pedidos; p_hueco_min corta las marcaciones en lote (choferes marcando varias entregas juntas en el AS400 -- medido en produccion el 2026-07-31, 12 zonas de 194 con ritmo menor a 5 minutos, una de 8 segundos); p_solo_con_cola exige que el pedido ya estuviera asignado al terminar el anterior (y descarta los hechos sin fch_hora_asignado, donde eso no se puede afirmar).';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto:
-- sin este REVOKE, anon/authenticated (las claves que viajan al browser)
-- pueden invocarla via RPC. Mismo patron que
-- docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, integer, boolean) TO service_role;
