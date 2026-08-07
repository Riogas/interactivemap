-- =====================================================================
-- CAJA NEGRA DE CORRIDAS: el estado del mundo, minuto a minuto
-- Fecha: 2026-08-07 | Idempotente | Pedido del usuario (7/8):
-- "quiero que persistas todos los datos que precisás y utilizás por cada
--  corrida del motor... para poder experimentar teniendo una copia fiel
--  de lo que pasa día a día, minuto a minuto, y no tener que hacer
--  retro-backtest porque ya tendríamos la situación real persistida".
--
-- ─── Por que existe ──────────────────────────────────────────────────
-- El 7/8, al intentar rellenar hacia atras las corridas del dia anterior
-- para el laboratorio de variantes, las variantes que RE-SIMULAN el
-- ritmo prometian ~105' contra 84' del campeon: casi todas contra el
-- techo. La causa quedo medida: la re-simulacion necesita el ESTADO
-- OPERATIVO de ese instante y ese estado ya no existe unas horas
-- despues (el rollover de moviles_dia corre 02:05; los pendientes de
-- ayer hoy estan entregados). El laboratorio tuvo que limitarse a
-- corridas de los ultimos 15 minutos.
--
-- Esta migracion levanta esa limitacion: se persiste lo irrecuperable.
--
-- ─── Que se persiste y que NO (la distincion que ordena el diseno) ───
--  * IRRECUPERABLE -> se persiste aca:
--      - que moviles estaban activos, cual prioridad y cual transito,
--        con que dedicacion, cuanta carga llevaban fuera de zona y
--        cuando se liberaban (demoras_corrida_movil);
--      - que pedidos formaban la cola, asignados o no, desde cuando
--        (demoras_corrida_pedido);
--      - la parametria, el calendario y el universo de la corrida
--        (demoras_corrida_meta).
--  * RECUPERABLE SIEMPRE (sale de metricas_cumplimiento, historico
--    inmutable) -> se persiste igual, pero por VELOCIDAD y fidelidad,
--    no por necesidad: las estadisticas del ritmo en sus cuatro niveles
--    crudos (demoras_corrida_ritmo, UNA fila por dia, no por corrida).
--    Consecuencia practica: las perillas de MUESTREO del ritmo (ventana
--    de dias, hueco min/max, solo_con_cola) se pueden explorar hacia
--    atras sin depender de esta caja negra.
--  * YA PERSISTIDO -> demoras_calculadas (el resultado por zona con
--    todas sus columnas de auditoria) y demoras_activacion_hist.
--
-- ─── Principio: el motor no se toca ──────────────────────────────────
-- La captura la hace el MISMO job del laboratorio (demoras-variantes,
-- cada minuto), sobre corridas ya commiteadas, en su propia transaccion
-- y con su propio lock. demoras_calcular_run sigue intacta.
--
-- Volumen MEDIDO en prod (7/8): 489 filas de aportes y ~140 pedidos
-- pendientes por corrida (max 313), 83 corridas/dia => ~53.000 filas y
-- ~6 MB por dia. Con 90 dias de retencion, ~530 MB sobre una base de
-- 3,5 GB y 54 GB libres en el host. Se descarto guardar solo los
-- cambios entre corridas (ahorraria 70%) porque complica el simulador
-- para ahorrar 4 MB diarios.
--
-- Secciones:
--   1. Las cuatro tablas + indices + retencion
--   2. demoras_cola_detalle  (el detalle por pedido detras de demoras_cola)
--   3. demoras_ritmo_niveles (los cuatro niveles CRUDOS del ritmo)
--   4. demoras_corrida_snapshot (la captura)
--   5. Enganche al job del laboratorio
-- =====================================================================

-- ─── 1. Las tablas ───────────────────────────────────────────────────

