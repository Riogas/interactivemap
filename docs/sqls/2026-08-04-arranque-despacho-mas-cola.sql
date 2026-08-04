-- =====================================================================
-- ARRANQUE DESPACHO_MAS_COLA: sin movil pero CON cola -> Despacho + cola x ritmo
-- Fecha: 2026-08-04 | Idempotente | Requiere: 2026-08-04-arranque-despacho
-- y 2026-08-04-asignados-realistas aplicados.
--
-- El trace 08:00-08:50 mostro el borde del modo DESPACHO: con UN pedido
-- esperando y ningun movil, el motor salta al techo (120) aunque el
-- Despacho diga 45 — ellos saben que el movil viene. Este modo intermedio
-- informa: valor del Despacho + (cola equivalente x ritmo de la zona).
-- Ej.: Despacho 45, ritmo 15 -> 1 pedido: 60; 3 pedidos: 90 (vs 120).
-- La cola es la EQUIVALENTE (con asignados_modo PROGRESO los asignados a
-- moviles inactivos no aplican aca — sin movil activo no hay asignados
-- activos — pero los sin asignar cuentan enteros, como corresponde).
-- Sin valor del Despacho (NOCTURNO/SERVICE), sigue el techo.
-- =====================================================================

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_arranque_chk;
ALTER TABLE demoras_modelo ADD CONSTRAINT demoras_modelo_arranque_chk
  CHECK (arranque_sin_movil_modo IN ('TECHO', 'DESPACHO', 'DESPACHO_MAS_COLA'));

COMMENT ON COLUMN demoras_modelo.arranque_sin_movil_modo IS
  'Que informar cuando la zona no tiene NINGUN movil activo: TECHO = max_minutos (historico); DESPACHO = valor del Despacho/AS400 solo si ademas no hay pedidos (con cola, techo); DESPACHO_MAS_COLA = valor del Despacho + cola equivalente x ritmo de la zona, tambien con pedidos esperando. Sin valor del Despacho siempre techo.';

