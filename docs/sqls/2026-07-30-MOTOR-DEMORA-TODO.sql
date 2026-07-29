-- =====================================================================
-- MOTOR DE DEMORA INFORMADA — TODAS LAS MIGRACIONES, EN ORDEN
-- Generado: 2026-07-29 | Aplicar de una sola vez en el SQL Editor.
--
-- Guia operativa completa: docs/DEMORA_INFORMADA.md
-- Diseno: docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md
--
-- El ultimo bloque (cron) requiere pg_cron habilitado. Si no lo esta,
-- todo lo anterior aplica igual y el motor se puede correr a mano con
--   SELECT demoras_calcular_run();
--
-- VERIFICAR DESPUES DE APLICAR:
--   SELECT has_table_privilege('anon','demoras_config','UPDATE');  -- debe dar f
--   SELECT demoras_calcular_run();
-- =====================================================================


-- #####################################################################
-- ### 2026-07-29-demoras-acabado.sql
-- #####################################################################

-- =====================================================================
-- demoras_acabado — clamp, suavizado asimetrico y redondeo
-- Fecha: 2026-07-29 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- El ORDEN es parte del contrato y no es negociable:
--   crudo -> clamp -> suavizado -> redondeo
-- Si se redondea antes de suavizar, el suavizado opera sobre escalones y
-- se traba en falso.
--
-- Devuelve DOS numeros a proposito:
--   suavizada  continua, sin redondear -> es el estado que arrastra a la
--              proxima corrida. Sin esto el redondeo se comeria los
--              incrementos chicos y el valor nunca se moveria.
--   informada  redondeada -> es la salida que se muestra.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_acabado(
  p_crudo   numeric,
  p_prev    numeric,   -- NULL = primera corrida del dia
  p_min     integer,
  p_max     integer,
  p_subida  integer,
  p_bajada  integer,
  p_escalon integer
)
RETURNS TABLE (
  suavizada          numeric,
  informada          integer,
  clampeado          text,
  suavizado_aplicado boolean
)
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_clamp  numeric;
  v_suav   numeric;
  v_marca  text := NULL;
  v_aplico boolean := false;
BEGIN
  -- 1-2. clamp
  v_clamp := p_crudo;
  IF v_clamp < p_min THEN v_clamp := p_min; v_marca := 'MIN'; END IF;
  IF v_clamp > p_max THEN v_clamp := p_max; v_marca := 'MAX'; END IF;

  -- 3. suavizado asimetrico contra la corrida anterior
  IF p_prev IS NULL THEN
    v_suav := v_clamp;
  ELSIF v_clamp > p_prev THEN
    v_suav := least(v_clamp, p_prev + p_subida);
    v_aplico := (v_suav < v_clamp);
  ELSIF v_clamp < p_prev THEN
    v_suav := greatest(v_clamp, p_prev - p_bajada);
    v_aplico := (v_suav > v_clamp);
  ELSE
    v_suav := v_clamp;
  END IF;

  -- 4. redondeo hacia arriba al escalon, acotado por piso y techo
  -- El suavizado puede mover el valor fuera del rango si p_prev estaba fuera;
  -- la config es editable en caliente (demoras_config.min_minutos /
  -- demoras_config.max_minutos, por escenario y tipo),
  -- asi que volvemos a acotar aqui. La informada nunca sale del rango configurado.
  RETURN QUERY SELECT
    v_suav,
    greatest(p_min, least(p_max, (ceil(v_suav::numeric / p_escalon) * p_escalon)))::integer,
    v_marca,
    v_aplico;
END;
$fn$;

COMMENT ON FUNCTION demoras_acabado(numeric,numeric,integer,integer,integer,integer,integer) IS
  'Aplica clamp -> suavizado asimetrico -> redondeo hacia arriba, acotando por piso y techo. Devuelve la suavizada continua (estado para la proxima corrida) y la informada redondeada (salida). La informada nunca sale del rango [p_min, p_max] incluso si el suavizado la movieria fuera, lo que puede ocurrir cuando la config se edita en caliente. p_prev NULL = primera corrida del dia.';


-- #####################################################################
-- ### 2026-07-29-demoras-capacidad.sql
-- #####################################################################