-- 1a. Una fila por corrida x escenario: la parametria y el calendario
--     con los que se calculo. Sin esto, simular una corrida de hace un
--     mes usaria las perillas de hoy.
CREATE TABLE IF NOT EXISTS demoras_corrida_meta (
  corrida_at     timestamptz NOT NULL,
  escenario      integer     NOT NULL,
  fecha_local    date        NOT NULL,
  hora_local     time        NOT NULL,
  dia_tipo       text        NOT NULL,
  modelo_version integer,
  -- La fila ENTERA de demoras_modelo tal como estaba (28 perillas).
  modelo         jsonb       NOT NULL,
  -- demoras_config por tipo (motor_activo, ventana, cascada, min/max).
  config         jsonb,
  -- Las ventanas y esperas maximas vigentes para el dia_tipo.
  ventanas       jsonb,
  espera_max     jsonb,
  alpha_transito numeric,
  -- El universo de la corrida: zonas activas en la grilla del Despacho.
  zonas_activas  integer[],
  capturado_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corrida_at, escenario)
);

COMMENT ON TABLE demoras_corrida_meta IS
  'Caja negra: la parametria, el calendario y el universo con los que se calculo cada corrida. Ver docs/sqls/2026-08-07-caja-negra-corridas.sql.';

-- 1b. EL CORAZON: cada movil que aportaba a cada zona, en esa corrida.
--     dedicacion y carga_fuera son INVARIANTES al ritmo (se pueden
--     re-usar con cualquier estadistico); ritmo/libera_en/capacidad son
--     los que USO el motor y quedan para el espejo exacto -- el
--     simulador los recalcula cuando la variante cambia el ritmo.
CREATE TABLE IF NOT EXISTS demoras_corrida_movil (
  corrida_at    timestamptz NOT NULL,
  escenario     integer     NOT NULL,
  zona_id       integer     NOT NULL,
  tipo_servicio text        NOT NULL,
  movil         integer     NOT NULL,
  es_transito   boolean     NOT NULL,
  dedicacion    numeric,     -- p_j: fraccion del movil dedicada a esta zona
  ritmo         numeric,     -- el ritmo que se le aplico
  ritmo_origen  text,        -- MOVIL | ZONA | DEFECTO
  carga_fuera   integer,     -- pedidos que lleva encima fuera de esta zona
  libera_en     numeric,     -- r_j: minuto en que entra a esta zona
  capacidad     numeric,     -- mu_j: entregas por minuto que aporta
  PRIMARY KEY (corrida_at, escenario, zona_id, tipo_servicio, movil)
);

COMMENT ON TABLE demoras_corrida_movil IS
  'Caja negra: el aporte de cada movil a cada zona en cada corrida (dedicacion, ritmo, carga fuera de zona, minuto de liberacion, capacidad). Es el insumo que ninguna otra tabla conserva y sin el cual no se puede re-simular nada. Espejo de demoras_aportes().';

-- 1c. Los pedidos que formaban la cola. Se guarda el DATO CRUDO
--     (minutos desde la asignacion), no el aporte ya calculado: asi el
--     simulador puede aplicar cualquier modo de asignados y cualquier
--     ritmo de referencia.
CREATE TABLE IF NOT EXISTS demoras_corrida_pedido (
  corrida_at        timestamptz NOT NULL,
  escenario         integer     NOT NULL,
  origen            text        NOT NULL,  -- PEDIDO | SERVICE
  pedido_id         bigint      NOT NULL,
  zona_id           integer     NOT NULL,
  tipo_pedido       text        NOT NULL,  -- URGENTE | NOCTURNO | SERVICE
  movil             integer,
  es_asignado       boolean     NOT NULL,
  movil_activo      boolean     NOT NULL,  -- false + asignado = "atrapado"
  asignado_desde    timestamptz,
  -- true cuando fch_hora_asignado venia NULL y se uso updated_at (pasa
  -- en el 89% de los pendientes: el sender la emite al cierre).
  asignado_es_proxy boolean     NOT NULL DEFAULT false,
  minutos_desde_asignacion numeric,
  PRIMARY KEY (corrida_at, escenario, origen, pedido_id)
);

COMMENT ON TABLE demoras_corrida_pedido IS
  'Caja negra: los pedidos pendientes que formaban la cola de cada corrida, con el dato crudo (minutos desde la asignacion) en vez del aporte ya calculado, para poder re-simular cualquier asignados_modo. Espejo del detalle detras de demoras_cola().';