-- demoras_calcular_run v5 = v4 + el modo DESPACHO_MAS_COLA en el CTE
-- crudo (generado programaticamente desde 2026-08-04-arranque-despacho).
CREATE OR REPLACE FUNCTION demoras_calcular_run(p_corrida_at timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_esc      integer;
  v_local    timestamp;
  v_fecha    date;
  v_hora     time;
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
  v_local := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha := v_local::date;
  v_hora  := v_local::time;

  -- Un escenario se calcula si y solo si tiene fila en demoras_modelo. Uno
  -- con demoras_config pero SIN demoras_modelo no aparece aca y no se
  -- calcula -- es la misma logica que hoy usa un tipo sin fila en
  -- demoras_config para quedar apagado, un nivel mas arriba.
  FOR m IN SELECT * FROM demoras_modelo ORDER BY escenario_id LOOP
    v_esc := m.escenario_id;

    WITH
    -- Solo lo OPERATIVO por tipo. Un tipo sin fila aca no se calcula, y esa
    -- sigue siendo la forma de apagar un tipo sin borrar historico.
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
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo_servicio
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
          LIMIT 1) AS as400
      FROM universo u
      LEFT JOIN cola  q ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo_servicio
      LEFT JOIN tr       ON tr.zona_id = u.zona_id AND tr.tipo_servicio = u.tipo_servicio
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
               -- Perilla de ARRANQUE (2026-08-04): zona sin ningun movil
               -- activo Y sin pedidos -> con modo DESPACHO se informa el
               -- valor que el Despacho (AS400) tiene cargado para la zona,
               -- no el techo. Medido: el Despacho arranca el dia con una
               -- grilla 30-90 y le acierta; nuestro techo 120 castigaba a
               -- ~5 pedidos madrugadores y arrastraba la escalera una hora.
               -- Con demanda o sin valor del Despacho (NOCTURNO/SERVICE,
               -- que no informa), manda la regla de siempre. Aplica a los
               -- DOS modelos: es una politica de arranque, no del calculo.
               -- DESPACHO: solo zona VACIA (con cola manda el techo).
               -- DESPACHO_MAS_COLA (2026-08-04): tambien CON cola — el
               -- Despacho sabe que el movil viene; se informa su valor
               -- mas el costo de la cola que espera (cola equivalente x
               -- ritmo de la zona). Con cola 0 es identico a DESPACHO.
               WHEN m.arranque_sin_movil_modo IN ('DESPACHO', 'DESPACHO_MAS_COLA')
                    AND a.mov_act <= 0
                    AND a.as400 IS NOT NULL
                    AND (m.arranque_sin_movil_modo = 'DESPACHO_MAS_COLA'
                         OR (a.asignados + a.sin_asignar) = 0)
                 THEN a.as400::numeric
                      + CASE WHEN m.arranque_sin_movil_modo = 'DESPACHO_MAS_COLA'
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
             -- del encabezado. Ni el atajo del modelo viejo (a.capacidad
             -- prorrateada <= 0, que SIGUE decidiendo su propio techo en la
             -- rama de demora_cruda de arriba, sin tocar) ni el atajo del
             -- modelo nuevo (demoras_consumo_tramos.sin_capacidad, que
             -- decide "nadie ahora Y nadie por venir" -- el criterio
             -- correcto para ESE calculo, pero no el que define que filas
             -- excluye la comparativa) alimentan esta columna.
             (a.mov_act <= 0) AS sin_cap,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_moviles_considerados ELSE NULL END AS moviles_considerados,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_cola_por_delante     ELSE NULL END AS cola_por_delante,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_capacidad_inicial    ELSE NULL END AS capacidad_inicial,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_capacidad_final      ELSE NULL END AS capacidad_final,
             CASE WHEN m.modelo = 'CONSUMO_TRAMOS' THEN a.tramos_n                    ELSE NULL END AS tramos,
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
        capacidad_inicial, capacidad_final, tramos, cola_por_delante, moviles_considerados,
        sin_capacidad, clampeado, suavizado_aplicado, modelo_version
      )
      SELECT
        p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
        f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
        f.asignados, f.sin_asignar, f.atrapados,
        f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
        f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
        f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
        f.capacidad_inicial, f.capacidad_final, f.tramos, f.cola_por_delante, f.moviles_considerados,
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
        capacidad_inicial       = EXCLUDED.capacidad_inicial,
        capacidad_final         = EXCLUDED.capacidad_final,
        tramos                  = EXCLUDED.tramos,
        cola_por_delante        = EXCLUDED.cola_por_delante,
        moviles_considerados    = EXCLUDED.moviles_considerados,
        sin_capacidad           = EXCLUDED.sin_capacidad,
        clampeado               = EXCLUDED.clampeado,
        suavizado_aplicado      = EXCLUDED.suavizado_aplicado,
        modelo_version          = EXCLUDED.modelo_version
      RETURNING 1
    )
    SELECT count(*) INTO v_n FROM ins;

    v_escritas := v_escritas + v_n;
  END LOOP;

  RETURN v_escritas;
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora. Recorre TODOS los escenarios con fila en demoras_modelo (uno por corrida, no un 1000 clavado) y para cada uno despacha entre CONSUMO_TRAMOS (simulacion por tramos sobre demoras_aportes) y CAPACIDAD_PROMEDIO (el modelo viejo), escribiendo las MISMAS columnas en los dos casos para poder compararlos. Los parametros del calculo salen de demoras_modelo (una fila por escenario); demoras_config queda solo con lo operativo por tipo (motor_activo, ventana horaria, ritmo_cascada), asi que NOCTURNO conserva su horario propio. Cada fila sella modelo_version para que una corrida vieja se pueda reconstruir. El advisory lock se toma UNA sola vez, antes del loop de escenarios: serializa la corrida entera, no escenario por escenario -- una corrida solapada no escribe NADA (RETURN 0 antes de iterar ningun escenario), nunca "algunos escenarios si y otros no". sin_capacidad es la MISMA expresion (moviles_activos <= 0) en los dos modelos, no el atajo interno de ninguno: ni la capacidad prorrateada del modelo viejo ni el sin_capacidad propio de la simulacion nueva, porque el endpoint de comparativa excluye del promedio las filas con sin_capacidad=true y los dos modelos tienen que marcar la MISMA poblacion.';

