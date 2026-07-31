-- =====================================================================
-- demoras_calcular_run v2 — despacho entre los dos modelos
-- Fecha: 2026-07-31 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Misma firma y mismo contrato externo que la version del 2026-07-29
-- (advisory lock, ventana horaria por tipo adentro de la funcion, devuelve
-- filas escritas). Cambia el adentro:
--
--   - La demanda sale de demoras_cola (antes: CTE `dem` inline).
--   - El crudo sale de demoras_proximo_hueco o del calculo viejo, segun
--     demoras_modelo.modelo. Los dos escriben en la MISMA tabla con las
--     mismas columnas, para poder compararlos sin transformar nada.
--   - Los topes, el estadistico y el factor salen de demoras_modelo.
--     demoras_config queda con motor_activo, hora_inicio, hora_fin y
--     ritmo_cascada (esta ultima NO se migra: ver el comentario junto al
--     ALTER TABLE mas abajo, es un desvio del plan verificado con el
--     harness -- dropearla rompe demoras_ritmo en runtime).
--   - Cada fila sella modelo_version.
--   - suavizado_bypass_cambio_capacidad: si cambio la cantidad de moviles
--     activos respecto de la corrida anterior, se pasa p_prev=NULL a
--     demoras_acabado, o sea se saltea el suavizado. La baja que produce un
--     refuerzo que acaba de entrar es real, y frenarla 50 minutos es
--     informar de mas cuando el movil ya esta en la calle.
--   - sin_capacidad describe el ESTADO DEL MUNDO en los DOS modelos: ningun
--     movil activo en la zona (a.mov_act <= 0), no la capacidad PRORRATEADA
--     que usa el modelo viejo para su propio atajo del techo. Con moviles
--     de transito y peso_transito_alpha=0, demoras_capacidad da
--     capacidad_efectiva=0 aunque haya moviles activos: sin este cuidado,
--     el modelo viejo marcaba sin_capacidad=true ahi y el nuevo no, y el
--     endpoint de comparativa EXCLUYE del promedio las filas con
--     sin_capacidad=true -- los dos modelos terminaban comparandose sobre
--     poblaciones distintas. Ver el comentario junto al CASE de sin_cap.
--
-- ORDEN DE APLICACION: este archivo BORRA columnas de demoras_config, asi
-- que tiene que aplicarse DESPUES de que las seis migraciones anteriores
-- esten puestas. Aplicarlo antes deja el motor viejo sin las columnas que
-- lee y falla callado cada 10 minutos.
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
  v_escritas bigint;
  m          record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(2180637405::bigint) THEN
    RAISE NOTICE 'demoras_calcular_run: ya hay una corrida en curso, salteando';
    RETURN 0;
  END IF;

  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = v_esc;
  IF NOT FOUND THEN
    RAISE NOTICE 'demoras_calcular_run: sin fila en demoras_modelo para el escenario %', v_esc;
    RETURN 0;
  END IF;

  v_local := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha := v_local::date;
  v_hora  := v_local::time;

  WITH
  -- Solo lo OPERATIVO por tipo. Un tipo sin fila aca no se calcula, y esa
  -- sigue siendo la forma de apagar un tipo sin borrar histórico.
  cfg AS (
    SELECT dc.tipo_servicio
      FROM demoras_config dc
     WHERE dc.escenario_id = v_esc
       AND dc.motor_activo
       AND v_hora BETWEEN dc.hora_inicio AND dc.hora_fin
  ),
  zonas_activas AS (
    SELECT DISTINCT d.zona_id
      FROM demoras d
     WHERE d.escenario_id = v_esc AND d.descripcion = 'URGENTE' AND d.activa
  ),
  cola AS (
    SELECT * FROM demoras_cola(v_esc, v_fecha, p_corrida_at)
  ),
  hueco AS (
    SELECT * FROM demoras_proximo_hueco(v_esc, v_fecha, p_corrida_at)
  ),
  cap AS (
    SELECT * FROM demoras_capacidad(v_esc, v_fecha)
  ),
  rit AS (
    SELECT * FROM demoras_ritmo(v_esc, v_fecha)
  ),
  universo AS (
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo_servicio
      FROM moviles_zonas mz
      JOIN zonas_activas za ON za.zona_id = mz.zona_id
      JOIN cfg cf           ON cf.tipo_servicio = mz.tipo_de_servicio
     WHERE mz.escenario_id = v_esc
       AND coalesce(mz.activa, true)
       AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  prev AS (
    SELECT DISTINCT ON (zona_id, tipo_servicio)
           zona_id, tipo_servicio, demora_suavizada, moviles_activos
      FROM demoras_calculadas
     WHERE escenario = v_esc
       AND corrida_at >= (v_fecha::timestamp AT TIME ZONE 'America/Montevideo')
       AND corrida_at < p_corrida_at
       AND (corrida_at AT TIME ZONE 'America/Montevideo')::date = v_fecha
     ORDER BY zona_id, tipo_servicio, corrida_at DESC
  ),
  arm AS (
    SELECT
      u.zona_id, u.tipo_servicio,
      coalesce(q.asignados,0)     AS asignados,
      coalesce(q.sin_asignar,0)   AS sin_asignar,
      coalesce(q.atrapados,0)     AS atrapados,
      coalesce(c.capacidad_efectiva,0) AS capacidad,
      coalesce(c.moviles_activos,0)    AS mov_act,
      coalesce(c.moviles_prioridad,0)  AS mov_pri,
      coalesce(c.moviles_transito,0)   AS mov_tra,
      coalesce(c.alpha_usado,0.3)      AS alpha,
      r.ritmo_media, r.ritmo_mediana, r.ritmo_p75, r.ritmo_p90, r.ritmo_muestras,
      coalesce(rc.stat, m.ritmo_default_minutos) AS ritmo_usado,
      CASE WHEN rc.stat IS NULL THEN 'DEFECTO'
           ELSE coalesce(r.ritmo_origen, 'GLOBAL') END AS ritmo_origen,
      p.demora_suavizada AS prev_suav,
      p.moviles_activos  AS prev_mov,
      h.demora_cruda     AS hueco_cruda,
      h.sin_capacidad    AS hueco_sin_cap,
      (SELECT dd.minutos FROM demoras dd
        WHERE dd.escenario_id = v_esc AND dd.zona_id = u.zona_id
          AND dd.descripcion = u.tipo_servicio
        ORDER BY dd.updated_at DESC, dd.demora_id DESC
        LIMIT 1) AS as400
    FROM universo u
    LEFT JOIN cola  q ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo_servicio
    LEFT JOIN hueco h ON h.zona_id = u.zona_id AND h.tipo_servicio = u.tipo_servicio
    LEFT JOIN cap   c ON c.zona_id = u.zona_id AND c.tipo_servicio = u.tipo_servicio
    LEFT JOIN rit   r ON r.zona_id = u.zona_id AND r.tipo_servicio = u.tipo_servicio
    LEFT JOIN prev  p ON p.zona_id = u.zona_id AND p.tipo_servicio = u.tipo_servicio
    CROSS JOIN LATERAL (
      SELECT CASE m.estadistico WHEN 'MEDIA' THEN r.ritmo_media
                                WHEN 'P75'   THEN r.ritmo_p75
                                WHEN 'P90'   THEN r.ritmo_p90
                                ELSE r.ritmo_mediana END AS stat
    ) rc
  ),
  crudo AS (
    SELECT a.*,
           CASE
             -- Modelo nuevo: el numero ya viene resuelto, con su propia
             -- bandera de sin capacidad y su propio techo.
             WHEN m.modelo = 'PROXIMO_HUECO' THEN a.hueco_cruda
             -- Modelo viejo, conservado tal cual para poder comparar. El
             -- orden del CASE importa: la falta de capacidad manda sobre la
             -- falta de demanda.
             WHEN a.capacidad <= 0                  THEN m.max_minutos::numeric
             WHEN (a.asignados + a.sin_asignar) = 0 THEN m.min_minutos::numeric
             ELSE ((a.asignados + a.sin_asignar)::numeric / a.capacidad)
                  * a.ritmo_usado * m.factor_calibracion
           END AS demora_cruda,
           -- sin_cap describe el ESTADO DEL MUNDO (¿habia algun movil
           -- activo en la zona?), no un atajo interno de un modelo en
           -- particular. Por eso la rama CAPACIDAD_PROMEDIO usa a.mov_act
           -- <= 0 y NO a.capacidad <= 0 (que si sigue usando la rama de
           -- demora_cruda de arriba, sin tocar: esa es la logica genuina
           -- del modelo viejo, no la bandera).
           --
           -- Con moviles de TRANSITO y peso_transito_alpha = 0 (config
           -- soportada por el CHECK de demoras_modelo y documentada en
           -- transito_modo=ALPHA), demoras_capacidad da capacidad_efectiva
           -- = 0 aunque haya moviles activos trabajando la zona. Antes de
           -- este fix, ese caso salia sin_capacidad=true en el modelo
           -- viejo y sin_capacidad=false en el nuevo (que solo mira si hay
           -- ALGUN movil activo, sin importar el prorrateo): el mismo dato
           -- quedaba en poblaciones distintas para el endpoint de
           -- comparativa, que EXCLUYE del promedio y de la brecha las
           -- filas con sin_capacidad=true. Comparar los dos modelos sobre
           -- los mismos datos -el punto de esta task- se rompe si cada
           -- modelo decide con una regla distinta cuales filas cuentan.
           --
           -- Con este fix, ese caso (transito puro, alpha=0) queda
           -- sin_capacidad=false en los DOS modelos, y el modelo viejo va
           -- a informar el techo igual (via a.capacidad <= 0 en
           -- demora_cruda) pero SIN la bandera puesta: eso es un defecto
           -- REAL del modelo viejo (el atajo del techo no coincide con
           -- "no habia nadie"), y que aparezca como una brecha grande en
           -- la comparacion es exactamente lo que se quiere ver, no algo
           -- para tapar.
           CASE WHEN m.modelo = 'PROXIMO_HUECO'
                THEN coalesce(a.hueco_sin_cap, true)
                ELSE (a.mov_act <= 0) END AS sin_cap,
           -- Bypass del suavizado: si cambio la cantidad de moviles activos
           -- respecto de la corrida anterior, la variacion es estructural
           -- (entro o salio un movil), no ruido. Frenarla es informar de mas
           -- cuando el refuerzo ya esta en la calle.
           CASE WHEN m.suavizado_bypass_cambio_capacidad
                     AND a.prev_mov IS DISTINCT FROM a.mov_act
                THEN NULL ELSE a.prev_suav END AS prev_efectivo
    FROM arm a
  ),
  final AS (
    SELECT c.*, f.suavizada, f.informada, f.clampeado, f.suavizado_aplicado
    FROM crudo c
    CROSS JOIN LATERAL demoras_acabado(
      c.demora_cruda, c.prev_efectivo,
      m.min_minutos, m.max_minutos, m.subida_max, m.bajada_max, m.escalon_minutos
    ) f
  ),
  ins AS (
    INSERT INTO demoras_calculadas (
      corrida_at, escenario, zona_id, tipo_servicio,
      demora_informada, demora_suavizada, demora_cruda, demora_as400,
      pendientes_asignados, pendientes_sin_asignar, pendientes_atrapados,
      capacidad_efectiva, moviles_activos, moviles_prioridad, moviles_transito, alpha_usado,
      ritmo_media, ritmo_mediana, ritmo_p75, ritmo_p90, ritmo_usado, ritmo_origen, ritmo_muestras,
      sin_capacidad, clampeado, suavizado_aplicado, modelo_version
    )
    SELECT
      p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
      f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
      f.asignados, f.sin_asignar, f.atrapados,
      f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
      f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
      f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
      f.sin_cap, f.clampeado, f.suavizado_aplicado, m.version
    FROM final f
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
      suavizado_aplicado      = EXCLUDED.suavizado_aplicado,
      modelo_version          = EXCLUDED.modelo_version
    RETURNING 1
  )
  SELECT count(*) INTO v_escritas FROM ins;

  RETURN v_escritas;
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora. Despacha entre PROXIMO_HUECO (simulacion de cola sobre tiempos de liberacion por movil) y CAPACIDAD_PROMEDIO (el modelo viejo) segun demoras_modelo.modelo, escribiendo las MISMAS columnas en los dos casos para poder compararlos. Los parametros del calculo salen de demoras_modelo (una fila por escenario); demoras_config queda solo con lo operativo por tipo (motor_activo, ventana horaria), asi que NOCTURNO conserva su horario propio. Cada fila sella modelo_version para que una corrida vieja se pueda reconstruir. Con suavizado_bypass_cambio_capacidad, un cambio en la cantidad de moviles activos saltea el suavizado: esa variacion es estructural, no ruido. sin_capacidad es igual en los dos modelos (ningun movil activo en la zona), no la capacidad prorrateada que usa el modelo viejo para su propio atajo del techo: los dos tienen que marcar las mismas filas, porque el endpoint de comparativa las excluye del promedio.';

-- ─── Baja de las columnas migradas ───────────────────────────────────
-- Recien ahora nadie las lee. Dejarlas seria garantizar que algun dia
-- demoras_config.estadistico y demoras_modelo.estadistico tengan valores
-- distintos y nadie sepa cual manda.
--
-- DESVIO DEL PLAN, verificado con el harness (docker, aplicando las 7
-- migraciones en orden y corriendo assert-ritmo.sql sin modificar):
-- ritmo_cascada NO se da de baja aca, a diferencia de las otras ocho.
-- demoras_ritmo (Task 3, ya commiteada y verde) sigue leyendola de
-- demoras_config, POR TIPO, con un GROUP BY tipo_servicio dentro de la
-- CTE cascada_cruda (docs/sqls/2026-07-31-demoras-ritmo-v2.sql:240-244).
-- Es una lectura real, no vestigial: assert-ritmo.sql prueba URGENTE y
-- SERVICE con cascadas DISTINTAS a la vez (lineas 313-314), algo que
-- demoras_modelo.ritmo_cascada -una fila por ESCENARIO, no por tipo- no
-- puede representar sin cambiar el diseño de esa tabla.
-- Dropear esta columna igual que las otras ocho rompe demoras_ritmo en
-- runtime ("column dc.ritmo_cascada does not exist"), y como
-- demoras_servidores, demoras_proximo_hueco Y este mismo orquestador
-- llaman a demoras_ritmo, el motor entero -los dos modelos, no solo el
-- viejo- queda fallando callado cada 10 minutos: exactamente el modo de
-- falla que este comentario de mas arriba dice evitar. demoras_modelo.
-- ritmo_cascada (Task 1) queda sin uso por ahora: migrar la cascada a
-- global-por-escenario es un cambio de diseño de demoras_ritmo, fuera del
-- alcance de esta task (que es solo el orquestador). Ver
-- docs/DEMORA_INFORMADA.md para el detalle.
ALTER TABLE demoras_config
  DROP COLUMN IF EXISTS min_minutos,
  DROP COLUMN IF EXISTS max_minutos,
  DROP COLUMN IF EXISTS escalon_minutos,
  DROP COLUMN IF EXISTS subida_max,
  DROP COLUMN IF EXISTS bajada_max,
  DROP COLUMN IF EXISTS estadistico,
  DROP COLUMN IF EXISTS ritmo_default_minutos,
  DROP COLUMN IF EXISTS factor_calibracion;

-- El CHECK de rango vivia sobre dos columnas que ya no estan.
ALTER TABLE demoras_config DROP CONSTRAINT IF EXISTS demoras_config_rango;

COMMENT ON TABLE demoras_config IS
  'Configuracion OPERATIVA del motor por (escenario, tipo de servicio): interruptor, ventana horaria y ritmo_cascada (por tipo -- ver demoras_ritmo). El resto de los parametros del CALCULO vive en demoras_modelo, una fila por escenario. Si falta la fila de un tipo, ese tipo no se calcula.';
