-- =====================================================================
-- demoras_calcular_run — orquestador del motor de demora
-- Fecha: 2026-07-29 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- La ventana horaria se evalua ACA ADENTRO, no en la expresion cron:
-- pg_cron corre en UTC y la ventana 07:00-23:30 de Montevideo cruza la
-- medianoche UTC (10:00 a 02:30 del dia siguiente), lo que obligaria a
-- partirla en dos expresiones que se desincronizan sin que nadie se entere.
--
-- Devuelve la cantidad de filas escritas; 0 si el motor esta apagado o
-- estamos fuera de ventana.
--
-- Fix round 1 (2026-07-28), sobre bugs encontrados en review:
--   - fch_para es DATE en produccion, no TEXT: comparar con to_char(...)
--     tira "operator does not exist: date = text" en CADA corrida. Mismo
--     bug que ya tumbo moviles_dia (ver 2026-05-28-moviles-dia-functions-
--     fix-fchpara-date.sql). Se compara date = date directo.
--   - fch_para llega NULL desde la ingesta en ~4% de los pedidos reales
--     aunque fch_hora_para si trae el valor. Mismo patron que
--     2026-06-01-fix-pedidos-fch-para-null.sql: se tolera con
--     COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date).
--   - El universo salia de demoras_capacidad(), que solo agrega moviles
--     ACTIVOS: una zona con pedidos pendientes y CERO moviles activos hoy
--     (el peor caso operativo — 72% de la flota esta inactiva en un
--     momento dado) desaparecia sin dejar fila que auditar. El universo
--     ahora sale de moviles_zonas (igual que demoras_ritmo), y la
--     capacidad se LEFT JOINea: sin moviles activos, capacidad=0 y
--     sin_capacidad=true, pero la fila se escribe.
--
-- Fix round 2 (2026-07-28), sobre bugs encontrados en el fix round 1:
--   - La migracion de tabla dejo de ser idempotente: ritmo_default_minutos
--     se agrego solo dentro del CREATE TABLE IF NOT EXISTS, asi que sobre
--     una base donde demoras_config ya existia (creada por una version
--     anterior de la migracion) el CREATE se salteaba entero y la columna
--     nunca se agregaba -> el COMMENT ON COLUMN de esa columna explotaba.
--     Se agrego ALTER TABLE ... ADD COLUMN IF NOT EXISTS (ver la migracion
--     de tabla), convencion que el repo ya usa 48 veces en 21 migraciones.
--   - El CASE del crudo evaluaba "sin demanda" ANTES que "sin capacidad":
--     una zona con moviles asignados pero CERO activos hoy Y sin pedidos
--     pendientes informaba el PISO (30 min) en vez del TECHO. La respuesta
--     honesta a "cuanto demora" cuando no hay nadie trabajando no es "poco":
--     un pedido que entre ahora no tiene quien lo atienda. Se invirtio el
--     orden: la falta de capacidad manda sobre la falta de demanda. Y
--     sin_capacidad se ensancho a `capacidad <= 0` (antes exigia ademas
--     pendientes_total > 0): la bandera describe el estado de la OFERTA,
--     no la coincidencia entre oferta y demanda.
--   - ritmo_origen seguia diciendo 'GLOBAL' cuando el valor en realidad
--     salio de demoras_config.ritmo_default_minutos (ninguna estadistica
--     disponible, ni zona ni global) — la fila ya era reconstruible pero la
--     etiqueta de procedencia mentia. Se agrego 'DEFECTO' al CHECK de
--     ritmo_origen (ver la migracion de tabla) y se usa cuando corresponde.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_calcular_run(p_corrida_at timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_esc      integer := 1000;
  v_local    timestamp;
  v_fecha    date;
  v_hora     time;
  v_sa_mins  integer;
  v_escritas bigint;
BEGIN
  -- Un solo motor a la vez. pg_cron no serializa ejecuciones del mismo job:
  -- si una corrida tarda mas de 10 minutos, la siguiente arranca encima. El
  -- lock de transaccion se libera automaticamente al terminar la transaccion
  -- por cualquier motivo: commit, rollback por excepcion, o abort por
  -- cancelacion (statement_timeout, pg_cancel_backend). Esto evita el caso
  -- en que QUERY_CANCELED no sea capturado por EXCEPTION WHEN OTHERS y deje
  -- el lock pegado para la sesion entera.
  IF NOT pg_try_advisory_xact_lock(2180637405::bigint) THEN
    RAISE NOTICE 'demoras_calcular_run: ya hay una corrida en curso, salteando';
    RETURN 0;
  END IF;

  BEGIN
    -- La ventana horaria y el interruptor se evaluan POR TIPO, no globalmente:
    -- NOCTURNO tiene su propio horario. Por eso no hay early return aca; el
    -- filtro vive en el CTE `cfg` y se propaga por el JOIN de `universo`.
    v_local := p_corrida_at AT TIME ZONE 'America/Montevideo';
    v_fecha := v_local::date;
    v_hora  := v_local::time;

  -- Ventana de visibilidad de los sin-asignar. NO es config del motor: es la
  -- misma que ya usan la capa de capacidad de entrega y el mapa, y vive por
  -- escenario. NULL o 0 = sin filtro (compatibilidad hacia atras).
  SELECT es.pedidos_sa_minutos_antes INTO v_sa_mins
    FROM escenario_settings es WHERE es.escenario_id = v_esc;

  WITH
  -- Config por (escenario, tipo). Un tipo sin fila aca NO se calcula.
  cfg AS (
    SELECT * FROM demoras_config dc
     WHERE dc.escenario_id = v_esc
       AND dc.motor_activo
       AND v_hora BETWEEN dc.hora_inicio AND dc.hora_fin
  ),
  -- Zona activa: la bandera vive en la fila URGENTE del AS400 y la heredan
  -- NOCTURNO y SERVICE, que no tienen bandera propia.
  zonas_activas AS (
    SELECT DISTINCT d.zona_id
    FROM demoras d
    WHERE d.escenario_id = v_esc AND d.descripcion = 'URGENTE' AND d.activa
  ),
  cap AS (
    SELECT * FROM demoras_capacidad(v_esc, v_fecha)
  ),
  rit AS (
    SELECT * FROM demoras_ritmo(v_esc, v_fecha)
  ),
  -- Demanda: pendientes de hoy por zona. ESPECIAL y OTROS quedan FUERA por
  -- decision del usuario (2026-07-28): no se pliegan a URGENTE. Los pedidos
  -- de esos tipos no cuentan como demanda para ningun bucket.
  dem AS (
    SELECT zona_nro AS zona_id, tipo,
           count(*) FILTER (WHERE movil IS NOT NULL AND movil <> 0)::integer AS asignados,
           count(*) FILTER (WHERE movil IS NULL OR movil = 0)::integer       AS sin_asignar,
           count(*) FILTER (WHERE movil IS NOT NULL AND movil <> 0
                              AND NOT EXISTS (SELECT 1 FROM moviles_dia md
                                               WHERE md.escenario_id = v_esc
                                                 AND md.movil_id = p.movil
                                                 AND md.fecha = v_fecha
                                                 AND md.activo))::integer    AS atrapados
    FROM (
      -- Solo URGENTE y NOCTURNO exactos. Cualquier otro servicio_nombre
      -- (ESPECIAL*, o lo que sea) da tipo NULL y se descarta abajo.
      SELECT zona_nro, movil, fch_hora_para,
             CASE upper(trim(coalesce(servicio_nombre,'')))
               WHEN 'NOCTURNO' THEN 'NOCTURNO'
               WHEN 'URGENTE'  THEN 'URGENTE'
               ELSE NULL
             END AS tipo
      FROM pedidos
      WHERE escenario = v_esc AND estado_nro = 1
        -- fch_para (DATE) = v_fecha (DATE). fch_para llega NULL en ~4% de
        -- los pedidos reales aunque fch_hora_para si tenga valor: mismo
        -- gap que 2026-06-01-fix-pedidos-fch-para-null.sql, se tapa con el
        -- mismo COALESCE para no subestimar la demanda.
        AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
        AND zona_nro IS NOT NULL
      UNION ALL
      SELECT zona_nro, movil, fch_hora_para, 'SERVICE'
      FROM services
      WHERE escenario = v_esc AND estado_nro = 1
        AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
        AND zona_nro IS NOT NULL
    ) p
    WHERE p.tipo IS NOT NULL
      -- Ventana SA (regla canonica de la app, ver lib/sa-window-filter.ts
      -- isVisibleByWindow y app/api/zonas/capacidad-snapshot/route.ts):
      --   con movil asignado  -> cuenta SIEMPRE, aunque arranque mas tarde
      --   sin movil (SA)      -> cuenta solo si arranca dentro de la ventana
      -- Un SA que arranca mas alla de la ventana "no existe" todavia para el
      -- sistema, asi que tampoco debe empujar la demora hacia arriba.
      -- fch_hora_para NULL no filtra: falta de dato no es motivo de exclusion.
      -- OJO: este uso de fch_hora_para es la ventana SA, un concepto
      -- distinto del COALESCE de arriba (que decide DE QUE DIA es el
      -- pedido). Los dos usos del mismo campo conviven.
      AND (
        (p.movil IS NOT NULL AND p.movil <> 0)
        OR v_sa_mins IS NULL OR v_sa_mins = 0
        OR p.fch_hora_para IS NULL
        OR p.fch_hora_para <= p_corrida_at + (v_sa_mins * interval '1 minute')
      )
    GROUP BY zona_nro, tipo
  ),
  -- Universo: zona activa + tipo con moviles ASIGNADOS (moviles_zonas, igual
  -- que demoras_ritmo) + config vigente (motor prendido y dentro de la
  -- ventana horaria DE ESE TIPO). A PROPOSITO no sale de `cap`: demoras_
  -- capacidad solo agrega moviles ACTIVOS hoy, asi que una zona con pedidos
  -- pendientes y CERO moviles activos (el peor caso operativo) quedaria sin
  -- fila. `cap` se LEFT JOINea abajo: sin capacidad, capacidad=0 y
  -- sin_capacidad=true, pero la fila se escribe igual.
  universo AS (
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo_servicio,
           cf.min_minutos, cf.max_minutos, cf.escalon_minutos,
           cf.subida_max, cf.bajada_max, cf.estadistico, cf.factor_calibracion,
           cf.ritmo_default_minutos
    FROM moviles_zonas mz
    JOIN zonas_activas za ON za.zona_id = mz.zona_id
    JOIN cfg cf           ON cf.tipo_servicio = mz.tipo_de_servicio
    WHERE mz.escenario_id = v_esc
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  prev AS (
    SELECT DISTINCT ON (zona_id, tipo_servicio) zona_id, tipo_servicio, demora_suavizada
    FROM demoras_calculadas
    WHERE escenario = v_esc
      -- Cota inferior SARGABLE: sin esto el unico predicado usable es
      -- corrida_at < p_corrida_at, que en regimen (retencion 180 dias)
      -- selecciona ~4,5M filas y las deduplica 99 veces por dia.
      AND corrida_at >= (v_fecha::timestamp AT TIME ZONE 'America/Montevideo')
      AND corrida_at < p_corrida_at
      AND (corrida_at AT TIME ZONE 'America/Montevideo')::date = v_fecha
    ORDER BY zona_id, tipo_servicio, corrida_at DESC
  ),
  arm AS (
    SELECT
      u.zona_id, u.tipo_servicio,
      u.min_minutos, u.max_minutos, u.escalon_minutos,
      u.subida_max, u.bajada_max, u.factor_calibracion,
      coalesce(d.asignados,0) AS asignados,
      coalesce(d.sin_asignar,0) AS sin_asignar,
      coalesce(d.atrapados,0) AS atrapados,
      coalesce(c.capacidad_efectiva,0) AS capacidad,
      coalesce(c.moviles_activos,0) AS mov_act,
      coalesce(c.moviles_prioridad,0) AS mov_pri,
      coalesce(c.moviles_transito,0) AS mov_tra,
      coalesce(c.alpha_usado,0.3) AS alpha,
      r.ritmo_media, r.ritmo_mediana, r.ritmo_p75, r.ritmo_p90,
      r.ritmo_muestras,
      -- El estadistico configurado, con fallback a demoras_config.
      -- ritmo_default_minutos (antes un 30 hardcodeado que se usaba para
      -- calcular pero NO se persistia: la fila quedaba con ritmo_usado=NULL
      -- y un auditor no podia reconstruir demora_cruda desde las columnas
      -- guardadas). rc.stat (LATERAL) se calcula UNA sola vez y de ahi
      -- salen ritmo_usado Y ritmo_origen, para que ambos queden
      -- consistentes entre si.
      coalesce(rc.stat, u.ritmo_default_minutos) AS ritmo_usado,
      -- 'DEFECTO': no hubo estadistica (ni zona ni global, rc.stat NULL) y
      -- el valor salio de config. La etiqueta anterior ('GLOBAL' via
      -- coalesce ciego) decia que vino de un calculo global que no existio.
      CASE WHEN rc.stat IS NULL THEN 'DEFECTO'
           ELSE coalesce(r.ritmo_origen, 'GLOBAL') END AS ritmo_origen,
      p.demora_suavizada AS prev_suav,
      -- ORDER BY determinista: la clave natural de demoras incluye
      -- zona_tipo, asi que pueden existir varias filas legales por
      -- (escenario, zona, descripcion). Sin ORDER BY, LIMIT 1 devuelve una
      -- fila arbitraria y demora_as400 (la linea base de toda la fase 1)
      -- deja de ser reproducible.
      (SELECT dd.minutos FROM demoras dd
        WHERE dd.escenario_id = v_esc AND dd.zona_id = u.zona_id
          AND dd.descripcion = u.tipo_servicio
        ORDER BY dd.updated_at DESC, dd.demora_id DESC
        LIMIT 1) AS as400
    FROM universo u
    LEFT JOIN cap  c ON c.zona_id = u.zona_id AND c.tipo_servicio = u.tipo_servicio
    LEFT JOIN dem  d ON d.zona_id = u.zona_id AND d.tipo         = u.tipo_servicio
    LEFT JOIN rit  r ON r.zona_id = u.zona_id AND r.tipo_servicio = u.tipo_servicio
    LEFT JOIN prev p ON p.zona_id = u.zona_id AND p.tipo_servicio = u.tipo_servicio
    CROSS JOIN LATERAL (
      SELECT CASE u.estadistico WHEN 'MEDIA' THEN r.ritmo_media
                                WHEN 'P75'   THEN r.ritmo_p75
                                WHEN 'P90'   THEN r.ritmo_p90
                                ELSE r.ritmo_mediana END AS stat
    ) rc
  ),
  crudo AS (
    SELECT a.*,
           (a.asignados + a.sin_asignar) AS pendientes_total,
           -- Orden del CASE a proposito: la falta de capacidad manda sobre
           -- la falta de demanda. Si no hay NADIE trabajando en la zona, la
           -- respuesta honesta a "cuanto demora" no es el piso (30 min): un
           -- pedido que entre ahora no tiene quien lo atienda. El piso solo
           -- aplica cuando SI hay capacidad y la cola esta vacia (el caso
           -- genuinamente bueno).
           CASE
             WHEN a.capacidad <= 0                  THEN a.max_minutos::numeric
             WHEN (a.asignados + a.sin_asignar) = 0 THEN a.min_minutos::numeric
             ELSE ((a.asignados + a.sin_asignar)::numeric / a.capacidad)
                  * a.ritmo_usado * a.factor_calibracion
           END AS demora_cruda
    FROM arm a
  ),
  final AS (
    SELECT c.*, f.suavizada, f.informada, f.clampeado, f.suavizado_aplicado
    FROM crudo c
    CROSS JOIN LATERAL demoras_acabado(
      c.demora_cruda, c.prev_suav,
      c.min_minutos, c.max_minutos, c.subida_max, c.bajada_max, c.escalon_minutos
    ) f
  ),
  ins AS (
    INSERT INTO demoras_calculadas (
      corrida_at, escenario, zona_id, tipo_servicio,
      demora_informada, demora_suavizada, demora_cruda, demora_as400,
      pendientes_asignados, pendientes_sin_asignar, pendientes_atrapados,
      capacidad_efectiva, moviles_activos, moviles_prioridad, moviles_transito, alpha_usado,
      ritmo_media, ritmo_mediana, ritmo_p75, ritmo_p90, ritmo_usado, ritmo_origen, ritmo_muestras,
      sin_capacidad, clampeado, suavizado_aplicado
    )
    SELECT
      p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
      f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
      f.asignados, f.sin_asignar, f.atrapados,
      f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
      f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
      f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
      -- sin_capacidad describe el estado de la OFERTA (hay o no hay quien
      -- trabaje la zona), no la coincidencia entre oferta y demanda: antes
      -- exigia ademas pendientes_total > 0 y por eso salia false en el caso
      -- "sin capacidad y sin demanda", justo el peor caso operativo.
      (f.capacidad <= 0), f.clampeado, f.suavizado_aplicado
    FROM final f
    -- DO UPDATE cubre las 22 columnas no-PK: una re-corrida con la misma
    -- corrida_at pero insumos distintos (p.ej. el AS400 piso demora_as400
    -- entre medio) tiene que dejar una fila consistente de punta a punta,
    -- no una mezcla de "informada nueva" con "insumos viejos".
    ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio) DO UPDATE SET
      demora_informada        = EXCLUDED.demora_informada,
      demora_suavizada        = EXCLUDED.demora_suavizada,
      demora_cruda            = EXCLUDED.demora_cruda,
      demora_as400            = EXCLUDED.demora_as400,
      pendientes_asignados    = EXCLUDED.pendientes_asignados,
      pendientes_sin_asignar  = EXCLUDED.pendientes_sin_asignar,
      pendientes_atrapados    = EXCLUDED.pendientes_atrapados,
      capacidad_efectiva      = EXCLUDED.capacidad_efectiva,
      moviles_activos         = EXCLUDED.moviles_activos,
      moviles_prioridad       = EXCLUDED.moviles_prioridad,
      moviles_transito        = EXCLUDED.moviles_transito,
      alpha_usado             = EXCLUDED.alpha_usado,
      ritmo_media             = EXCLUDED.ritmo_media,
      ritmo_mediana           = EXCLUDED.ritmo_mediana,
      ritmo_p75               = EXCLUDED.ritmo_p75,
      ritmo_p90               = EXCLUDED.ritmo_p90,
      ritmo_usado             = EXCLUDED.ritmo_usado,
      ritmo_origen            = EXCLUDED.ritmo_origen,
      ritmo_muestras          = EXCLUDED.ritmo_muestras,
      sin_capacidad           = EXCLUDED.sin_capacidad,
      clampeado               = EXCLUDED.clampeado,
      suavizado_aplicado      = EXCLUDED.suavizado_aplicado
    RETURNING 1
  )
    SELECT count(*) INTO v_escritas FROM ins;

    RETURN v_escritas;
  EXCEPTION WHEN OTHERS THEN
    -- El lock de transaccion se libera automaticamente aunque hagamos RAISE.
    RAISE;
  END;
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora informada. Universo = zonas activas con moviles ASIGNADOS en moviles_zonas (no requiere moviles ACTIVOS hoy: una zona sin ningun movil activo escribe fila igual, con capacidad=0 y sin_capacidad=true, para poder auditar el peor caso operativo). La falta de capacidad manda sobre la falta de demanda: sin capacidad informa el techo (max_minutos) aunque no haya demanda, porque un pedido que entre ahora no tiene quien lo atienda; el piso (min_minutos) solo aplica con capacidad y cola vacia. La config vive en demoras_config por (escenario, tipo): el interruptor y la ventana horaria se evaluan POR TIPO, asi que NOCTURNO puede tener su propio horario. Un tipo sin fila de config no se calcula. fch_para tolera NULL via COALESCE con fch_hora_para. ritmo_usado persiste el valor efectivamente usado, con fallback a demoras_config.ritmo_default_minutos etiquetado como ritmo_origen=DEFECTO (no GLOBAL: no hubo calculo global). demora_as400 es deterministico (ORDER BY updated_at, demora_id). Devuelve filas escritas.';
