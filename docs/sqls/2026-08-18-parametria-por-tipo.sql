-- ====================================================================
-- Parametria por ESCENARIO + TIPO DE SERVICIO
-- Fecha: 2026-08-18 | Idempotente | Aplicar via pg-meta.
-- ====================================================================
--
-- Pedido de Diego (18/8): "escenario y tipo de servicio abrelo asi... el de
-- urgente queda tal cual lo tenemos hoy y el nocturno es el nuevo que se
-- abre... y el laboratorio y el pienso para armar nuevas formulas debe
-- contemplar por escenario y tipo de servicio tambien para no confundirse".
--
-- Hasta hoy demoras_modelo tenia UNA fila por escenario y esa parametria
-- gobernaba los tres servicios. El nocturno estaba obligado a usar la
-- calibracion del urgente, que es justamente lo que lo rompe: mide 42% de
-- acierto contra 57% del Despacho, prometiendo 20 minutos de mas.
--
-- QUE HACE ESTA MIGRACION:
--   1. demoras_modelo pasa a tener PK (escenario_id, tipo_servicio).
--   2. Se clonan las filas NOCTURNO y SERVICE **identicas** a la de URGENTE.
--      => comportamiento byte a byte igual al de hoy. Nada cambia hasta que
--         alguien decida cambiar un valor de un tipo.
--   3. El motor recorre (escenario, tipo) en vez de (escenario) y cada
--      vuelta usa la parametria de SU tipo. Son dos lineas.
--   4. El historial de versiones tambien queda por tipo.
--
-- LO QUE **NO** HACE, Y ES IMPORTANTE:
--   demoras_corrida_meta (la caja negra) sigue guardando UN modelo por
--   corrida. Mientras los tres tipos sean identicos eso es exacto. En
--   cuanto se calibre NOCTURNO aparte, el simulador del laboratorio
--   heredaria el modelo de URGENTE para las variantes de nocturno y toda
--   esa medicion seria falsa SIN AVISAR.
--   Por eso el snapshot queda con una alarma: si detecta que algun tipo se
--   aparto, escribe en demoras_lab_errores. **Antes de tocar los valores
--   del nocturno hay que migrar la meta a (corrida, escenario, tipo).**
--
-- ROLLBACK: borrar las filas != 'URGENTE' de demoras_modelo y volver las
-- tres funciones (guardadas en scratchpad/now-*.sql del 18/8).
-- ====================================================================

-- --- 1. La parametria se abre por tipo -------------------------------
ALTER TABLE demoras_modelo
  ADD COLUMN IF NOT EXISTS tipo_servicio text NOT NULL DEFAULT 'URGENTE';

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_pkey;
ALTER TABLE demoras_modelo
  ADD CONSTRAINT demoras_modelo_pkey PRIMARY KEY (escenario_id, tipo_servicio);

ALTER TABLE demoras_modelo_historial
  ADD COLUMN IF NOT EXISTS tipo_servicio text NOT NULL DEFAULT 'URGENTE';

-- El historial tenia UNIQUE (escenario_id, version); ahora la version corre
-- por tipo, asi que la unicidad tiene que incluirlo.
ALTER TABLE demoras_modelo_historial
  DROP CONSTRAINT IF EXISTS demoras_modelo_historial_escenario_id_version_key;
ALTER TABLE demoras_modelo_historial
  DROP CONSTRAINT IF EXISTS demoras_modelo_historial_esc_tipo_version_key;
ALTER TABLE demoras_modelo_historial
  ADD CONSTRAINT demoras_modelo_historial_esc_tipo_version_key
  UNIQUE (escenario_id, tipo_servicio, version);

-- --- 2. NOCTURNO y SERVICE arrancan IDENTICOS a URGENTE --------------
INSERT INTO demoras_modelo
SELECT (jsonb_populate_record(NULL::demoras_modelo,
          to_jsonb(m) || jsonb_build_object('tipo_servicio', t.tipo))).*
FROM demoras_modelo m
CROSS JOIN (VALUES ('NOCTURNO'), ('SERVICE')) AS t(tipo)
WHERE m.tipo_servicio = 'URGENTE'
ON CONFLICT (escenario_id, tipo_servicio) DO NOTHING;

COMMENT ON COLUMN demoras_modelo.tipo_servicio IS
  'Servicio que gobierna esta parametria. URGENTE, NOCTURNO y SERVICE se calibran por separado: son operaciones distintas.';

-- --- 3. El motor usa la parametria de SU tipo ------------------------
CREATE OR REPLACE FUNCTION public.demoras_calcular_run(p_corrida_at timestamp with time zone DEFAULT now())
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_esc      integer;
  v_local    timestamp;
  v_fecha    date;
  v_hora     time;
  v_dia_tipo text;
  v_escritas bigint := 0;
  v_n        bigint;
  m          record;