-- =====================================================================
-- demoras_capacidad — capacidad efectiva por (zona, tipo)
-- Fecha: 2026-07-29 | Idempotente
--
-- Un movil NO vale uno. Su presencia se reparte entre las zonas que
-- atiende, con peso 1 si es de prioridad y alpha si es de transito, y se
-- NORMALIZA dentro de cada tipo de servicio. Asi un movil que atiende 4
-- zonas nunca suma 4 moviles de capacidad.
--
-- Mismo mecanismo que lib/zonas-cap-entrega.ts, pero aplicado a la
-- PRESENCIA del movil en vez de a unidades de lote (el tamano del lote se
-- descarto explicitamente del modelo de demora).
--
-- Solo cuenta moviles con moviles_dia.activo = true.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_capacidad(p_escenario integer, p_fecha date)
RETURNS TABLE (
  zona_id            integer,
  tipo_servicio      text,
  capacidad_efectiva numeric,
  moviles_activos    integer,
  moviles_prioridad  integer,
  moviles_transito   integer,
  alpha_usado        numeric
)
LANGUAGE sql
STABLE
AS $fn$
  WITH alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3) AS a
  ),
  -- Asignaciones vigentes de moviles ACTIVOS hoy.
  asign AS (
    SELECT mz.movil_id::integer AS movil,
           mz.zona_id,
           mz.tipo_de_servicio  AS tipo,
           CASE WHEN mz.prioridad_o_transito = 1 THEN 1::numeric ELSE (SELECT a FROM alpha) END AS peso,
           (mz.prioridad_o_transito = 1) AS es_prioridad
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id   = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha      = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  -- W: suma de pesos de ESE movil dentro de ESE tipo.
  pesos AS (
    SELECT a.*, sum(a.peso) OVER (PARTITION BY a.movil, a.tipo) AS w
    FROM asign a
  )
  SELECT
    p.zona_id,
    p.tipo                                                   AS tipo_servicio,
    -- Redondeo a 4 decimales (réplica lib/zonas-cap-entrega.ts:76-77).
    -- Nota: suma de fracciones redondeadas independientemente ≠ 1.0 exacto.
    -- Residuo típico ~1e-4, no es invariante duro.
    round(sum(CASE WHEN p.w > 0 THEN p.peso / p.w ELSE 0 END), 4) AS capacidad_efectiva,
    count(DISTINCT p.movil)::integer                          AS moviles_activos,
    count(DISTINCT p.movil) FILTER (WHERE p.es_prioridad)::integer     AS moviles_prioridad,
    count(DISTINCT p.movil) FILTER (WHERE NOT p.es_prioridad)::integer AS moviles_transito,
    (SELECT a FROM alpha)                                     AS alpha_usado
  FROM pesos p
  GROUP BY p.zona_id, p.tipo;
$fn$;

COMMENT ON FUNCTION demoras_capacidad(integer, date) IS
  'Capacidad efectiva por (zona, tipo): suma del aporte prorrateado de los moviles ACTIVOS. peso 1 prioridad / alpha transito, normalizado por tipo. Suma de aportes de un movil = 1 ± residuo de redondeo (~1e-4); no es invariante exacto.';


-- #####################################################################
-- ### 2026-07-29-demoras-ritmo.sql
-- #####################################################################

-- =====================================================================
-- demoras_ritmo — cuanto tarda un pedido, por (zona, tipo)
-- Fecha: 2026-07-29 | Idempotente
--
-- Se calculan y devuelven LAS CUATRO estadisticas sobre
-- demora_efectiva_mins de los ultimos p_dias. Cual alimenta el calculo lo
-- decide la config (demoras_config.estadistico, por escenario y tipo);
-- guardar las cuatro permite
-- reprocesar el historico con otra sin recalcular nada.
--
-- Si la zona no llega a p_min_muestras hechos, cae al global del tipo.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo(
  p_escenario    integer,
  p_hasta        date,
  p_dias         integer DEFAULT 7,
  p_min_muestras integer DEFAULT 5
)
RETURNS TABLE (
  zona_id        integer,
  tipo_servicio  text,
  ritmo_media    numeric,
  ritmo_mediana  numeric,
  ritmo_p75      numeric,
  ritmo_p90      numeric,
  ritmo_origen   text,
  ritmo_muestras integer
)
LANGUAGE sql
STABLE
AS $fn$
  WITH universo AS (
    -- Pares (zona, tipo) que tienen moviles asignados en moviles_zonas.
    -- Es el universo de referencia: incluso zonas sin hechos en la ventana
    -- deben devolver una fila (con fallback a global).
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  base AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.demora_efectiva_mins AS v
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS se excluyen del motor de demora por decision del
      -- usuario (2026-07-28): no tienen oferta propia en moviles_zonas.
      AND m.tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  por_zona AS (
    SELECT zona_nro AS zona_id, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY zona_nro, tipo
  ),
  global AS (
    SELECT tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY tipo
  )
  SELECT u.zona_id,
         u.tipo,
         CASE WHEN coalesce(z.n, 0) >= p_min_muestras THEN z.media   ELSE g.media   END,
         CASE WHEN coalesce(z.n, 0) >= p_min_muestras THEN z.mediana ELSE g.mediana END,
         CASE WHEN coalesce(z.n, 0) >= p_min_muestras THEN z.p75     ELSE g.p75     END,
         CASE WHEN coalesce(z.n, 0) >= p_min_muestras THEN z.p90     ELSE g.p90     END,
         CASE WHEN coalesce(z.n, 0) >= p_min_muestras THEN 'ZONA'    ELSE 'GLOBAL'  END,
         coalesce(CASE WHEN coalesce(z.n, 0) >= p_min_muestras THEN z.n ELSE g.n END, 0)
  FROM universo u
  LEFT JOIN por_zona z ON z.zona_id = u.zona_id AND z.tipo = u.tipo
  LEFT JOIN global g ON g.tipo = u.tipo;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date, integer, integer) IS
  'Las cuatro estadisticas (media/mediana/p75/p90) de demora_efectiva_mins por (zona, tipo) sobre los ultimos p_dias. Cae al global del tipo si la zona no llega a p_min_muestras. ESPECIAL y OTROS se excluyen del motor (no tienen oferta propia en moviles_zonas).';


-- #####################################################################
-- ### 2026-07-29-demoras-calculadas-tabla.sql
-- #####################################################################

-- =====================================================================
-- demoras_calculadas — hechos del motor de demora + su configuracion
-- Fecha: 2026-07-29 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Guarda el resultado Y LOS INSUMOS. Sin los insumos el motor es una caja
-- negra: no se puede contestar "por que esta zona informo 90" seis semanas
-- despues, y nadie va a confiar en el numero.
--
-- demora_as400 es un snapshot: el import del AS400 PISA su tabla en cada
-- corrida, asi que si no lo fotografiamos aca la comparativa es imposible.
-- =====================================================================
CREATE TABLE IF NOT EXISTS demoras_calculadas (
  corrida_at             timestamptz NOT NULL,
  escenario              integer     NOT NULL,
  zona_id                integer     NOT NULL,
  tipo_servicio          text        NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')),

  demora_informada       integer     NOT NULL,
  demora_suavizada       numeric     NOT NULL,
  demora_cruda           numeric     NOT NULL,
  demora_as400           integer,

  pendientes_asignados   integer     NOT NULL DEFAULT 0,
  pendientes_sin_asignar integer     NOT NULL DEFAULT 0,
  pendientes_atrapados   integer     NOT NULL DEFAULT 0,

  capacidad_efectiva     numeric     NOT NULL DEFAULT 0,
  moviles_activos        integer     NOT NULL DEFAULT 0,
  moviles_prioridad      integer     NOT NULL DEFAULT 0,
  moviles_transito       integer     NOT NULL DEFAULT 0,
  alpha_usado            numeric     NOT NULL DEFAULT 0.3,

  ritmo_media            numeric,
  ritmo_mediana          numeric,
  ritmo_p75              numeric,
  ritmo_p90              numeric,
  ritmo_usado            numeric,
  -- DEFECTO: no hubo ninguna estadistica disponible (ni zona ni global) y
  -- ritmo_usado salio de demoras_config.ritmo_default_minutos. Sin esta
  -- etiqueta, esas filas se veian como si vinieran de un calculo global
  -- que nunca ocurrio.
  ritmo_origen           text CHECK (ritmo_origen IN ('CHOFER','MOVIL','ZONA','GLOBAL','DEFECTO')),
  ritmo_muestras         integer,

  sin_capacidad          boolean     NOT NULL DEFAULT false,
  clampeado              text CHECK (clampeado IN ('MIN','MAX')),
  suavizado_aplicado     boolean     NOT NULL DEFAULT false,

  PRIMARY KEY (corrida_at, escenario, zona_id, tipo_servicio)
);

-- Idempotencia (fix round 3): demoras_calculadas y demoras_config se crean
-- en este MISMO archivo, asi que si demoras_config ya existia (la premisa
-- del fix de idempotencia de arriba) entonces demoras_calculadas TAMBIEN
-- existe, con el CHECK viejo de ritmo_origen (sin 'DEFECTO'). El CREATE
-- TABLE IF NOT EXISTS de arriba la saltea entera, y sin este swap la
-- migracion aplica SIN ERROR pero demoras_calcular_run revienta en
-- runtime, en cada corrida que produzca una fila sin estadistica
-- ("violates check constraint demoras_calculadas_ritmo_origen_check") —
-- peor que un apply que aborta, porque el cron falla callado cada 10 min.
-- Mismo patron de swap que ya usa 2026-07-23-metricas-otros-y-subestado.sql
-- (el nombre autogenerado por Postgres para el CHECK inline de una columna
-- es <tabla>_<columna>_check).
ALTER TABLE demoras_calculadas DROP CONSTRAINT IF EXISTS demoras_calculadas_ritmo_origen_check;
ALTER TABLE demoras_calculadas ADD  CONSTRAINT demoras_calculadas_ritmo_origen_check
  CHECK (ritmo_origen IN ('CHOFER','MOVIL','ZONA','GLOBAL','DEFECTO'));

CREATE INDEX IF NOT EXISTS idx_demoras_calc_esc_zona_tipo_at
  ON demoras_calculadas (escenario, zona_id, tipo_servicio, corrida_at DESC);
CREATE INDEX IF NOT EXISTS idx_demoras_calc_at
  ON demoras_calculadas (corrida_at);

COMMENT ON TABLE demoras_calculadas IS
  'Una fila por (corrida, zona, tipo) con la demora calculada y todos sus insumos. Escrita por demoras_calcular_run (pg_cron cada 10 min). NO alimenta a nadie: es solo comparativa contra el AS400.';

-- ─── Configuracion POR ESCENARIO Y POR TIPO DE SERVICIO ──────────────
-- No va en app_config: esa tabla es key-value GLOBAL y esta config tiene que
-- poder diferir por escenario y por tipo. Un NOCTURNO no tiene por que
-- compartir la ventana horaria ni los topes de un URGENTE.
CREATE TABLE IF NOT EXISTS demoras_config (
  escenario_id              integer NOT NULL,
  tipo_servicio             text    NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')),

  motor_activo              boolean NOT NULL DEFAULT true,
  min_minutos               integer NOT NULL DEFAULT 30  CHECK (min_minutos  >= 0),
  max_minutos               integer NOT NULL DEFAULT 120 CHECK (max_minutos  >= 0),
  escalon_minutos           integer NOT NULL DEFAULT 15  CHECK (escalon_minutos > 0),
  subida_max                integer NOT NULL DEFAULT 30  CHECK (subida_max   >= 0),
  bajada_max                integer NOT NULL DEFAULT 15  CHECK (bajada_max   >= 0),
  estadistico               text    NOT NULL DEFAULT 'MEDIANA'
                                    CHECK (estadistico IN ('MEDIA','MEDIANA','P75','P90')),
  ritmo_cascada             text    NOT NULL DEFAULT 'CHOFER,MOVIL,ZONA,GLOBAL',
  ritmo_default_minutos     integer NOT NULL DEFAULT 30 CHECK (ritmo_default_minutos > 0),
  factor_calibracion        numeric NOT NULL DEFAULT 1.0 CHECK (factor_calibracion > 0),
  hora_inicio               time    NOT NULL DEFAULT '07:00',
  hora_fin                  time    NOT NULL DEFAULT '23:30',

  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                text,

  PRIMARY KEY (escenario_id, tipo_servicio),
  CONSTRAINT demoras_config_rango CHECK (max_minutos >= min_minutos)
);

-- Idempotencia (fix round 2): si demoras_config ya existia porque una
-- version anterior de esta migracion ya corrio (p.ej. la de fix round 1,
-- antes de agregar esta columna), el CREATE TABLE IF NOT EXISTS de arriba
-- la saltea entera y ritmo_default_minutos nunca se agrega -> el COMMENT ON
-- COLUMN de mas abajo explota y, bajo --single-transaction, todo el
-- apply hace rollback. Mismo patron que las 48 columnas ADD COLUMN IF NOT
-- EXISTS del resto del repo.
ALTER TABLE demoras_config
  ADD COLUMN IF NOT EXISTS ritmo_default_minutos integer NOT NULL DEFAULT 30 CHECK (ritmo_default_minutos > 0);

-- ─── Ventana horaria: hora_fin TIENE que ser posterior a hora_inicio ──────
-- El motor filtra con `v_hora BETWEEN dc.hora_inicio AND dc.hora_fin`, un
-- rango CERRADO sobre un time: si alguien configura una ventana que cruza la
-- medianoche (el candidato obvio es NOCTURNO con '20:30'-'06:00'), la
-- condicion NUNCA es cierta y ese tipo deja de escribir filas PARA SIEMPRE,
-- sin error, sin log y sin que el cron falle -- el peor modo de falla
-- posible. La guia (docs/DEMORA_INFORMADA.md §5) ensena a editar esta config
-- en caliente, asi que la base tiene que rechazar la ventana envuelta en el
-- momento del UPDATE, no seis semanas despues.
--
-- Ventanas que cruzan medianoche NO estan soportadas: soportarlas requiere
-- cambiar el BETWEEN por una condicion partida en dos en demoras_calcular_run
-- (y en cualquier consumidor futuro de estas columnas). Esta fuera de alcance
-- hoy; el CHECK hace explicito el limite en vez de dejar un pozo silencioso.
--
-- DROP + ADD (no un CHECK inline en el CREATE TABLE) porque la tabla puede ya
-- existir de un apply anterior: mismo patron idempotente que el swap del
-- CHECK de ritmo_origen de mas arriba. Si la tabla ya tuviera una fila con
-- ventana envuelta, el ADD CONSTRAINT falla RUIDOSAMENTE y hay que corregir
-- esa fila antes de seguir -- que es exactamente lo que queremos.
ALTER TABLE demoras_config DROP CONSTRAINT IF EXISTS demoras_config_ventana_horaria;
ALTER TABLE demoras_config ADD  CONSTRAINT demoras_config_ventana_horaria
  CHECK (hora_fin > hora_inicio);

COMMENT ON CONSTRAINT demoras_config_ventana_horaria ON demoras_config IS
  'La ventana operativa de un tipo no puede cruzar la medianoche: demoras_calcular_run evalua v_hora BETWEEN hora_inicio AND hora_fin, que con hora_fin < hora_inicio nunca es cierto y apaga ese tipo en silencio.';

COMMENT ON TABLE demoras_config IS
  'Configuracion del motor de demora por (escenario, tipo de servicio). Editable desde Preferencias Globales. Si falta la fila de un tipo, ese tipo no se calcula.';
COMMENT ON COLUMN demoras_config.ritmo_cascada IS
  'Orden de la cascada de atribucion del ritmo, CSV. Se recorre de izquierda a derecha y gana el primer nivel que llegue al minimo de muestras. Niveles validos: CHOFER, MOVIL, ZONA, GLOBAL. GLOBAL se evalua siempre ultimo aunque no figure: es la red final.';
COMMENT ON COLUMN demoras_config.factor_calibracion IS
  'Multiplicador global del resultado crudo. Existe por el riesgo R1: demora_efectiva_mins ya incluye la espera en cola, asi que multiplicarla por los pendientes puede doble-contar. Permite corregir el nivel sin tocar codigo.';
COMMENT ON COLUMN demoras_config.ritmo_default_minutos IS
  'Piso del ritmo cuando no hay ninguna estadistica disponible (ni zona ni global): antes era un 30 hardcodeado en el orquestador que no quedaba registrado en la fila calculada. Ahora es un parametro del modelo, editable desde Preferencias Globales, y el valor efectivamente usado se persiste en demoras_calculadas.ritmo_usado (auditable).';

-- Seed: los tres tipos del escenario 1000 con los defaults.
-- NOCTURNO arranca con su propia ventana horaria, que es el caso que motivo
-- pasar la config a por-tipo.
INSERT INTO demoras_config (escenario_id, tipo_servicio, hora_inicio, hora_fin) VALUES
  (1000, 'URGENTE',  '07:00', '23:30'),
  (1000, 'NOCTURNO', '18:00', '23:30'),
  (1000, 'SERVICE',  '07:00', '23:30')
ON CONFLICT (escenario_id, tipo_servicio) DO NOTHING;

-- =====================================================================
-- Grants: las dos tablas son EXCLUSIVAS de service_role
-- =====================================================================
-- Las tablas se creaban sin RLS y sin grants explicitos, confiando en los
-- default privileges del proyecto. Eso es una apuesta: si `anon` tiene
-- privilegios por defecto sobre el schema public, `demoras_config` queda
-- ESCRIBIBLE con la anon key -- la que vive en el bundle del browser. Y
-- demoras_config no es una tabla mas: es la que decide que calcula el motor
-- (motor_activo, ventanas, topes, factor de calibracion). Un UPDATE desde
-- afuera apaga el motor o le cambia el resultado sin dejar rastro.
--
-- Nadie las lee con la anon key: el unico consumidor de lectura es
-- app/api/demoras/comparativa, que usa getServerSupabaseClient()
-- (service_role, server-side), y el unico escritor es demoras_calcular_run
-- via pg_cron. Asi que revocar no rompe ningun camino real.
--
-- Misma forma que docs/sqls/2026-07-24-metricas-dashboard-rpc.sql:313-315.
-- Idempotente: REVOKE/GRANT se pueden repetir sin efecto adicional.
REVOKE ALL ON TABLE demoras_calculadas FROM PUBLIC;
REVOKE ALL ON TABLE demoras_calculadas FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_calculadas TO service_role;

REVOKE ALL ON TABLE demoras_config FROM PUBLIC;
REVOKE ALL ON TABLE demoras_config FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_config TO service_role;

-- Verificacion post-apply (las cuatro tienen que dar `f`):
--   SELECT has_table_privilege('anon','demoras_config','UPDATE');
--   SELECT has_table_privilege('anon','demoras_config','SELECT');
--   SELECT has_table_privilege('anon','demoras_calculadas','UPDATE');
--   SELECT has_table_privilege('authenticated','demoras_config','UPDATE');


-- #####################################################################
-- ### 2026-07-29-demoras-calcular-run.sql
-- #####################################################################

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


-- #####################################################################
-- ### 2026-07-30-demoras-ritmo-cascada.sql
-- #####################################################################

-- =====================================================================
-- demoras_ritmo — cascada de cuatro niveles, orden configurable
-- Fecha: 2026-07-30 | Idempotente
--
-- Sube de zona->global a CHOFER -> MOVIL -> ZONA -> GLOBAL. El orden se
-- lee de demoras_config.ritmo_cascada por (escenario, tipo) (CSV,
-- default 'CHOFER,MOVIL,ZONA,GLOBAL'). Gana el primer nivel que llegue a
-- p_min_muestras; niveles desconocidos se ignoran; lista vacia o mal
-- formada cae al default completo. GLOBAL se evalua SIEMPRE ultimo
-- aunque no figure en la lista o este en otra posicion: es la red
-- final, para que sea imposible configurar el motor de forma que se
-- quede sin ritmo.
--
-- Fix round 1 (2026-07-29), sobre 2 Critical + 5 Important de la revision:
--   - Critical 1: 'GLOBAL' sola es una configuracion VALIDA (linea base
--     estable cuando los datos de chofer no son confiables), no una
--     lista vacia/mal formada. El filtro de niveles validos ahora
--     incluye GLOBAL; se le saca GLOBAL a la lista resultante y se
--     reagrega una sola vez al final (array_remove + append), asi
--     'GLOBAL' da cascada=[GLOBAL] (nada mas) en vez de expandirse al
--     default completo, y una lista con GLOBAL en el medio no la
--     duplica ni la deja fuera de lugar.
--   - Critical 2 (numerico, sin cambio de codigo): el fix round agrego
--     un assert que verifica el VALOR del blend ponderado (no solo el
--     origen), con dos moviles de pesos distintos y choferes con
--     ritmos distintos. Ver scripts/sql-harness/assert-ritmo.sql.
--   - Important 3: un mismo chofer puede manejar mas de un movil de la
--     zona (metricas_cumplimiento.chofer es texto libre del AS400, se
--     repite entre camiones de la misma fletera tercerizada). Antes se
--     sumaban sus muestras una vez POR MOVIL que lo referenciaba
--     (duplicando). Ahora se colapsa por chofer (CTE zona_chofer,
--     GROUP BY chofer) antes de sumar: el peso se acumula (son
--     aportes reales de moviles distintos) pero las muestras del
--     chofer se cuentan una sola vez.
--   - Important 4: con peso_transito_alpha=0 (soportado por el CHECK y
--     documentado), un movil de transito puede terminar con
--     peso_norm=0. Antes las ESTADISTICAS se filtraban por "hay dato
--     del chofer/movil" pero las MUESTRAS (n) se sumaban sin mirar el
--     peso: un nivel podia ganar la cascada (n >= minimo) con las
--     cuatro estadisticas en NULL, y demoras_calcular_run terminaba
--     informando el DEFECTO (ritmo_default_minutos) habiendo
--     descartado una estadistica de un nivel inferior con datos reales.
--     Ahora `n`, al igual que las estadisticas, solo cuenta el peso
--     efectivamente aportado (peso_chofer > 0 / peso_norm > 0): un
--     nivel sin peso real no gana la cascada, cae al siguiente.
--
-- CHOFER y MOVIL no son un valor unico por zona: una zona tiene varios
-- moviles activos, cada uno con su chofer. Se resuelven como PROMEDIO
-- PONDERADO por el aporte de cada movil a esa zona -- el mismo aporte
-- que ya calcula demoras_capacidad (peso 1 prioridad / alpha transito,
-- normalizado por movil dentro de cada tipo). Se replica ese prorrateo
-- ACA ADENTRO (CTEs alpha/asign/aporte) en vez de llamar a
-- demoras_capacidad porque esa funcion solo devuelve el agregado por
-- zona: este nivel necesita el aporte POR MOVIL para ponderar. Usa
-- p_hasta como fecha de referencia de moviles_dia, igual que
-- demoras_calcular_run llama a demoras_capacidad(v_esc, v_fecha) y
-- demoras_ritmo(v_esc, v_fecha) con la misma fecha.
--
-- El chofer de un movil es el que mas veces aparece en
-- metricas_cumplimiento.chofer para ese movil en la ventana (nombre-
-- texto, no hay id estable). El ritmo de CHOFER y de MOVIL son
-- estadisticas propias (no dependen de la zona): el ritmo del chofer es
-- su propio historial de demora_efectiva_mins para ese tipo, sin
-- importar en que zona haya andado.
--
-- OJO auditoria: en CHOFER/MOVIL las cuatro columnas (media, mediana,
-- p75, p90) son BLENDS PONDERADOS de las estadisticas propias de cada
-- chofer/movil, no percentiles recalculados sobre el pool de valores
-- crudos. Promediar medianas no es la mediana del pool combinado, y en
-- P75/P90 el sesgo es asimetrico (aplasta la cola, justo el estadistico
-- que se elige para ser conservador). Se acepta a proposito: es la
-- lectura simple que pide el brief, y el blend esta acotado entre el
-- minimo y el maximo de lo que combina (no puede "inventar" un numero
-- fuera de rango), asi que no es peligroso para el uso que le da
-- demoras_calcular_run. Documentado aca para que quien lo audite sepa
-- que no es una poblacion real.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo(
  p_escenario    integer,
  p_hasta        date,
  p_dias         integer DEFAULT 7,
  p_min_muestras integer DEFAULT 5
)
RETURNS TABLE (
  zona_id        integer,
  tipo_servicio  text,
  ritmo_media    numeric,
  ritmo_mediana  numeric,
  ritmo_p75      numeric,
  ritmo_p90      numeric,
  ritmo_origen   text,
  ritmo_muestras integer
)
LANGUAGE sql
STABLE
AS $fn$
  WITH universo AS (
    -- Pares (zona, tipo) que tienen moviles asignados en moviles_zonas.
    -- Es el universo de referencia: incluso zonas sin hechos en la ventana
    -- deben devolver una fila (con fallback a global).
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  base AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.movil,
           m.chofer,
           m.demora_efectiva_mins AS v
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS se excluyen del motor de demora por decision del
      -- usuario (2026-07-28): no tienen oferta propia en moviles_zonas.
      AND m.tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  por_zona AS (
    SELECT zona_nro AS zona_id, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY zona_nro, tipo
  ),
  global AS (
    SELECT tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base GROUP BY tipo
  ),
  por_movil AS (
    -- Ritmo propio de un movil: estadisticas de demora_efectiva_mins de
    -- los pedidos que llevo, sin importar la zona.
    SELECT movil, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base
    WHERE movil IS NOT NULL
    GROUP BY movil, tipo
  ),
  chofer_top_por_movil AS (
    -- El chofer que mas veces manejo cada movil en la ventana. Empate:
    -- orden alfabetico, determinista.
    SELECT DISTINCT ON (movil) movil, chofer
    FROM (
      SELECT movil, chofer, count(*) AS n
      FROM base
      WHERE movil IS NOT NULL AND chofer IS NOT NULL
      GROUP BY movil, chofer
    ) c
    ORDER BY movil, n DESC, chofer
  ),
  por_chofer AS (
    -- Ritmo propio de un chofer: no depende de la zona ni del movil que
    -- este manejando en el momento de la consulta.
    SELECT chofer, tipo,
           round(avg(v),2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base
    WHERE chofer IS NOT NULL
    GROUP BY chofer, tipo
  ),
  -- ─── Aporte de cada movil a cada (zona, tipo) ────────────────────────
  -- Replica el prorrateo de demoras_capacidad (peso 1 prioridad / alpha
  -- transito, normalizado por movil dentro de cada tipo).
  alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3) AS a
  ),
  asign AS (
    SELECT mz.movil_id::integer AS movil,
           mz.zona_id,
           mz.tipo_de_servicio  AS tipo,
           CASE WHEN mz.prioridad_o_transito = 1 THEN 1::numeric ELSE (SELECT a FROM alpha) END AS peso
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id     = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha        = p_hasta
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  aporte AS (
    -- peso_norm puede dar 0 (alpha=0 y el movil es transito puro): el
    -- movil sigue "presente" en la zona pero sin aportar peso real. Los
    -- niveles CHOFER/MOVIL de abajo excluyen expresamente estas filas de
    -- `n`, no solo de las estadisticas (Important 4).
    SELECT movil, zona_id, tipo,
           CASE WHEN w > 0 THEN peso / w ELSE 0 END AS peso_norm
    FROM (
      SELECT a.*, sum(a.peso) OVER (PARTITION BY a.movil, a.tipo) AS w
      FROM asign a
    ) p
  ),
  -- ─── Nivel MOVIL: promedio ponderado del ritmo propio de cada movil ──
  -- El FILTER exige peso_norm>0 (aporte real, no solo "esta asignado") Y
  -- pm.n>0 (el movil tiene ritmo propio calculable). Sin el primero,
  -- un movil con peso 0 puede inflar `n` sin aportar nada al blend
  -- (Important 4).
  por_zona_movil AS (
    SELECT ap.zona_id, ap.tipo,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.media)   FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS media,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.mediana) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS mediana,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.p75)     FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS p75,
           CASE WHEN sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) > 0
                THEN round(sum(ap.peso_norm * pm.p90)     FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0) / sum(ap.peso_norm) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 2) END AS p90,
           coalesce(sum(pm.n) FILTER (WHERE ap.peso_norm > 0 AND pm.n > 0), 0)::integer AS n
    FROM aporte ap
    LEFT JOIN por_movil pm ON pm.movil = ap.movil AND pm.tipo = ap.tipo
    GROUP BY ap.zona_id, ap.tipo
  ),
  -- ─── Nivel CHOFER: promedio ponderado del ritmo propio del chofer de
  -- cada movil ───────────────────────────────────────────────────────
  movil_chofer AS (
    -- Cada movil de la zona x tipo, resuelto a su chofer top y al ritmo
    -- propio de ese chofer.
    SELECT ap.zona_id, ap.tipo, ap.movil, ap.peso_norm,
           ctm.chofer,
           pc.media   AS chofer_media,
           pc.mediana AS chofer_mediana,
           pc.p75     AS chofer_p75,
           pc.p90     AS chofer_p90,
           pc.n       AS chofer_n
    FROM aporte ap
    LEFT JOIN chofer_top_por_movil ctm ON ctm.movil = ap.movil
    LEFT JOIN por_chofer pc ON pc.chofer = ctm.chofer AND pc.tipo = ap.tipo
  ),
  zona_chofer AS (
    -- Un mismo chofer puede manejar mas de un movil de la zona (flota
    -- tercerizada: metricas_cumplimiento.chofer es texto libre del
    -- AS400, se repite entre camiones de la misma fletera). Se suman
    -- los pesos que le corresponden a traves de los moviles que lo
    -- referencian (aportes reales, distintos), pero sus MUESTRAS
    -- (chofer_n) se cuentan UNA sola vez: es el mismo historial del
    -- chofer, no uno distinto por cada movil (Important 3).
    SELECT zona_id, tipo, chofer,
           sum(peso_norm)             AS peso_chofer,
           max(chofer_media)          AS media,
           max(chofer_mediana)        AS mediana,
           max(chofer_p75)            AS p75,
           max(chofer_p90)            AS p90,
           max(coalesce(chofer_n,0))  AS n
    FROM movil_chofer
    WHERE chofer IS NOT NULL AND chofer_n > 0
    GROUP BY zona_id, tipo, chofer
  ),
  por_zona_chofer AS (
    -- Mismo FILTER por peso_chofer>0 que MOVIL: un chofer cuyos moviles
    -- aportaron peso 0 (alpha=0, transito puro) no debe ganar la
    -- cascada con estadisticas NULL (Important 4).
    SELECT zona_id, tipo,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * media)   FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS media,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * mediana) FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS mediana,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * p75)     FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS p75,
           CASE WHEN sum(peso_chofer) FILTER (WHERE peso_chofer > 0) > 0
                THEN round(sum(peso_chofer * p90)     FILTER (WHERE peso_chofer > 0) / sum(peso_chofer) FILTER (WHERE peso_chofer > 0), 2) END AS p90,
           coalesce(sum(n) FILTER (WHERE peso_chofer > 0), 0)::integer AS n
    FROM zona_chofer
    GROUP BY zona_id, tipo
  ),
  -- ─── Orden de la cascada por (escenario, tipo) ───────────────────────
  -- Se parsea, se filtra a niveles validos (CHOFER, MOVIL, ZONA, GLOBAL)
  -- preservando el orden de aparicion; si no queda NINGUNO valido (falta
  -- la fila de config, lista vacia, o basura como 'FRUTA,,XX') cae al
  -- default completo. GLOBAL se saca de la posicion en que haya venido
  -- (si vino) y se reagrega UNA sola vez al final: es la red final,
  -- nunca se pierde ni se cuenta dos veces, y una lista de solo 'GLOBAL'
  -- es una configuracion valida en si misma (no dispara el fallback a
  -- default: 'GLOBAL' no es una lista vacia/mal formada).
  cascada_cruda AS (
    SELECT dc.tipo_servicio AS tipo, trim(u.lvl) AS lvl, u.ord
    FROM demoras_config dc,
         LATERAL unnest(string_to_array(upper(coalesce(dc.ritmo_cascada,'')), ',')) WITH ORDINALITY AS u(lvl, ord)
    WHERE dc.escenario_id = p_escenario
  ),
  cascada_valida AS (
    SELECT tipo, array_agg(lvl ORDER BY ord) AS niveles
    FROM cascada_cruda
    WHERE lvl IN ('CHOFER','MOVIL','ZONA','GLOBAL')
    GROUP BY tipo
  ),
  cascada AS (
    SELECT t.tipo,
           array_remove(coalesce(cv.niveles, ARRAY['CHOFER','MOVIL','ZONA','GLOBAL']), 'GLOBAL')
             || ARRAY['GLOBAL'] AS niveles
    FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
    LEFT JOIN cascada_valida cv ON cv.tipo = t.tipo
  ),
  -- ─── Expandir universo x niveles y elegir el primero que alcance
  -- p_min_muestras (GLOBAL, siempre presente al final, es la red final
  -- aunque tampoco llegue al minimo) ─────────────────────────────────
  candidatos AS (
    SELECT u.zona_id, u.tipo, lv.ord, lv.nivel,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.media
             WHEN 'MOVIL'  THEN pzm.media
             WHEN 'ZONA'   THEN pz.media
             ELSE g.media
           END AS media,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.mediana
             WHEN 'MOVIL'  THEN pzm.mediana
             WHEN 'ZONA'   THEN pz.mediana
             ELSE g.mediana
           END AS mediana,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.p75
             WHEN 'MOVIL'  THEN pzm.p75
             WHEN 'ZONA'   THEN pz.p75
             ELSE g.p75
           END AS p75,
           CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.p90
             WHEN 'MOVIL'  THEN pzm.p90
             WHEN 'ZONA'   THEN pz.p90
             ELSE g.p90
           END AS p90,
           coalesce(CASE lv.nivel
             WHEN 'CHOFER' THEN pzc.n
             WHEN 'MOVIL'  THEN pzm.n
             WHEN 'ZONA'   THEN pz.n
             ELSE g.n
           END, 0) AS n
    FROM universo u
    JOIN cascada c ON c.tipo = u.tipo
    CROSS JOIN LATERAL unnest(c.niveles) WITH ORDINALITY AS lv(nivel, ord)
    LEFT JOIN por_zona_chofer pzc ON pzc.zona_id = u.zona_id AND pzc.tipo = u.tipo
    LEFT JOIN por_zona_movil  pzm ON pzm.zona_id = u.zona_id AND pzm.tipo = u.tipo
    LEFT JOIN por_zona        pz  ON pz.zona_id  = u.zona_id AND pz.tipo  = u.tipo
    LEFT JOIN global          g   ON g.tipo      = u.tipo
  ),
  elegido AS (
    -- Gana el de menor ord entre los que llegan al minimo; si ninguno
    -- llega, gana el de mayor ord (GLOBAL, siempre el ultimo).
    SELECT DISTINCT ON (zona_id, tipo)
           zona_id, tipo, nivel, media, mediana, p75, p90, n
    FROM candidatos
    ORDER BY zona_id, tipo,
             (n >= p_min_muestras) DESC,
             CASE WHEN n >= p_min_muestras THEN ord ELSE -ord END ASC
  )
  SELECT zona_id, tipo, media, mediana, p75, p90, nivel, n
  FROM elegido;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date, integer, integer) IS
  'Cascada de cuatro niveles (CHOFER, MOVIL, ZONA, GLOBAL) por (zona, tipo) sobre demora_efectiva_mins de los ultimos p_dias. El orden lo define demoras_config.ritmo_cascada por (escenario, tipo), CSV (default CHOFER,MOVIL,ZONA,GLOBAL); gana el primer nivel que llegue a p_min_muestras, niveles desconocidos se ignoran, lista vacia o mal formada cae al default completo. GLOBAL se evalua siempre ultimo (se saca de donde este y se reagrega una sola vez al final); una lista de solo GLOBAL es valida por si misma, NO dispara el fallback a default. CHOFER y MOVIL se resuelven como promedio ponderado por el aporte de cada movil activo a la zona (mismo prorrateo que demoras_capacidad, replicado aca porque esa funcion no expone el aporte por movil); un chofer que maneja mas de un movil de la zona no duplica sus muestras, y un nivel sin peso real (alpha=0 sobre transito puro) no cuenta esas muestras ni gana con estadisticas NULL. En CHOFER/MOVIL las cuatro columnas son BLENDS PONDERADOS de las estadisticas propias de cada chofer/movil (no percentiles recalculados sobre el pool de valores crudos): acotado entre el minimo y el maximo de lo que combina, pero promediar medianas no es la mediana del pool. ESPECIAL y OTROS se excluyen (no tienen oferta propia en moviles_zonas).';