-- 1d. El ritmo en sus cuatro niveles CRUDOS, una vez por dia (no por
--     corrida: demoras_ritmo depende solo de la fecha). Guardar los
--     niveles crudos -- y no la cascada ya resuelta -- es lo que permite
--     simular "que hubiera pasado con el ritmo de zona" o "con el p75".
CREATE TABLE IF NOT EXISTS demoras_corrida_ritmo (
  fecha         date    NOT NULL,
  escenario     integer NOT NULL,
  nivel         text    NOT NULL,  -- ZONA | MOVIL | CHOFER | GLOBAL
  clave         text    NOT NULL,  -- zona_id | movil | chofer | '' (global)
  tipo_servicio text    NOT NULL,
  media         numeric,
  mediana       numeric,
  p75           numeric,
  p90           numeric,
  muestras      integer NOT NULL,
  capturado_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, escenario, nivel, clave, tipo_servicio)
);

COMMENT ON TABLE demoras_corrida_ritmo IS
  'Caja negra: las estadisticas del ritmo en sus cuatro niveles CRUDOS (zona, movil, chofer, global) vigentes cada dia. Recuperables desde metricas_cumplimiento, se persisten por velocidad (no re-escanear 168k entregas por simulacion) y para el espejo exacto.';

-- 1e. El chofer top de cada movil ese dia. Lo necesita el simulador
--     para re-armar la cascada del ritmo a nivel CHOFER (que es donde
--     hoy se resuelve el 99% de las zonas). Mismo criterio que
--     demoras_ritmo_movil: el que mas veces lo manejo en la ventana,
--     desempate alfabetico.
CREATE TABLE IF NOT EXISTS demoras_corrida_chofer (
  fecha         date    NOT NULL,
  escenario     integer NOT NULL,
  movil         integer NOT NULL,
  tipo_servicio text    NOT NULL,
  chofer        text    NOT NULL,
  PRIMARY KEY (fecha, escenario, movil, tipo_servicio)
);

COMMENT ON TABLE demoras_corrida_chofer IS
  'Caja negra: el chofer top de cada movil por dia, para que el simulador pueda re-armar la cascada del ritmo a nivel CHOFER. Mismo criterio de desempate que demoras_ritmo_movil.';

CREATE INDEX IF NOT EXISTS idx_dcm_esc_at   ON demoras_corrida_movil  (escenario, corrida_at);
CREATE INDEX IF NOT EXISTS idx_dcp_esc_at   ON demoras_corrida_pedido (escenario, corrida_at);
CREATE INDEX IF NOT EXISTS idx_dcp_zona     ON demoras_corrida_pedido (escenario, corrida_at, zona_id, tipo_pedido);

-- ─── 2. El detalle por pedido detras de demoras_cola ─────────────────
-- ATENCION deriva: es demoras_cola SIN el GROUP BY final. Cada CTE es
-- textualmente la del original (cfg / sa / crudo / visible / marcado);
-- lo unico que se agrega es el id del pedido, su origen y los minutos
-- desde la asignacion. NO expande por `pool` (un URGENTE cuenta para la
-- cola de URGENTE y de NOCTURNO): el pedido se guarda UNA vez con su
-- tipo real y esa expansion la hace el simulador, igual que el original.
-- El assert del harness suma este detalle y lo compara contra
-- demoras_cola: si alguien toca una y no la otra, revienta.
CREATE OR REPLACE FUNCTION demoras_cola_detalle(p_escenario integer, p_fecha date, p_corrida_at timestamptz)
RETURNS TABLE(origen text, pedido_id bigint, zona_nro integer, tipo text, movil integer,
              es_asignado boolean, movil_activo boolean, asignado_desde timestamptz,
              asignado_es_proxy boolean, minutos_desde_asignacion numeric)