BEGIN
  -- Lock UNA sola vez, ANTES del loop: serializa la corrida entera. Ver el
  -- comentario extenso del encabezado.
  IF NOT pg_try_advisory_xact_lock(2180637405::bigint) THEN
    RAISE NOTICE 'demoras_calcular_run: ya hay una corrida en curso, salteando';
    RETURN 0;
  END IF;

  -- La hora local es la MISMA para todos los escenarios: es una conversion
  -- de huso horario sobre p_corrida_at, no algo que dependa del escenario.
  v_local    := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha    := v_local::date;
  v_hora     := v_local::time;
  v_dia_tipo := demoras_dia_tipo(v_fecha);

  -- Un escenario se calcula si y solo si tiene fila en demoras_modelo. Uno
  -- con demoras_config pero SIN demoras_modelo no aparece aca y no se
  -- calcula -- es la misma logica que hoy usa un tipo sin fila en
  -- demoras_config para quedar apagado, un nivel mas arriba.
  FOR m IN SELECT * FROM demoras_modelo ORDER BY escenario_id, tipo_servicio LOOP
    v_esc := m.escenario_id;

    WITH
    -- Solo lo OPERATIVO por tipo. Un tipo sin fila aca no se calcula, y esa
    -- sigue siendo la forma de apagar un tipo sin borrar historico.
    -- v6: la ventana horaria sale de demoras_ventanas (por tipo de dia)
    -- cuando hay fila, y cae a demoras_config si no la hay -- NOCTURNO y
    -- SERVICE no estan sembrados y siguen gateando como siempre.
    cfg AS (
      SELECT dc.tipo_servicio,
             coalesce(dv.hora_inicio, dc.hora_inicio) AS ventana_inicio
        FROM demoras_config dc
        LEFT JOIN demoras_ventanas dv
               ON dv.escenario_id  = dc.escenario_id
              AND dv.tipo_servicio = dc.tipo_servicio
              AND dv.dia_tipo      = v_dia_tipo
       WHERE dc.escenario_id = v_esc
         AND dc.tipo_servicio = m.tipo_servicio
         AND dc.motor_activo
         AND v_hora BETWEEN coalesce(dv.hora_inicio, dc.hora_inicio)
                        AND coalesce(dv.hora_fin,    dc.hora_fin)
    ),
    zonas_activas AS (
      SELECT DISTINCT d.zona_id
        FROM demoras d
       WHERE d.escenario_id = v_esc AND d.descripcion = 'URGENTE' AND d.activa
    ),
    cola AS (
      SELECT * FROM demoras_cola(v_esc, v_fecha, p_corrida_at)
    ),
    -- Reemplaza al CTE `hueco` de la v2 (demoras_proximo_hueco). Devuelve
    -- demora_cruda SIN clamp/suavizado/redondeo (eso lo hace demoras_acabado
    -- mas abajo, sin cambios) y las columnas de auditoria del modelo nuevo:
    -- capacidad_inicial, capacidad_final, tramos, cola_por_delante,
    -- moviles_considerados. NO se lee tr.sin_capacidad aca -- ver el
    -- comentario extenso del encabezado sobre por que esa columna usa
    -- moviles_activos en los dos modelos y no el atajo interno de ninguno.
    tr AS (
      SELECT * FROM demoras_consumo_tramos(v_esc, v_fecha, p_corrida_at)
    ),
    cap AS (
      SELECT * FROM demoras_capacidad(v_esc, v_fecha)
    ),
    rit AS (
      SELECT * FROM demoras_ritmo(v_esc, v_fecha)
    ),
    universo AS (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo_servicio,
             cf.ventana_inicio
        FROM moviles_zonas mz
        JOIN zonas_activas za ON za.zona_id = mz.zona_id
        JOIN cfg cf           ON cf.tipo_servicio = mz.tipo_de_servicio
       WHERE mz.escenario_id = v_esc
         AND coalesce(mz.activa, true)
         AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ),
    -- La corrida anterior DENTRO de este escenario -filtrado por
    -- escenario = v_esc, que es la columna lider del indice
    -- idx_demoras_calc_esc_zona_tipo_at. Ver el comentario del encabezado
    -- sobre por que este indice sigue sirviendo con N escenarios.
    -- v6: tambien arrastra arranque_fase para detectar la ENTRADA en fase
    -- TRANSITO (bypass del suavizado en esa transicion).
    prev AS (
      SELECT DISTINCT ON (zona_id, tipo_servicio)
             zona_id, tipo_servicio, demora_suavizada, moviles_activos,
             arranque_fase
        FROM demoras_calculadas
       WHERE escenario = v_esc
         AND corrida_at >= (v_fecha::timestamp AT TIME ZONE 'America/Montevideo')
         AND corrida_at < p_corrida_at
         AND (corrida_at AT TIME ZONE 'America/Montevideo')::date = v_fecha
       ORDER BY zona_id, tipo_servicio, corrida_at DESC
    ),
    -- ── Estimacion de la primera activacion (arranque PREDICTIVO) ────
    -- Historico de primeras activaciones de PRIORIDAD, con dos ventanas
    -- moviles: la del MISMO tipo de dia (ultimos 10 habiles / 4 finde) y
    -- la general de la zona (ultimos 10 dias con activacion). Los dias
    -- SIN activacion no cuentan como muestra: el estimador dice "cuando
    -- viene, viene a esta hora"; si hoy no viene, lo cubren la gracia y
    -- la espera maxima.
    act_hist AS (
      SELECT h.zona_id, h.tipo_servicio, h.dia_tipo, h.primer_prioridad_at,
             row_number() OVER (PARTITION BY h.zona_id, h.tipo_servicio, h.dia_tipo
                                ORDER BY h.fecha DESC) AS rn_tipo,
             row_number() OVER (PARTITION BY h.zona_id, h.tipo_servicio
                                ORDER BY h.fecha DESC) AS rn_gral
        FROM demoras_activacion_hist h
       WHERE h.escenario_id = v_esc
         AND h.fecha <  v_fecha
         AND h.fecha >= v_fecha - 35
         AND h.primer_prioridad_at IS NOT NULL
    ),
    act_tipo AS (
      SELECT ah.zona_id, ah.tipo_servicio,
             count(*)::integer AS muestras,
             percentile_cont(m.activacion_percentil::double precision) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (ah.primer_prioridad_at
                                            AT TIME ZONE 'America/Montevideo')::time)::double precision
             ) AS seg
        FROM act_hist ah
       WHERE ah.dia_tipo = v_dia_tipo
         AND ah.rn_tipo <= CASE WHEN v_dia_tipo = 'HABIL' THEN 10 ELSE 4 END
       GROUP BY ah.zona_id, ah.tipo_servicio
    ),
    act_gral AS (
      SELECT ah.zona_id, ah.tipo_servicio,
             count(*)::integer AS muestras,
             percentile_cont(m.activacion_percentil::double precision) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (ah.primer_prioridad_at
                                            AT TIME ZONE 'America/Montevideo')::time)::double precision
             ) AS seg
        FROM act_hist ah
       WHERE ah.rn_gral <= 10
       GROUP BY ah.zona_id, ah.tipo_servicio
    ),
    -- Espera maxima vigente: la fila de la zona pisa la default (NULL).
    emax AS (
      SELECT u.zona_id, u.tipo_servicio,
             coalesce(ez.hora_max, ed.hora_max) AS hora_max
        FROM universo u
        LEFT JOIN demoras_espera_max ez
               ON ez.escenario_id = v_esc AND ez.tipo_servicio = u.tipo_servicio
              AND ez.dia_tipo = v_dia_tipo AND ez.zona_id = u.zona_id
        LEFT JOIN demoras_espera_max ed
               ON ed.escenario_id = v_esc AND ed.tipo_servicio = u.tipo_servicio
              AND ed.dia_tipo = v_dia_tipo AND ed.zona_id IS NULL
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
        p.arranque_fase    AS prev_fase,
        -- Insumos de auditoria del modelo CONSUMO_TRAMOS: se llevan crudos
        -- hasta `crudo`, que los deja en NULL cuando corre CAPACIDAD_PROMEDIO
        -- -- ver el comentario de mas abajo.
        tr.demora_cruda          AS tramos_cruda,
        tr.moviles_considerados  AS tramos_moviles_considerados,
        tr.cola_por_delante      AS tramos_cola_por_delante,
        tr.capacidad_inicial     AS tramos_capacidad_inicial,
        tr.capacidad_final       AS tramos_capacidad_final,
        tr.tramos                AS tramos_n,
        (SELECT dd.minutos FROM demoras dd
          WHERE dd.escenario_id = v_esc AND dd.zona_id = u.zona_id
            AND dd.descripcion = u.tipo_servicio
          ORDER BY dd.updated_at DESC, dd.demora_id DESC
          LIMIT 1) AS as400,
        -- Insumos del arranque PREDICTIVO.
        u.ventana_inicio,
        atp.seg                    AS act_tipo_seg,
        coalesce(atp.muestras, 0)  AS act_tipo_muestras,
        agr.seg                    AS act_gral_seg,
        coalesce(agr.muestras, 0)  AS act_gral_muestras,
        emx.hora_max               AS espera_hora_max
      FROM universo u
      LEFT JOIN cola  q ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo_servicio
      LEFT JOIN tr       ON tr.zona_id = u.zona_id AND tr.tipo_servicio = u.tipo_servicio
      LEFT JOIN cap   c ON c.zona_id = u.zona_id AND c.tipo_servicio = u.tipo_servicio
      LEFT JOIN rit   r ON r.zona_id = u.zona_id AND r.tipo_servicio = u.tipo_servicio
      LEFT JOIN prev  p ON p.zona_id = u.zona_id AND p.tipo_servicio = u.tipo_servicio
      LEFT JOIN act_tipo atp ON atp.zona_id = u.zona_id AND atp.tipo_servicio = u.tipo_servicio
      LEFT JOIN act_gral agr ON agr.zona_id = u.zona_id AND agr.tipo_servicio = u.tipo_servicio
      LEFT JOIN emax     emx ON emx.zona_id = u.zona_id AND emx.tipo_servicio = u.tipo_servicio
      CROSS JOIN LATERAL (
        SELECT CASE m.estadistico WHEN 'MEDIA' THEN r.ritmo_media
                                  WHEN 'P75'   THEN r.ritmo_p75
                                  WHEN 'P90'   THEN r.ritmo_p90
                                  ELSE r.ritmo_mediana END AS stat
      ) rc
    ),
    -- ── La fase del arranque, resuelta UNA vez por fila ──────────────
    -- est_capped: la estimacion se capea a la espera maxima -- se espera
    -- al prioridad HASTA esa hora aunque el historico diga mas tarde
    -- (correccion del usuario: el max se respeta siempre, nunca se
    -- promete mas alla de el, pero tampoco se saltea la espera).
    pred AS (
      SELECT a.*,
             e0.act_origen,
             e1.act_estimada_at,
             e1.espera_max_at,
             e2.est_capped_at,
             e3.espera_min,
             CASE
               WHEN m.arranque_sin_movil_modo = 'PREDICTIVO'
                    AND a.tipo_servicio = 'URGENTE'
                    AND a.mov_pri <= 0
                    AND e1.espera_max_at IS NOT NULL
               THEN CASE
                      WHEN p_corrida_at <= e1.espera_max_at THEN
                        CASE WHEN p_corrida_at <= e2.est_capped_at
                                  + make_interval(mins => m.activacion_gracia_minutos)
                             THEN 'PREDICTIVO'
                             ELSE 'GRACIA_VENCIDA' END
                      WHEN a.mov_tra > 0 THEN 'TRANSITO'
                      ELSE NULL
                    END
               ELSE NULL
             END AS arranque_fase
      FROM arm a
      CROSS JOIN LATERAL (
        SELECT CASE WHEN a.act_tipo_muestras >= m.activacion_min_muestras
                      THEN a.act_tipo_seg
                    WHEN a.act_gral_muestras >= m.activacion_min_muestras
                      THEN a.act_gral_seg
                    ELSE EXTRACT(EPOCH FROM a.ventana_inicio)::double precision
               END AS act_seg,
               CASE WHEN a.act_tipo_muestras >= m.activacion_min_muestras THEN 'DIA_TIPO'
                    WHEN a.act_gral_muestras >= m.activacion_min_muestras THEN 'GENERAL'
                    ELSE 'HORARIO' END AS act_origen
      ) e0
      CROSS JOIN LATERAL (
        SELECT ((v_fecha::timestamp
                 + make_interval(secs => e0.act_seg + m.activacion_margen_minutos * 60.0))
                AT TIME ZONE 'America/Montevideo')            AS act_estimada_at,
               CASE WHEN a.espera_hora_max IS NOT NULL
                    THEN ((v_fecha + a.espera_hora_max)::timestamp
                          AT TIME ZONE 'America/Montevideo') END AS espera_max_at
      ) e1
      CROSS JOIN LATERAL (
        SELECT LEAST(e1.act_estimada_at, e1.espera_max_at) AS est_capped_at
      ) e2
      CROSS JOIN LATERAL (
        SELECT GREATEST(0, EXTRACT(EPOCH FROM (e2.est_capped_at - p_corrida_at)) / 60.0)
               AS espera_min
      ) e3
    ),
    crudo AS (
      SELECT a.*,
             CASE
               -- ARRANQUE PREDICTIVO (2026-08-05, solo URGENTE): la zona no
               -- tiene ningun movil de PRIORIDAD y estamos dentro de la
               -- ventana de espera. La demora es fisica: cuanto falta para
               -- que llegue el primero (capeado a la espera maxima) + lo
               -- que tarda en atender a los que estan antes + tu entrega.
               -- El transito es INVISIBLE en esta fase aunque este activo:
               -- por eso esta rama va ANTES que la del modelo (que si lo
               -- cuenta con su dedicacion).
               WHEN a.arranque_fase = 'PREDICTIVO'
                 THEN a.espera_min
                      + (coalesce(a.tramos_cola_por_delante,
                                  (a.asignados + a.sin_asignar))::numeric + 1)
                        * a.ritmo_usado
               -- Paso la hora estimada + gracia y el prioridad no aparecio:
               -- no sabemos que le paso; la escalera sube hacia el techo y
               -- el transito SIGUE invisible hasta la espera maxima.
               WHEN a.arranque_fase = 'GRACIA_VENCIDA'
                 THEN m.max_minutos::numeric
               -- (La fase TRANSITO no tiene rama propia: cae al modelo de
               -- abajo, que cuenta a los de transito con su dedicacion.)
               -- Perilla de arranque DESPACHO / DESPACHO_MAS_COLA (2026-08-04).
               -- Con el modo PREDICTIVO activo llegan aca: NOCTURNO y
               -- SERVICE siempre (el predictivo es solo URGENTE en v1), y
               -- URGENTE solo con fase NULL = pasada la espera maxima sin
               -- transito NI moviles (mov_act <= 0): "considerar todo lo
               -- que hay" con la zona muerta = el valor del Despacho + la
               -- cola, no el techo (medido 3/8: 5/7 aciertos vs 0/7).
               -- Las fases PREDICTIVO/GRACIA_VENCIDA ya salieron por las
               -- ramas de arriba, y TRANSITO tiene mov_act > 0.
               WHEN m.arranque_sin_movil_modo IN ('DESPACHO', 'DESPACHO_MAS_COLA', 'PREDICTIVO')
                    AND a.mov_act <= 0
                    AND a.as400 IS NOT NULL
                    AND (m.arranque_sin_movil_modo IN ('DESPACHO_MAS_COLA', 'PREDICTIVO')
                         OR (a.asignados + a.sin_asignar) = 0)
                 THEN a.as400::numeric
                      + CASE WHEN m.arranque_sin_movil_modo IN ('DESPACHO_MAS_COLA', 'PREDICTIVO')
                             THEN coalesce(a.tramos_cola_por_delante,
                                           (a.asignados + a.sin_asignar))::numeric
                                  * a.ritmo_usado
                             ELSE 0 END
               -- Modelo nuevo: el numero ya viene resuelto de la simulacion,
               -- con su propio techo (el `sin_capacidad` interno de
               -- demoras_consumo_tramos ya esta reflejado en este numero).
               WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_cruda
               -- Modelo viejo, conservado tal cual para poder comparar. El
               -- orden del CASE importa: la falta de capacidad manda sobre la
               -- falta de demanda.
               WHEN a.capacidad <= 0                  THEN m.max_minutos::numeric
               WHEN (a.asignados + a.sin_asignar) = 0 THEN m.min_minutos::numeric
               ELSE ((a.asignados + a.sin_asignar)::numeric / a.capacidad)
                    * a.ritmo_usado * m.factor_calibracion
             END AS demora_cruda,
             -- sin_cap describe el ESTADO DEL MUNDO, LA MISMA EXPRESION EN
             -- LOS DOS MODELOS: habia algun movil activo asignado a esta
             -- zona hoy (moviles_activos <= 0, de demoras_capacidad)? No es
             -- un CASE por modelo a proposito -- ver el comentario extenso
             -- del encabezado.
             (a.mov_act <= 0) AS sin_cap,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_moviles_considerados ELSE NULL END AS moviles_considerados,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_cola_por_delante     ELSE NULL END AS cola_por_delante,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_capacidad_inicial    ELSE NULL END AS capacidad_inicial,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_capacidad_final      ELSE NULL END AS capacidad_final,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_n                    ELSE NULL END AS tramos,
             -- Bypass del suavizado: (a) si cambio la cantidad de moviles
             -- activos respecto de la corrida anterior, la variacion es
             -- estructural (entro o salio un movil), no ruido; (b) v6: al
             -- ENTRAR en fase TRANSITO (vencio la espera maxima), el numero
             -- nuevo sale de un regimen distinto -- frenarlo con la
             -- escalera seria seguir prometiendo la espera que acabamos de
             -- abandonar ("a las 10:10 debe dar una mejor demora").
             CASE WHEN (m.suavizado_bypass_cambio_capacidad
                        AND a.prev_mov IS DISTINCT FROM a.mov_act)
                    OR (a.arranque_fase = 'TRANSITO'
                        AND a.prev_fase IS DISTINCT FROM 'TRANSITO')
                  THEN NULL ELSE a.prev_suav END AS prev_efectivo
      FROM pred a
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
        capacidad_inicial, capacidad_final, tramos, cola_por_delante, moviles_considerados,
        sin_capacidad, clampeado, suavizado_aplicado, modelo_version,
        arranque_fase, activacion_estimada_at, activacion_origen, espera_minutos, espera_max_at
      )
      SELECT
        p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
        f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
        f.asignados, f.sin_asignar, f.atrapados,
        f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
        f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
        f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
        f.capacidad_inicial, f.capacidad_final, f.tramos, f.cola_por_delante, f.moviles_considerados,
        f.sin_cap, f.clampeado, f.suavizado_aplicado, m.version,
        f.arranque_fase,
        CASE WHEN f.arranque_fase IS NOT NULL THEN f.act_estimada_at END,
        CASE WHEN f.arranque_fase IS NOT NULL THEN f.act_origen END,
        CASE WHEN f.arranque_fase = 'PREDICTIVO' THEN round(f.espera_min::numeric, 1) END,
        CASE WHEN f.arranque_fase IS NOT NULL THEN f.espera_max_at END
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
        capacidad_inicial       = EXCLUDED.capacidad_inicial,
        capacidad_final         = EXCLUDED.capacidad_final,
        tramos                  = EXCLUDED.tramos,
        cola_por_delante        = EXCLUDED.cola_por_delante,
        moviles_considerados    = EXCLUDED.moviles_considerados,
        sin_capacidad           = EXCLUDED.sin_capacidad,
        clampeado               = EXCLUDED.clampeado,
        suavizado_aplicado      = EXCLUDED.suavizado_aplicado,
        modelo_version          = EXCLUDED.modelo_version,
        arranque_fase           = EXCLUDED.arranque_fase,
        activacion_estimada_at  = EXCLUDED.activacion_estimada_at,
        activacion_origen       = EXCLUDED.activacion_origen,
        espera_minutos          = EXCLUDED.espera_minutos,
        espera_max_at           = EXCLUDED.espera_max_at
      RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;

    v_escritas := v_escritas + v_n;
  END LOOP;

  RETURN v_escritas;
