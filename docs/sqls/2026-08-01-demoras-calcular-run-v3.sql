-- =====================================================================
-- demoras_calcular_run v3 — todos los escenarios, CONSUMO_TRAMOS
-- Fecha: 2026-08-01 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md seccion 8.
--
-- Misma firma y mismo contrato externo que la v2 (advisory lock, ventana
-- horaria por tipo adentro de la funcion, devuelve filas escritas). Dos
-- cambios de fondo:
--
--   1. SE VA EL ESCENARIO CLAVADO. La v2 tenia `v_esc integer := 1000` y
--      leia UNA fila de demoras_modelo. Toda la configuracion es POR
--      ESCENARIO -el agrupador grande, mas o menos un departamento- y las
--      tablas ya estaban hechas asi; cargarle configuracion a otro
--      escenario no hacia que se calculara. Ahora `FOR m IN SELECT * FROM
--      demoras_modelo ORDER BY escenario_id LOOP` envuelve todo el cuerpo:
--      un escenario se calcula si y solo si tiene fila en demoras_modelo,
--      tenga o no fila en demoras_config (sin fila en demoras_config, `cfg`
--      sale vacio y ese escenario simplemente no escribe nada, igual que
--      hoy con un tipo sin fila).
--
--   2. PROXIMO_HUECO se retira, CONSUMO_TRAMOS ocupa su lugar. El CTE que
--      antes llamaba a demoras_proximo_hueco (que por dentro usaba
--      demoras_servidores) ahora llama a demoras_consumo_tramos (que por
--      dentro usa demoras_aportes). demoras_cola pasa a su v2 sin que este
--      archivo tenga que cambiar la forma en que la invoca -- mismo nombre,
--      mismo `RETURNS TABLE`, la migracion de esa funcion (Task 3) ya
--      quedo aplicada antes que esta. Los dos modelos siguen escribiendo
--      las MISMAS columnas, para poder compararlos sin transformar nada.
--
-- ─── El advisory lock sigue AFUERA del loop ───────────────────────────
-- Se toma UNA sola vez, antes de `FOR m IN ...`, y serializa la CORRIDA
-- ENTERA -- no escenario por escenario. Si se moviera adentro del loop, dos
-- corridas solapadas podrian intercalarse por escenario (una toma el
-- escenario 1000, la otra el 2000, las dos progresan "en paralelo" sobre
-- corridas distintas) y escribir un estado mezclado: exactamente lo que el
-- lock existe para evitar. Con el lock afuera, si la corrida esta ocupada,
-- NINGUN escenario se procesa (RETURN 0 antes de que el loop arranque).
--
-- ─── sin_capacidad describe el ESTADO DEL MUNDO en los DOS modelos ────
-- Round anterior (Critical, ver comentario de la v2 mas abajo en el
-- historial de git): el modelo viejo marcaba sin_capacidad con su propio
-- atajo (a.capacidad prorrateada <= 0) y el modelo nuevo con el suyo (el
-- sin_capacidad que devuelve la funcion de simulacion). El endpoint de
-- comparativa EXCLUYE del promedio las filas con sin_capacidad=true, asi
-- que si cada modelo decide con una regla distinta cuales filas cuentan,
-- los dos terminan comparandose sobre poblaciones distintas -- el defecto
-- que motivo el fix de la v2 para CAPACIDAD_PROMEDIO.
--
-- Esta version cierra el mismo agujero para CONSUMO_TRAMOS: la columna
-- persistida `sin_capacidad` YA NO lee `demoras_consumo_tramos.sin_capacidad`
-- (el atajo interno de ESE modelo: "nadie ahora Y nadie por venir", que es
-- el criterio correcto para que la funcion decida informar el techo, pero
-- no el que define que filas excluye la comparativa). Los DOS modelos usan
-- la MISMA expresion, `moviles_activos <= 0` (de demoras_capacidad, que ya
-- filtra por moviles_dia.activo=true): "habia algun movil activo asignado
-- a esta zona hoy" es una pregunta sobre el MUNDO, no sobre el modelo. Por
-- eso en el codigo de mas abajo no hay un CASE por modelo para esta
-- columna -- es la MISMA expresion para los dos, a proposito, para que no
-- se pueda reintroducir el defecto por accidente agregando una rama nueva.
--
-- La rama de `demora_cruda` del modelo viejo SIGUE sin tocarse: usa su
-- propia capacidad prorrateada (a.capacidad <= 0) para decidir informar el
-- techo. Con eso, un caso de transito puro + alpha=0 (capacidad prorrateada
-- 0 con movil activo) hace que CAPACIDAD_PROMEDIO informe el techo SIN la
-- bandera puesta -- un defecto real de ESE modelo (el atajo del techo no
-- coincide con "no habia nadie"), que tiene que aparecer como brecha grande
-- en la comparacion, no esconderse detras de una exclusion.
--
-- ─── El indice de `prev` sigue sirviendo con N escenarios ─────────────
-- `idx_demoras_calc_esc_zona_tipo_at` es (escenario, zona_id, tipo_servicio,
-- corrida_at DESC). La CTE `prev` filtra `escenario = v_esc` (IGUALDAD,
-- columna LIDER del indice) y hace `DISTINCT ON (zona_id, tipo_servicio)
-- ... ORDER BY zona_id, tipo_servicio, corrida_at DESC` -- exactamente el
-- orden de las tres columnas siguientes del indice. Postgres resuelve esto
-- con un Index Scan mas un nodo Unique, sin sort aparte: el costo de esta
-- CTE es proporcional al numero de filas DE ESE escenario dentro de la
-- ventana del dia, no al tamano total de la tabla. Agregar escenarios
-- agranda la tabla pero cada uno vive en su propio rango contiguo del
-- indice (particionado logicamente por la igualdad en la columna lider):
-- no degrada el costo POR ESCENARIO de esta consulta. Lo que si crece
-- linealmente con N es el trabajo TOTAL del cron (una pasada mas por
-- escenario) y el volumen de la tabla completa -- ver DEMORA_MODELO_TRAMOS
-- seccion 8 para las cifras (25.000 filas/dia con un escenario, 125.000
-- con cinco) y el reporte de esta task para el tiempo medido con 2
-- escenarios en el harness.
--
-- ORDEN DE APLICACION: como la v2, este archivo asume las migraciones
-- anteriores de esta tanda ya puestas (T1-T5: demoras_modelo con las
-- columnas de CONSUMO_TRAMOS y el CHECK que ya no acepta PROXIMO_HUECO,
-- demoras_cola v2, demoras_aportes, demoras_consumo_tramos). Aplicarlo
-- antes deja el CTE de este archivo llamando a demoras_consumo_tramos
-- correcto pero sobre datos/columnas que las migraciones anteriores no
-- pusieron todavia -- aplicar la secuencia completa en orden, o con el
-- motor apagado (motor_activo=false), que es la precondicion de toda la
-- tanda.
-- =====================================================================
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
  'CONSUMO_TRAMOS: cuantos moviles (de moviles_zonas, activos o no hoy) tiene asignados la zona para este tipo -- demoras_consumo_tramos.moviles_considerados. NULL en CAPACIDAD_PROMEDIO.';