LANGUAGE sql
STABLE
AS $function$
  WITH sa AS (
    SELECT (SELECT es.pedidos_sa_minutos_antes
              FROM escenario_settings es
             WHERE es.escenario_id = p_escenario) AS mins
  ),
  crudo AS (
    -- OJO: la PK de pedidos/services se llama `id` (NO pedido_id: esa
    -- columna existe en metricas_cumplimiento, no aca).
    SELECT 'PEDIDO'::text AS org, p.id::bigint AS pid,
           p.zona_nro AS zn, p.movil AS mv, p.fch_hora_para AS fpara,
           p.fch_hora_asignado AS fasig, p.updated_at AS upd,
           CASE upper(trim(coalesce(p.servicio_nombre,'')))
             WHEN 'NOCTURNO' THEN 'NOCTURNO'
             WHEN 'URGENTE'  THEN 'URGENTE'
             ELSE NULL
           END AS tp
    FROM pedidos p
    WHERE p.escenario = p_escenario AND p.estado_nro = 1
      AND COALESCE(p.fch_para, (p.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND p.zona_nro IS NOT NULL
    UNION ALL
    SELECT 'SERVICE', s.id::bigint,
           s.zona_nro, s.movil, s.fch_hora_para,
           s.fch_hora_asignado, s.updated_at, 'SERVICE'
    FROM services s
    WHERE s.escenario = p_escenario AND s.estado_nro = 1
      AND COALESCE(s.fch_para, (s.fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      AND s.zona_nro IS NOT NULL
  ),
  visible AS (
    SELECT c.*
    FROM crudo c, sa
    WHERE c.tp IS NOT NULL
      AND (
        (c.mv IS NOT NULL AND c.mv <> 0)
        OR sa.mins IS NULL OR sa.mins = 0
        OR c.fpara IS NULL
        OR c.fpara <= p_corrida_at + (sa.mins * interval '1 minute')
      )
  )
  SELECT v.org, v.pid, v.zn, v.tp, v.mv,
         (v.mv IS NOT NULL AND v.mv <> 0) AS asignado,
         CASE WHEN v.mv IS NOT NULL AND v.mv <> 0 THEN
           EXISTS (SELECT 1 FROM moviles_dia md
                    WHERE md.escenario_id = p_escenario
                      AND md.movil_id     = v.mv
                      AND md.fecha        = p_fecha
                      AND md.activo)
         ELSE false END AS activo,
         coalesce(v.fasig, v.upd) AS desde,
         (v.fasig IS NULL)        AS proxy,
         CASE WHEN coalesce(v.fasig, v.upd) IS NOT NULL
              THEN round((EXTRACT(EPOCH FROM (p_corrida_at - coalesce(v.fasig, v.upd))) / 60.0)::numeric, 2)
         END AS mins_desde
  FROM visible v;
$function$;

COMMENT ON FUNCTION demoras_cola_detalle(integer, date, timestamptz) IS
  'El detalle por pedido detras de demoras_cola(): mismas CTEs sin el GROUP BY final, mas el id, el origen y los minutos desde la asignacion. Alimenta la caja negra. El assert del harness suma este detalle contra demoras_cola y revienta si driftean.';

-- ─── 3. Los cuatro niveles CRUDOS del ritmo ──────────────────────────
-- Una sola pasada sobre demoras_ritmo_muestras (la misma que usan
-- demoras_ritmo y demoras_ritmo_movil) agregada por los cuatro niveles.
-- A diferencia de aquellas, NO resuelve cascada: devuelve los niveles
-- para que el simulador arme la cascada que quiera.
CREATE OR REPLACE FUNCTION demoras_ritmo_niveles(p_escenario integer, p_hasta date)
RETURNS TABLE(nivel text, clave text, tipo text, media numeric, mediana numeric,
              p75 numeric, p90 numeric, muestras integer)
LANGUAGE sql
STABLE
AS $function$
  WITH cfg AS (
    SELECT coalesce(dm.ritmo_dias_ventana, 7)           AS dias,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)     AS hueco_max,
           coalesce(dm.ritmo_hueco_min_minutos, 5)      AS hueco_min,
           coalesce(dm.ritmo_solo_con_cola, false)      AS solo_con_cola
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  base AS MATERIALIZED (
    SELECT m.zona_nro, m.tipo AS tp, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.hueco_min, c.solo_con_cola
         ) m
  )
  SELECT 'ZONA', b.zona_nro::text, b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b WHERE b.zona_nro IS NOT NULL GROUP BY b.zona_nro, b.tp
  UNION ALL
  SELECT 'MOVIL', b.movil::text, b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b WHERE b.movil IS NOT NULL GROUP BY b.movil, b.tp
  UNION ALL
  SELECT 'CHOFER', b.chofer, b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b WHERE b.chofer IS NOT NULL GROUP BY b.chofer, b.tp
  UNION ALL
  SELECT 'GLOBAL', '', b.tp,
         round(avg(b.v), 2),
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2),
         count(*)::integer
  FROM base b GROUP BY b.tp;
$function$;

COMMENT ON FUNCTION demoras_ritmo_niveles(integer, date) IS
  'Las estadisticas del ritmo en los cuatro niveles CRUDOS (zona, movil, chofer, global), sin resolver cascada, en una sola pasada sobre demoras_ritmo_muestras. Alimenta demoras_corrida_ritmo y al simulador.';

-- ─── 4. La captura ───────────────────────────────────────────────────
-- La firma cambio (se agrego p_forzar con DEFAULT): CREATE OR REPLACE NO
-- reemplaza en ese caso, CREA UNA SEGUNDA funcion, y entonces cualquier
-- llamada con dos argumentos queda ambigua (42725). Paso de verdad el
-- 7/8 y el trigger fallaba en silencio porque su EXCEPTION se tragaba
-- el error -- de ahi tambien la tabla de errores de mas abajo.
DROP FUNCTION IF EXISTS demoras_corrida_snapshot(timestamptz, integer);

CREATE OR REPLACE FUNCTION demoras_corrida_snapshot(
  p_corrida_at timestamptz, p_escenario integer, p_forzar boolean DEFAULT false)
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
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = p_escenario;
  IF NOT FOUND THEN RETURN 0; END IF;

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

  RETURN v_n;
END;
$function$;

-- 4d. El ritmo del dia: UNA vez por (fecha, escenario), y DELIBERADAMENTE
--     fuera de demoras_corrida_snapshot. El ritmo no cambia durante el
--     dia (demoras_ritmo depende solo de la fecha), pero calcularlo
--     escanea las ~168.000 entregas del historico: no tiene por que
--     estar en el camino critico de la corrida. Lo llama el job.
CREATE OR REPLACE FUNCTION demoras_corrida_ritmo_dia(p_fecha date, p_escenario integer)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE v_n integer := 0; v_paso integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM demoras_modelo WHERE escenario_id = p_escenario) THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM demoras_corrida_ritmo
                  WHERE fecha = p_fecha AND escenario = p_escenario) THEN
    INSERT INTO demoras_corrida_ritmo (
      fecha, escenario, nivel, clave, tipo_servicio, media, mediana, p75, p90, muestras)
    SELECT p_fecha, p_escenario, r.nivel, r.clave, r.tipo, r.media, r.mediana, r.p75, r.p90, r.muestras
    FROM demoras_ritmo_niveles(p_escenario, p_fecha) r
    ON CONFLICT (fecha, escenario, nivel, clave, tipo_servicio) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  -- El mapeo movil -> chofer top del dia (mismo criterio y desempate
  -- que demoras_ritmo_movil: mas apariciones, despues alfabetico).
  IF NOT EXISTS (SELECT 1 FROM demoras_corrida_chofer
                  WHERE fecha = p_fecha AND escenario = p_escenario) THEN
    INSERT INTO demoras_corrida_chofer (fecha, escenario, movil, tipo_servicio, chofer)
    SELECT DISTINCT ON (c.movil, c.tipo) p_fecha, p_escenario, c.movil, c.tipo, c.chofer
    FROM (
      SELECT m.movil, m.tipo, m.chofer, count(*) AS n
      FROM demoras_modelo dm,
           LATERAL demoras_ritmo_muestras(
             p_escenario, p_fecha,
             coalesce(dm.ritmo_dias_ventana, 7),
             coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS'),
             coalesce(dm.ritmo_hueco_max_minutos, 90),
             coalesce(dm.ritmo_hueco_min_minutos, 5),
             coalesce(dm.ritmo_solo_con_cola, false)) m
      WHERE dm.escenario_id = p_escenario
        AND m.movil IS NOT NULL AND m.chofer IS NOT NULL
      GROUP BY m.movil, m.tipo, m.chofer
    ) c
    ORDER BY c.movil, c.tipo, c.n DESC, c.chofer
    ON CONFLICT (fecha, escenario, movil, tipo_servicio) DO NOTHING;
    GET DIAGNOSTICS v_paso = ROW_COUNT;
    v_n := v_n + v_paso;
  END IF;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION demoras_corrida_ritmo_dia(date, integer) IS
  'Persiste UNA vez por dia las estadisticas del ritmo en sus cuatro niveles crudos y el mapeo movil->chofer. Fuera del camino critico de la corrida a proposito: calcularlo escanea las ~168.000 entregas del historico, y el ritmo no cambia durante el dia.';