-- ─── Columnas de auditoria: las del modelo nuevo entran, las de
-- PROXIMO_HUECO salen ────────────────────────────────────────────────
-- capacidad_inicial / capacidad_final / tramos son nuevas (demoras_consumo_
-- tramos las agrega a la firma que no tenia demoras_proximo_hueco).
-- cola_por_delante y moviles_considerados YA EXISTIAN (las agrego la v2 para
-- PROXIMO_HUECO) y SE CONSERVAN: demoras_consumo_tramos tambien las
-- devuelve, con el mismo significado ("cuantos pedidos sin asignar hay
-- adelante" / "cuantos moviles compitieron"), asi que no hace falta
-- renombrarlas ni duplicarlas.
--
-- ritmo_aplicado y libre_primero SI se dan de baja: eran especificas de
-- PROXIMO_HUECO (el ritmo del movil que efectivamente entregaba en ESA
-- simulacion, y el mejor tiempo de liberacion antes de repartir la cola) y
-- CONSUMO_TRAMOS no tiene un equivalente directo -- la simulacion nueva no
-- elige un movil "que entrega", reparte la cola entre todos los que aportan
-- a la vez. No se agrega backup de estas dos columnas antes del DROP (a
-- diferencia del backup de demoras_config en la v2): demoras_calculadas es,
-- por su propio COMMENT ON TABLE, una tabla de COMPARATIVA que no alimenta a
-- nadie, con retencion de 180 dias -- no es configuracion maestra que se
-- pierda para siempre si nadie la copio a tiempo. Las filas ya escritas por
-- PROXIMO_HUECO pierden estos dos valores puntuales; conservan todo lo
-- demas (demora_informada, demora_cruda, sin_capacidad, etc.).
ALTER TABLE demoras_calculadas
  ADD COLUMN IF NOT EXISTS capacidad_inicial numeric,
  ADD COLUMN IF NOT EXISTS capacidad_final   numeric,
  ADD COLUMN IF NOT EXISTS tramos            integer;

ALTER TABLE demoras_calculadas
  DROP COLUMN IF EXISTS ritmo_aplicado,
  DROP COLUMN IF EXISTS libre_primero;

COMMENT ON COLUMN demoras_calculadas.capacidad_inicial IS
  'CONSUMO_TRAMOS: capacidad (pedidos/minuto) con la que arranca la simulacion -- solo los moviles que ya estan libres en esta zona (r_j <= 0) -- demoras_consumo_tramos.capacidad_inicial. NULL en CAPACIDAD_PROMEDIO.';
COMMENT ON COLUMN demoras_calculadas.capacidad_final IS
  'CONSUMO_TRAMOS: capacidad (pedidos/minuto) al momento en que se resolvio la demora, con todos los moviles que ya aportaban en ese instante -- demoras_consumo_tramos.capacidad_final. NULL en CAPACIDAD_PROMEDIO.';
COMMENT ON COLUMN demoras_calculadas.tramos IS
  'CONSUMO_TRAMOS: cuantos regimenes de capacidad distintos atraveso la simulacion para llegar a la respuesta (el inicial mas cada liberacion de movil hasta vaciar la cola), incluido el ultimo -- demoras_consumo_tramos.tramos. NULL en CAPACIDAD_PROMEDIO.';
COMMENT ON COLUMN demoras_calculadas.cola_por_delante IS
  'CONSUMO_TRAMOS: pedidos pendientes de la zona (cola_efectiva de demoras_cola) SIN contar el pedido nuevo -- demoras_consumo_tramos.cola_por_delante. NULL en CAPACIDAD_PROMEDIO (esa informacion vive en pendientes_sin_asignar/pendientes_asignados para los dos modelos).';
COMMENT ON COLUMN demoras_calculadas.moviles_considerados IS
  'CONSUMO_TRAMOS: cuantos moviles (de moviles_zonas) tiene asignados la zona para este tipo y estan ACTIVOS hoy -- demoras_consumo_tramos.moviles_considerados cuenta sobre demoras_aportes, que ya filtra moviles_dia.activo. NULL en CAPACIDAD_PROMEDIO.';

-- ─── Grants: solo service_role (I3, review final de rama) ────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto: sin
-- este REVOKE, anon/authenticated (las claves que viajan al browser) pueden
-- invocar el orquestador entero via RPC (es SECURITY INVOKER: muere en el
-- primer CTE porque las tablas que lee estan revocadas, pero no deberia ni
-- llegar a intentarlo). Quedaba sin revocar desde la v2 (2026-07-31); mismo
-- patron que el resto de las funciones del motor.
REVOKE EXECUTE ON FUNCTION demoras_calcular_run(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_calcular_run(timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_calcular_run(timestamptz) TO service_role;




-- =====================================================================
-- ACTIVACION (escenario 1000): retro-backtest sobre los 2.148 pedidos
-- del 2026-08-03: 73,5% <=25' vs 73,4% con DESPACHO solo — mejora
-- marginal en el agregado y cubre el borde "un pedido esperando" (60 en
-- vez de 120). Nunca empeora: con cola 0 es identico a DESPACHO.
-- Revertir: UPDATE demoras_modelo SET arranque_sin_movil_modo='DESPACHO'
-- =====================================================================
UPDATE demoras_modelo
   SET arranque_sin_movil_modo = 'DESPACHO_MAS_COLA'
 WHERE escenario_id = 1000
   AND arranque_sin_movil_modo IS DISTINCT FROM 'DESPACHO_MAS_COLA';