-- #####################################################################
-- ### 2026-07-29-demoras-cron.sql
-- #####################################################################

-- =====================================================================
-- Cron del motor de demora + retencion
-- Fecha: 2026-07-29 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- El cron dispara cada 10 minutos LAS 24 HORAS a proposito: la ventana
-- 07:00-23:30 la evalua demoras_calcular_run internamente. Ver el header
-- de esa funcion para el motivo (UTC vs Montevideo).
-- =====================================================================
SELECT cron.unschedule('demoras-calcular')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demoras-calcular');
SELECT cron.schedule('demoras-calcular', '*/10 * * * *',
  $cron$ SELECT demoras_calcular_run(); $cron$);

-- Retencion: 180 dias de detalle. ~25.000 filas/dia -> ~4,5M en regimen.
-- Se eligio 180 y no 30 para poder comparar contra el AS400 sobre media
-- temporada, no sobre un mes suelto.
SELECT cron.unschedule('demoras-purga')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demoras-purga');
SELECT cron.schedule('demoras-purga', '43 4 * * *',
  $cron$ DELETE FROM demoras_calculadas WHERE corrida_at < now() - interval '180 days'; $cron$);

-- ─── Verificacion ────────────────────────────────────────────────────
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
-- SELECT count(*), min(corrida_at), max(corrida_at) FROM demoras_calculadas;

-- ─── Diagnostico: que el cron siga corriendo con exito, no solo programado ──
-- Un job en cron.job con active=true puede estar fallando en silencio cada
-- 10 minutos (los cuerpos plpgsql no se validan al crearse, solo al
-- ejecutar). Estas queries son la forma de notarlo:
--
-- SELECT runid, status, start_time, end_time, return_message
--   FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-calcular')
--  ORDER BY start_time DESC LIMIT 20;
--
-- SELECT runid, status, start_time, end_time, return_message
--   FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-purga')
--  ORDER BY start_time DESC LIMIT 10;
--
-- -- La retencion de 180 dias esta funcionando si la fila mas vieja no la supera:
-- SELECT min(corrida_at) AS mas_vieja, now() - min(corrida_at) AS antiguedad
--   FROM demoras_calculadas;

