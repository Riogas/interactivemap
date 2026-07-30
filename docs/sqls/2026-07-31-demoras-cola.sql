-- =====================================================================
-- demoras_cola — la demanda pendiente por (zona, tipo)
-- Fecha: 2026-07-31 | Idempotente
--
-- Extrae la CTE `dem` que vivia adentro de demoras_calcular_run. Salio
-- afuera para poder testearla sola: la ventana SA, el COALESCE de fch_para
-- y el tratamiento de los atrapados son tres reglas con esquinas propias
-- que hoy no se pueden probar sin correr el motor entero.
--
-- Devuelve los conteos CRUDOS (asignados / sin_asignar / atrapados) para
-- auditoria, y `cola_efectiva`: lo que se pone en fila POR DELANTE del
-- pedido nuevo en la simulacion.
--
-- Por que cola_efectiva NO incluye a los asignados: el trabajo que un movil
-- ya tiene arriba entra al modelo por su tiempo de liberacion
-- (demoras_servidores.libre_en), no por la cola. Contarlo en los dos lados
-- seria exactamente el doble conteo que este modelo entero vino a arreglar.
--
-- ESPECIAL y OTROS quedan fuera (decision 2026-07-28): no tienen oferta
-- propia en moviles_zonas, asi que no son cola de nadie.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_cola(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id       integer,
  tipo_servicio text,
  asignados     integer,
  sin_asignar   integer,
  atrapados     integer,
  cola_efectiva integer
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    SELECT coalesce(dm.atrapados_modo, 'EXCLUIR') AS atrapados_modo
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  sa AS (
    -- Ventana de visibilidad de los sin-asignar. NO es config del motor: es
    -- la misma que usan la capa de capacidad de entrega y el mapa, y vive
    -- por escenario. NULL o 0 = sin filtro.
    SELECT es.pedidos_sa_minutos_antes AS mins
      FROM escenario_settings es WHERE es.escenario_id = p_escenario
  ),
  crudo AS (
    -- Solo URGENTE y NOCTURNO exactos desde pedidos; cualquier otro
    -- servicio_nombre da tipo NULL y se descarta.
    SELECT zona_nro, movil, fch_hora_para,
           CASE upper(trim(coalesce(servicio_nombre,'')))
             WHEN 'NOCTURNO' THEN 'NOCTURNO'
             WHEN 'URGENTE'  THEN 'URGENTE'
             ELSE NULL
           END AS tipo
    FROM pedidos
    WHERE escenario = p_escenario AND estado_nro = 1
      -- fch_para es DATE en produccion (comparar con to_char tira "operator
      -- does not exist: date = text", y solo al EJECUTAR). Llega NULL en
      -- ~4% de los pedidos aunque fch_hora_para si tenga valor: se tapa con
      -- el mismo COALESCE que 2026-06-01-fix-pedidos-fch-para-null.sql para
      -- no subestimar la demanda.
      AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND zona_nro IS NOT NULL
    UNION ALL
    SELECT zona_nro, movil, fch_hora_para, 'SERVICE'
    FROM services
    WHERE escenario = p_escenario AND estado_nro = 1
      AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND zona_nro IS NOT NULL
  ),
  visible AS (
    SELECT c.*
    FROM crudo c, sa
    WHERE c.tipo IS NOT NULL
      -- Regla canonica de la app (lib/sa-window-filter.ts isVisibleByWindow):
      --   con movil asignado -> cuenta SIEMPRE, aunque arranque mas tarde
      --   sin movil (SA)     -> cuenta solo si arranca dentro de la ventana
      -- fch_hora_para NULL no filtra: falta de dato no es motivo de exclusion.
      AND (
        (c.movil IS NOT NULL AND c.movil <> 0)
        OR sa.mins IS NULL OR sa.mins = 0
        OR c.fch_hora_para IS NULL
        OR c.fch_hora_para <= p_corrida_at + (sa.mins * interval '1 minute')
      )
  ),
  agg AS (
    SELECT v.zona_nro AS zona_id, v.tipo,
           count(*) FILTER (WHERE v.movil IS NOT NULL AND v.movil <> 0)::integer AS asignados,
           count(*) FILTER (WHERE v.movil IS NULL OR v.movil = 0)::integer       AS sin_asignar,
           count(*) FILTER (WHERE v.movil IS NOT NULL AND v.movil <> 0
                              AND NOT EXISTS (SELECT 1 FROM moviles_dia md
                                               WHERE md.escenario_id = p_escenario
                                                 AND md.movil_id     = v.movil
                                                 AND md.fecha        = p_fecha
                                                 AND md.activo))::integer        AS atrapados
    FROM visible v
    GROUP BY v.zona_nro, v.tipo
  )
  SELECT a.zona_id, a.tipo, a.asignados, a.sin_asignar, a.atrapados,
         (a.sin_asignar
          + CASE c.atrapados_modo
              -- EXCLUIR: nadie los va a entregar con la asignacion que
              -- tienen, asi que no empujan la demora del pedido nuevo.
              WHEN 'EXCLUIR'          THEN 0
              -- COMO_SIN_ASIGNAR: alguien los va a reasignar, compiten.
              WHEN 'COMO_SIN_ASIGNAR' THEN a.atrapados
              -- EN_COLA: idem, pero explicito como "quedan en la cola".
              ELSE a.atrapados
            END)::integer AS cola_efectiva
  FROM agg a CROSS JOIN cfg c;
$fn$;

COMMENT ON FUNCTION demoras_cola(integer, date, timestamptz) IS
  'Demanda pendiente por (zona, tipo): conteos crudos de asignados / sin asignar / atrapados, mas cola_efectiva, que es lo que se pone en fila por delante del pedido nuevo segun demoras_modelo.atrapados_modo. cola_efectiva NO incluye a los asignados a moviles activos: ese trabajo entra al modelo por el tiempo de liberacion del movil, y contarlo tambien en la cola seria doble conteo. Aplica la ventana SA canonica (un asignado cuenta siempre; un sin asignar solo si arranca dentro de la ventana) y tolera fch_para NULL via COALESCE con fch_hora_para.';
