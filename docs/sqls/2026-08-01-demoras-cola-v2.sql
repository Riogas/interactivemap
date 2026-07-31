-- =====================================================================
-- demoras_cola v2 — la demanda pendiente por (zona, tipo), consumo por tramos
-- Fecha: 2026-08-01 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md secciones 2 y 5.
--
-- Parte de docs/sqls/2026-07-31-demoras-cola.sql (misma ventana SA, mismo
-- COALESCE de fch_para, mismo atrapados_modo) y cambia dos cosas:
--
--   1. cola_efectiva CAMBIA DE SIGNIFICADO: ahora incluye los pendientes ya
--      asignados a un movil ACTIVO dentro de la MISMA zona (asignados_activos
--      = asignados - atrapados). Antes ese trabajo estaba clavado a su movil
--      y entraba al modelo solo por el tiempo de liberacion de ese movil
--      (demoras_servidores.libre_en); en la calle el despacho reacomoda, asi
--      que asumir que ese pedido lo hace SI O SI el movil que lo tiene
--      asignado no es fiel -- ver DEMORA_MODELO_TRAMOS.md seccion 1, "el
--      segundo renglon". La contrapartida es demoras_aportes (Task 4): esa
--      funcion, que reemplaza a demoras_servidores, DEJA de contar estos
--      pedidos en el tiempo de liberacion del movil. Contarlos en los dos
--      lados seria exactamente el doble conteo que este modelo entero vino a
--      arreglar -- por eso los dos cambios tienen que viajar juntos y no se
--      puede aplicar esta migracion sola sin la Task 4 detras.
--
--   2. URGENTE y NOCTURNO UNEN su demanda: un movil haciendo un nocturno esta
--      igual de ocupado que si hiciera un urgente (seccion 5 de la spec), asi
--      que al calcular la cola de URGENTE se suman los pedidos URGENTE y
--      NOCTURNO de la zona, y viceversa. SERVICE no se mezcla con ninguno.
--      Los MOVILES no se unen -- eso lo resuelve demoras_aportes, que sigue
--      leyendo moviles_zonas por tipo -- asi que un movil puede estar
--      habilitado para URGENTE y no para NOCTURNO, y los dos tipos pueden dar
--      demora_informada distinta aunque vean la MISMA cola.
--
-- ORDEN DE APLICACION / riesgo cruzado (verificado leyendo el repo, no
-- estaba en el plan): demoras_proximo_hueco.sql -- el modelo PROXIMO_HUECO,
-- HOY activo en produccion via demoras_calcular_run -- tambien llama a
-- demoras_cola y usa cola_efectiva como "los sin asignar de la zona; los
-- asignados NO, porque ese trabajo ya esta adentro de libre_en" (comentario
-- textual en su propio encabezado). Esa lectura asume el significado VIEJO.
-- Si esta migracion se aplica con el motor PRENDIDO y demoras_modelo.modelo
-- todavia en PROXIMO_HUECO (osea, antes de que la Task 6 retire ese modelo y
-- pase a CONSUMO_TRAMOS), demoras_proximo_hueco pasaria a doble-contar los
-- asignados en zona: una vez via cola_efectiva y otra via libre_en. Es
-- seguro bajo la precondicion de toda esta tanda (Global Constraints del
-- plan): "el motor esta APAGADO en produccion (motor_activo = false)
-- mientras dura esta tanda", o aplicando la secuencia completa (hasta la
-- Task 6 inclusive) de una sola vez. No se modifica demoras_proximo_hueco.sql
-- aca -- esta fuera del alcance de esta task y la Task 6 lo reemplaza entero
-- por demoras_consumo_tramos.
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
    --
    -- La subconsulta escalar es DELIBERADA y no un `FROM escenario_settings`:
    -- si el escenario no tiene fila en esa tabla, un FROM deja este CTE
    -- vacio, y el CROSS JOIN de `visible` mas abajo colapsa la funcion
    -- entera a cero filas -- incluidos los pedidos ASIGNADOS, que por regla
    -- cuentan SIEMPRE. O sea: una tabla de configuracion incompleta hacia
    -- desaparecer la demanda en vez de degradar a "sin filtro", y el motor
    -- informaba el piso en zonas con cola real. Un SELECT sin FROM siempre
    -- devuelve exactamente una fila, con mins NULL cuando no hay
    -- configuracion, que es justo el caso "sin filtro". Mismo patron
    -- defensivo que usa demoras_ritmo v2 sobre la misma tabla.
    SELECT (SELECT es.pedidos_sa_minutos_antes
              FROM escenario_settings es
             WHERE es.escenario_id = p_escenario) AS mins
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
  -- URGENTE y NOCTURNO son equivalentes a los efectos de la demanda: un movil
  -- haciendo un nocturno esta igual de ocupado que si hiciera un urgente. Los
  -- MOVILES no se unen (eso lo resuelve demoras_aportes, que sale de
  -- moviles_zonas por tipo), pero la cola si.
  pool AS (
    SELECT 'URGENTE'::text  AS tipo_calculado, unnest(ARRAY['URGENTE','NOCTURNO']) AS tipo_pedido
    UNION ALL
    SELECT 'NOCTURNO',       unnest(ARRAY['URGENTE','NOCTURNO'])
    UNION ALL
    SELECT 'SERVICE',        'SERVICE'
  ),
  agg AS (
    SELECT v.zona_nro AS zona_id, p.tipo_calculado AS tipo,
           count(*) FILTER (WHERE v.movil IS NOT NULL AND v.movil <> 0)::integer AS asignados,
           count(*) FILTER (WHERE v.movil IS NULL OR v.movil = 0)::integer       AS sin_asignar,
           count(*) FILTER (WHERE v.movil IS NOT NULL AND v.movil <> 0
                              AND NOT EXISTS (SELECT 1 FROM moviles_dia md
                                               WHERE md.escenario_id = p_escenario
                                                 AND md.movil_id     = v.movil
                                                 AND md.fecha        = p_fecha
                                                 AND md.activo))::integer        AS atrapados
    FROM visible v
    JOIN pool p ON p.tipo_pedido = v.tipo
    GROUP BY v.zona_nro, p.tipo_calculado
  )
  SELECT a.zona_id, a.tipo, a.asignados, a.sin_asignar, a.atrapados,
         (a.sin_asignar
          + (a.asignados - a.atrapados)              -- NUEVO: asignados_activos, ver comentario de arriba
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
  'Demanda pendiente por (zona, tipo): conteos crudos de asignados / sin asignar / atrapados, mas cola_efectiva. cola_efectiva AHORA incluye los asignados a moviles ACTIVOS dentro de la misma zona (asignados - atrapados): ese trabajo pasa a ser demanda de la ZONA, no de su movil, y demoras_aportes (que reemplaza a demoras_servidores) deja de contarlo en el tiempo de liberacion para no contarlo dos veces. Los atrapados (asignados a un movil que hoy no salio) se suman aparte segun demoras_modelo.atrapados_modo. La demanda de URGENTE y NOCTURNO se UNE (un movil haciendo un nocturno esta igual de ocupado que si hiciera un urgente): la cola de cada uno de esos dos tipos incluye los pedidos URGENTE y NOCTURNO de la zona; SERVICE no se mezcla con ninguno. Aplica la ventana SA canonica (un asignado cuenta siempre; un sin asignar solo si arranca dentro de la ventana) y tolera fch_para NULL via COALESCE con fch_hora_para.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto:
-- sin este REVOKE, anon/authenticated (las claves que viajan al browser)
-- pueden invocarla via RPC. Mismo patron que
-- docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) TO service_role;