END;
$function$;

-- --- 4. La caja negra, con alarma de divergencia ---------------------
CREATE OR REPLACE FUNCTION public.demoras_corrida_snapshot(p_corrida_at timestamp with time zone, p_escenario integer, p_forzar boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  m         demoras_modelo%ROWTYPE;
  v_local   timestamp;
  v_fecha   date;
  v_hora    time;
  v_dia     text;
  v_n       integer := 0;
  v_paso    integer;
BEGIN
  -- DEUDA CONOCIDA (18/8): demoras_corrida_meta guarda UN modelo por corrida
  -- (PK corrida_at, escenario), pero desde hoy la parametria es por tipo de
  -- servicio. Mientras los tres tipos tengan los MISMOS valores esto es
  -- exacto. En cuanto uno se aparte, el simulador del laboratorio heredaria
  -- el modelo equivocado para ese tipo y TODA su medicion seria falsa.
  -- Por eso se captura el de URGENTE y se deja una alarma ruidosa: antes de
  -- calibrar NOCTURNO aparte hay que llevar la meta a (corrida, escenario,
  -- tipo). El chequeo de abajo hace imposible que eso pase en silencio.
  SELECT * INTO m FROM demoras_modelo
   WHERE escenario_id = p_escenario AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN RETURN 0; END IF;

  IF EXISTS (
    SELECT 1 FROM demoras_modelo o
     WHERE o.escenario_id = p_escenario AND o.tipo_servicio <> 'URGENTE'
       AND (to_jsonb(o) - 'tipo_servicio' - 'version' - 'updated_at' - 'updated_by')
        IS DISTINCT FROM
           (to_jsonb(m) - 'tipo_servicio' - 'version' - 'updated_at' - 'updated_by')
  ) THEN
    INSERT INTO demoras_lab_errores (origen, corrida_at, escenario, detalle)
    VALUES ('demoras_corrida_snapshot', p_corrida_at, p_escenario,
            'La parametria de algun tipo difiere de URGENTE y la caja negra todavia '
            || 'guarda un solo modelo por corrida: el laboratorio de ese tipo NO es '
            || 'confiable hasta migrar demoras_corrida_meta a (corrida, escenario, tipo).');
  END IF;

  -- Nada que capturar si la corrida no existe.
  IF NOT EXISTS (SELECT 1 FROM demoras_calculadas
                  WHERE corrida_at = p_corrida_at AND escenario = p_escenario) THEN
    RETURN 0;
  END IF;

  -- LA PRIMERA CAPTURA ES LA BUENA: no se re-captura una corrida que ya
  -- tiene caja negra. El estado del mundo se degrada con cada segundo
  -- que pasa (medido: con 660 s de desfase el simulador divergia en 121
  -- filas de 201; con 10 s, en 11), asi que re-capturar mas tarde solo
  -- puede EMPEORAR lo guardado. Paso de verdad al re-aplicar esta misma
  -- migracion: piso una captura de 10 s con una de 240 s y las
  -- divergencias saltaron de 11 a 54.
  IF NOT p_forzar AND EXISTS (SELECT 1 FROM demoras_corrida_meta
                               WHERE corrida_at = p_corrida_at AND escenario = p_escenario) THEN
    RETURN 0;
  END IF;

  v_local := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha := v_local::date;
  v_hora  := v_local::time;
  v_dia   := demoras_dia_tipo(v_fecha);

  -- 4a. Meta: parametria, calendario y universo.
  INSERT INTO demoras_corrida_meta (
    corrida_at, escenario, fecha_local, hora_local, dia_tipo, modelo_version,
    modelo, config, ventanas, espera_max, alpha_transito, zonas_activas, capturado_at)
  SELECT p_corrida_at, p_escenario, v_fecha, v_hora, v_dia, m.version,
         to_jsonb(m),
         (SELECT jsonb_agg(to_jsonb(dc)) FROM demoras_config dc WHERE dc.escenario_id = p_escenario),
         (SELECT jsonb_agg(to_jsonb(dv)) FROM demoras_ventanas dv
           WHERE dv.escenario_id = p_escenario AND dv.dia_tipo = v_dia),
         (SELECT jsonb_agg(to_jsonb(de)) FROM demoras_espera_max de
           WHERE de.escenario_id = p_escenario AND de.dia_tipo = v_dia),
         (SELECT es.peso_transito_alpha FROM escenario_settings es WHERE es.escenario_id = p_escenario),
         (SELECT array_agg(DISTINCT d.zona_id) FROM demoras d
           WHERE d.escenario_id = p_escenario AND d.descripcion = 'URGENTE' AND d.activa),
         now()
  ON CONFLICT (corrida_at, escenario) DO UPDATE SET
    modelo = EXCLUDED.modelo, config = EXCLUDED.config, ventanas = EXCLUDED.ventanas,
    espera_max = EXCLUDED.espera_max, alpha_transito = EXCLUDED.alpha_transito,
    zonas_activas = EXCLUDED.zonas_activas, modelo_version = EXCLUDED.modelo_version,
    capturado_at = EXCLUDED.capturado_at;

  -- 4b. Los aportes por movil: EL dato irrecuperable.
  INSERT INTO demoras_corrida_movil (
    corrida_at, escenario, zona_id, tipo_servicio, movil,
    es_transito, dedicacion, ritmo, ritmo_origen, carga_fuera, libera_en, capacidad)
  SELECT p_corrida_at, p_escenario, a.zona_id, a.tipo_servicio, a.movil,
         a.es_transito, a.p_j, a.ritmo, a.ritmo_origen, a.carga_fuera, a.r_j, a.mu_j
  FROM demoras_aportes(p_escenario, v_fecha) a
  ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio, movil) DO UPDATE SET
    es_transito = EXCLUDED.es_transito, dedicacion = EXCLUDED.dedicacion,
    ritmo = EXCLUDED.ritmo, ritmo_origen = EXCLUDED.ritmo_origen,
    carga_fuera = EXCLUDED.carga_fuera, libera_en = EXCLUDED.libera_en,
    capacidad = EXCLUDED.capacidad;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 4c. Los pedidos que formaban la cola.
  INSERT INTO demoras_corrida_pedido (
    corrida_at, escenario, origen, pedido_id, zona_id, tipo_pedido, movil,
    es_asignado, movil_activo, asignado_desde, asignado_es_proxy, minutos_desde_asignacion)
  SELECT p_corrida_at, p_escenario, d.origen, d.pedido_id, d.zona_nro, d.tipo, d.movil,
         d.es_asignado, d.movil_activo, d.asignado_desde, d.asignado_es_proxy,
         d.minutos_desde_asignacion
  FROM demoras_cola_detalle(p_escenario, v_fecha, p_corrida_at) d
  ON CONFLICT (corrida_at, escenario, origen, pedido_id) DO UPDATE SET
    zona_id = EXCLUDED.zona_id, tipo_pedido = EXCLUDED.tipo_pedido, movil = EXCLUDED.movil,
    es_asignado = EXCLUDED.es_asignado, movil_activo = EXCLUDED.movil_activo,
    asignado_desde = EXCLUDED.asignado_desde, asignado_es_proxy = EXCLUDED.asignado_es_proxy,
    minutos_desde_asignacion = EXCLUDED.minutos_desde_asignacion;
  GET DIAGNOSTICS v_paso = ROW_COUNT;
  v_n := v_n + v_paso;

  -- 4c-bis. Los ESPECIALES/OTROS a bordo (pregunta de Diego, audio 12/8).
  -- El motor SI los cuenta en carga_fuera (demoras_aportes.carga_total:
  -- "todo entra aca, ESPECIAL/OTROS incluidos") pero el detalle por
  -- pedido no los guardaba: viajaban solo dentro del numero agregado.
  -- Sin este detalle no se puede backtestear un peso distinto para el
  -- especial -- y los datos del 12/8 dicen que importa: 137 especiales
  -- a bordo con rotacion de ~10 por dia (los llevan y los postergan),
  -- en 34 de 96 moviles activos, max 56 en uno solo.
  -- MISMO filtro que carga_total: estado 1, movil asignado, zona, fch
  -- del dia, y el balde OTRO = todo lo que no es URGENTE/NOCTURNO
  -- exactos. `prog` en el simulador filtra por pool, asi que estas
  -- filas NO se cuelan en la reconstruccion de la cola.
  INSERT INTO demoras_corrida_pedido (
    corrida_at, escenario, origen, pedido_id, zona_id, tipo_pedido, movil,
    es_asignado, movil_activo, asignado_desde, asignado_es_proxy, minutos_desde_asignacion)
  SELECT p_corrida_at, p_escenario, 'PEDIDO', p.id::bigint, p.zona_nro, 'OTRO', p.movil,
         true,
         EXISTS (SELECT 1 FROM moviles_dia md
                  WHERE md.escenario_id = p_escenario AND md.movil_id = p.movil
                    AND md.fecha = v_fecha AND md.activo
                    AND coalesce(md.estado_nro, 0) <> 4),
         coalesce(p.fch_hora_asignado, p.updated_at),
         (p.fch_hora_asignado IS NULL),
         CASE WHEN coalesce(p.fch_hora_asignado, p.updated_at) IS NOT NULL
              THEN round((EXTRACT(EPOCH FROM (p_corrida_at - coalesce(p.fch_hora_asignado, p.updated_at))) / 60.0)::numeric, 2)
         END
  FROM pedidos p
  WHERE p.escenario = p_escenario AND p.estado_nro = 1
    AND p.movil IS NOT NULL AND p.movil <> 0 AND p.zona_nro IS NOT NULL
    AND COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = v_fecha
    AND upper(trim(coalesce(p.servicio_nombre,''))) NOT IN ('URGENTE','NOCTURNO')
  ON CONFLICT (corrida_at, escenario, origen, pedido_id) DO UPDATE SET
    zona_id = EXCLUDED.zona_id, tipo_pedido = EXCLUDED.tipo_pedido, movil = EXCLUDED.movil,
    es_asignado = EXCLUDED.es_asignado, movil_activo = EXCLUDED.movil_activo,
    asignado_desde = EXCLUDED.asignado_desde, asignado_es_proxy = EXCLUDED.asignado_es_proxy,
    minutos_desde_asignacion = EXCLUDED.minutos_desde_asignacion;
  GET DIAGNOSTICS v_paso = ROW_COUNT;
  v_n := v_n + v_paso;

  RETURN v_n;
END;
$function$;

-- --- 5. El historial de versiones, por tipo --------------------------
CREATE OR REPLACE FUNCTION public.demoras_modelo_versionar()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  -- Un UPDATE que no cambia ningun parametro NO versiona: abrir la pantalla

  -- y guardar sin editar no debe inflar el historial ni invalidar la

  -- comparabilidad de las corridas. Se ignoran las tres columnas de

  -- bookkeeping, que cambian siempre.

  IF (to_jsonb(OLD) - 'version' - 'updated_at' - 'updated_by')

   = (to_jsonb(NEW) - 'version' - 'updated_at' - 'updated_by') THEN

    RETURN NEW;

  END IF;



  INSERT INTO demoras_modelo_historial (escenario_id, tipo_servicio, version, cambiado_por, fila)

  VALUES (OLD.escenario_id, OLD.tipo_servicio, OLD.version, NEW.updated_by, to_jsonb(OLD))

  ON CONFLICT DO NOTHING;



  NEW.version    := OLD.version + 1;

  NEW.updated_at := now();

  RETURN NEW;

END;

$function$;
