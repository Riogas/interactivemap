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
        AND fch_para = to_char(v_fecha, 'YYYYMMDD') AND zona_nro IS NOT NULL
      UNION ALL
      SELECT zona_nro, movil, fch_hora_para, 'SERVICE'
      FROM services
      WHERE escenario = v_esc AND estado_nro = 1
        AND fch_para = to_char(v_fecha, 'YYYYMMDD') AND zona_nro IS NOT NULL
    ) p
    WHERE p.tipo IS NOT NULL
      -- Ventana SA (regla canonica de la app, ver lib/sa-window-filter.ts
      -- isVisibleByWindow y app/api/zonas/capacidad-snapshot/route.ts):
      --   con movil asignado  -> cuenta SIEMPRE, aunque arranque mas tarde
      --   sin movil (SA)      -> cuenta solo si arranca dentro de la ventana
      -- Un SA que arranca mas alla de la ventana "no existe" todavia para el
      -- sistema, asi que tampoco debe empujar la demora hacia arriba.
      -- fch_hora_para NULL no filtra: falta de dato no es motivo de exclusion.
      AND (
        (p.movil IS NOT NULL AND p.movil <> 0)
        OR v_sa_mins IS NULL OR v_sa_mins = 0
        OR p.fch_hora_para IS NULL
        OR p.fch_hora_para <= p_corrida_at + (v_sa_mins * interval '1 minute')
      )
    GROUP BY zona_nro, tipo
  ),
  -- Universo: zona activa + tipo con moviles asignados + config vigente
  -- (motor prendido y dentro de la ventana horaria DE ESE TIPO).
  universo AS (
    SELECT c.zona_id, c.tipo_servicio,
           cf.min_minutos, cf.max_minutos, cf.escalon_minutos,
           cf.subida_max, cf.bajada_max, cf.estadistico, cf.factor_calibracion
    FROM cap c
    JOIN zonas_activas za ON za.zona_id = c.zona_id
    JOIN cfg cf          ON cf.tipo_servicio = c.tipo_servicio
  ),
  prev AS (
    SELECT DISTINCT ON (zona_id, tipo_servicio) zona_id, tipo_servicio, demora_suavizada
    FROM demoras_calculadas
    WHERE escenario = v_esc
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
      r.ritmo_origen, r.ritmo_muestras,
      CASE u.estadistico WHEN 'MEDIA' THEN r.ritmo_media
                         WHEN 'P75'   THEN r.ritmo_p75
                         WHEN 'P90'   THEN r.ritmo_p90
                         ELSE r.ritmo_mediana END AS ritmo_usado,
      p.demora_suavizada AS prev_suav,
      (SELECT dd.minutos FROM demoras dd
        WHERE dd.escenario_id = v_esc AND dd.zona_id = u.zona_id
          AND dd.descripcion = u.tipo_servicio LIMIT 1) AS as400
    FROM universo u
    LEFT JOIN cap  c ON c.zona_id = u.zona_id AND c.tipo_servicio = u.tipo_servicio
    LEFT JOIN dem  d ON d.zona_id = u.zona_id AND d.tipo         = u.tipo_servicio
    LEFT JOIN rit  r ON r.zona_id = u.zona_id AND r.tipo_servicio = u.tipo_servicio
    LEFT JOIN prev p ON p.zona_id = u.zona_id AND p.tipo_servicio = u.tipo_servicio
  ),
  crudo AS (
    SELECT a.*,
           (a.asignados + a.sin_asignar) AS pendientes_total,
           CASE
             WHEN (a.asignados + a.sin_asignar) = 0 THEN a.min_minutos::numeric
             WHEN a.capacidad <= 0                  THEN a.max_minutos::numeric
             ELSE ((a.asignados + a.sin_asignar)::numeric / a.capacidad)
                  * coalesce(a.ritmo_usado, 30) * a.factor_calibracion
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
      f.ritmo_usado, coalesce(f.ritmo_origen,'GLOBAL'), f.ritmo_muestras,
      (f.capacidad <= 0 AND f.pendientes_total > 0), f.clampeado, f.suavizado_aplicado
    FROM final f
    ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio) DO UPDATE SET
      demora_informada = EXCLUDED.demora_informada,
      demora_suavizada = EXCLUDED.demora_suavizada,
      demora_cruda     = EXCLUDED.demora_cruda,
      demora_as400     = EXCLUDED.demora_as400
    RETURNING 1
  )
  SELECT count(*) INTO v_escritas FROM ins;

  RETURN v_escritas;
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora informada. Corre sobre zonas activas con moviles asignados, usando solo moviles activos. La config vive en demoras_config por (escenario, tipo): el interruptor y la ventana horaria se evaluan POR TIPO, asi que NOCTURNO puede tener su propio horario. Un tipo sin fila de config no se calcula. Devuelve filas escritas.';