-- ─── 4bis. La captura EN EL INSTANTE: trigger sobre demoras_calculadas
-- El desfase de la captura importa, y esta MEDIDO: con el job externo,
-- las divergencias del simulador contra el motor caian con el desfase
-- (660 s -> 121 filas, 71 s -> 37, 10 s -> 11 de 201). La causa es
-- obvia en retrospectiva: `carga_fuera` de cada movil sale de los
-- pedidos pendientes, que cambian minuto a minuto.
--
-- La unica captura EXACTA es la que ocurre dentro de la misma
-- transaccion que la corrida. Este trigger la hace sin modificar
-- demoras_calcular_run: se dispara UNA vez por statement (no por fila)
-- despues del INSERT del motor, y lee el mismo estado del mundo que
-- vio la corrida.
--
-- Sobre el riesgo (el mismo que hizo mover el laboratorio a un job
-- propio): un fallo comun queda atrapado por el EXCEPTION y solo deja
-- un WARNING. Lo que WHEN OTHERS no atrapa es query_canceled, o sea un
-- statement_timeout o un pg_cancel_backend. Verificado en este server:
-- el job corre como supabase_admin, cuyo rol NO define
-- statement_timeout, y el default de la base es 0 -- no hay timeout que
-- pueda disparar. Queda el pg_cancel_backend manual, que solo ocurre si
-- alguien cancela la corrida a mano.
-- El costo medido de la captura es ~0,3 s (el ritmo del dia, que era la
-- parte cara, se movio al job).
-- Un blindaje que solo hace RAISE WARNING es un blindaje MUDO: el
-- warning va al log de Postgres, que nadie mira, y una captura rota
-- puede pasar semanas invisible. Paso el 7/8 (la funcion quedo con dos
-- firmas y el trigger fallaba en silencio). Por eso los fallos se
-- escriben en una tabla que la pantalla puede leer.
CREATE TABLE IF NOT EXISTS demoras_lab_errores (
  id         bigserial PRIMARY KEY,
  ocurrio_at timestamptz NOT NULL DEFAULT now(),
  origen     text NOT NULL,
  corrida_at timestamptz,
  escenario  integer,
  detalle    text
);

COMMENT ON TABLE demoras_lab_errores IS
  'Los fallos que los blindajes del laboratorio atrapan. Existe porque un RAISE WARNING no lo lee nadie: sin esta tabla, una captura rota puede pasar semanas invisible.';

CREATE INDEX IF NOT EXISTS idx_lab_errores_at ON demoras_lab_errores (ocurrio_at DESC);

CREATE OR REPLACE FUNCTION demoras_corrida_capturar_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT n.corrida_at AS at, n.escenario AS esc FROM nuevas n LOOP
    BEGIN
      PERFORM demoras_corrida_snapshot(r.at, r.esc, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'caja negra: fallo la captura de % / escenario % -- % (la corrida real no se toca)',
        r.at, r.esc, SQLERRM;
      INSERT INTO demoras_lab_errores (origen, corrida_at, escenario, detalle)
      VALUES ('captura', r.at, r.esc, SQLERRM);
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

DO $do$
BEGIN
  -- lock_timeout para no quedar encolado detras de una corrida en vuelo
  -- (el gotcha conocido: un DDL en cola bloquea a los lectores de atras).
  SET LOCAL lock_timeout = '3s';
  DROP TRIGGER IF EXISTS trg_demoras_caja_negra ON demoras_calculadas;
  CREATE TRIGGER trg_demoras_caja_negra
    AFTER INSERT ON demoras_calculadas
    REFERENCING NEW TABLE AS nuevas
    FOR EACH STATEMENT EXECUTE FUNCTION demoras_corrida_capturar_trg();
END
$do$;

COMMENT ON FUNCTION demoras_corrida_snapshot(timestamptz, integer, boolean) IS
  'Captura el estado del mundo de una corrida ya commiteada: parametria y universo (meta), el aporte de cada movil (irrecuperable), los pedidos de la cola con el dato crudo, y una vez por dia las estadisticas del ritmo en sus cuatro niveles. La dispara el job demoras-variantes. Ver docs/sqls/2026-08-07-caja-negra-corridas.sql.';

-- ─── 5. El job de captura: cada 15 SEGUNDOS ──────────────────────────
-- La captura tiene su propio job, separado del laboratorio, y corre
-- cada 15 segundos. No es exceso: es la diferencia entre una copia fiel
-- y una aproximada.
--
-- MEDIDO el 7/8 con el job de un minuto (desfase real 71 s): en esos 71
-- segundos 9 pedidos se entregaron y 4 se asignaron, y la cola
-- reconstruida diferia de la que vio el motor en 9 de 192 filas.
-- Se intento reconstruir el estado "as of" la corrida usando los
-- timestamps (incluir los entregados despues, des-asignar los asignados
-- despues) y EMPEORO (14 divergencias): cuando fch_hora_asignado viene
-- NULL -- el 86% de los pendientes asignados, porque el sender la emite
-- al cierre -- no hay forma de saber cuando se asigno. Los datos no
-- alcanzan para adivinar el pasado; si alcanzan para no perder el
-- presente.
--
-- Con 15 segundos el desfase tipico baja a ~10 s y el residuo a ~1%.
-- Ademas, el simulador usa los AGREGADOS del motor (exactos, ya
-- persistidos en demoras_calculadas) como verdad para la cola, y el
-- detalle solo para repartir el progreso entre los asignados: asi el
-- residuo no se propaga a los totales.
--
-- Nota: pg_cron 1.6 soporta intervalos en segundos.
CREATE OR REPLACE FUNCTION demoras_corrida_backfill(p_minutos_max integer DEFAULT 15, p_max_corridas integer DEFAULT 4)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  r          record;
  v_corridas integer := 0;
BEGIN
  -- Lock propio, distinto del motor y del laboratorio.
  IF NOT pg_try_advisory_xact_lock(2180637407::bigint) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT dc.escenario, dc.corrida_at
    FROM (
      SELECT DISTINCT d.escenario, d.corrida_at
      FROM demoras_calculadas d
      WHERE d.corrida_at >= now() - make_interval(mins => p_minutos_max)
        AND NOT EXISTS (
          SELECT 1 FROM demoras_corrida_meta cm
          WHERE cm.escenario = d.escenario AND cm.corrida_at = d.corrida_at)
    ) dc
    ORDER BY dc.corrida_at, dc.escenario
    LIMIT p_max_corridas
  LOOP
    PERFORM demoras_corrida_snapshot(r.corrida_at, r.escenario);
    v_corridas := v_corridas + 1;
  END LOOP;

  -- El ritmo del dia (caro, estable): aca y no en la corrida.
  PERFORM demoras_corrida_ritmo_dia((now() AT TIME ZONE 'America/Montevideo')::date, m.escenario_id)
  FROM demoras_modelo m;

  RETURN v_corridas;
END;
$function$;

COMMENT ON FUNCTION demoras_corrida_backfill(integer, integer) IS
  'Captura la caja negra de las corridas recientes que aun no la tienen. La llama el job demoras-caja-negra cada 15 segundos: cuanto menor el desfase con la corrida, mas fiel la copia del estado del mundo (medido: con 71 s de desfase, 13 pedidos cambiaban de estado). Lock propio.';

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-caja-negra';
    PERFORM cron.schedule(
      'demoras-caja-negra',
      '15 seconds',
      $job$SELECT demoras_corrida_backfill(15, 4)$job$
    );
  END IF;
END
$do$;

-- ─── 6. Retencion: 90 dias ───────────────────────────────────────────
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demoras-caja-negra-limpieza';
    PERFORM cron.schedule(
      'demoras-caja-negra-limpieza',
      '55 6 * * *',  -- 03:55 Montevideo
      $job$
        DELETE FROM demoras_corrida_movil  WHERE corrida_at < now() - interval '90 days';
        DELETE FROM demoras_corrida_pedido WHERE corrida_at < now() - interval '90 days';
        DELETE FROM demoras_corrida_meta   WHERE corrida_at < now() - interval '90 days';
        DELETE FROM demoras_corrida_ritmo  WHERE fecha < (now() AT TIME ZONE 'America/Montevideo')::date - 90;
        DELETE FROM demoras_corrida_chofer WHERE fecha < (now() AT TIME ZONE 'America/Montevideo')::date - 90;
      $job$
    );
  END IF;
END
$do$;
