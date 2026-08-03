-- =====================================================================
-- MOTOR DE DEMORA - TODO EN UNO
-- Fecha: 2026-07-31
--
-- Las 12 migraciones del motor de demora, en el orden exacto de
-- docs/DEMORA_INFORMADA.md seccion 1, para pegar DE UNA SOLA VEZ en el SQL
-- Editor de Supabase.
--
-- POR QUE UN SOLO ARCHIVO. Pegadas de a una, entre migracion y migracion el
-- motor queda a medio migrar y el cron NO para solo: sigue disparando cada 10
-- minutos y escribe corridas hibridas -- por ejemplo el orquestador viejo con
-- la metrica de ritmo nueva, que da ~33% menos sobre el mismo dato. Esas
-- filas quedan con modelo_version NULL y despues no hay forma de
-- distinguirlas de las corridas legitimas del modelo viejo. Con todo junto la
-- ventana baja a segundos, y el paso 0 la cierra del todo.
--
-- QUE HACE, DE PUNTA A PUNTA:
--   Paso 0a  Verifica que pg_cron este habilitado (falla rapido si no).
--   Paso 0b  Apaga el motor.
--   1 a 12   Aplica las 12 migraciones.
--   Paso 9   Vuelve a prender el motor.
--
-- SI FALLA EN EL MEDIO: el SQL Editor hace rollback, asi que no queda nada a
-- medias. Corregi lo que fallo y volve a pegar el archivo entero -- las 12
-- migraciones son idempotentes, repetirlas no duplica ni rompe nada.
--
-- ANTES DE EMPEZAR, guardate esto por las dudas. El archivo 11 da de baja
-- columnas de demoras_config y deja un backup automatico, pero tener la
-- salida a mano no cuesta nada:
--
--   SELECT * FROM demoras_config WHERE escenario_id = 1000;
--
-- DESPUES DE APLICAR: las verificaciones estan al final de este archivo y en
-- docs/DEMORA_INFORMADA.md seccion 2.
--
-- SI SALE MAL EN PRODUCCION, la vuelta atras es UNA linea (seccion 4.1):
--
--   UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
--
-- Eso hace que el orquestador nuevo corra el calculo VIEJO. No requiere
-- deploy, ni tocar el cron, ni revertir ninguna migracion.
-- =====================================================================


-- =====================================================================
-- PASO 0a - PRERREQUISITO: pg_cron
--
-- Se chequea ACA, antes de tocar nada, y no cuando toca programar los jobs:
-- si falta la extension, mejor enterarse en el segundo cero que despues de
-- haber corrido once migraciones.
-- =====================================================================
DO $prereq$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'pg_cron no esta habilitado en este proyecto',
      HINT    = 'Habilitalo en Database -> Extensions -> pg_cron y volve a pegar este archivo entero. No se aplico ningun cambio.';
  END IF;
END
$prereq$;


-- =====================================================================
-- PASO 0b - APAGAR EL MOTOR ANTES DE TOCAR NADA
--
-- El cron sigue disparando cada 10 minutos mientras esto corre. Sin este
-- paso, las corridas que caigan en el medio mezclan piezas viejas con nuevas
-- y ensucian el historico sin dejar rastro de que lo hicieron.
--
-- Si demoras_config todavia no existe (primera instalacion), este UPDATE no
-- hace nada y no molesta: el archivo 3 la crea unas lineas mas abajo.
-- =====================================================================
DO $apagar$
BEGIN
  IF to_regclass('public.demoras_config') IS NOT NULL THEN
    UPDATE demoras_config SET motor_activo = false WHERE escenario_id = 1000;
  END IF;
END
$apagar$;


-- =====================================================================
-- ARCHIVO 1 de 12: 2026-07-29-demoras-acabado.sql
-- demoras_acabado: clamp -> suavizado -> redondeo. Sin cambios.
-- =====================================================================

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


-- =====================================================================
-- ARCHIVO 2 de 12: 2026-07-29-demoras-capacidad.sql
-- demoras_capacidad: capacidad prorrateada. La usa el modelo VIEJO y los conteos de moviles. Sin cambios.
-- =====================================================================

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


-- =====================================================================
-- ARCHIVO 3 de 12: 2026-07-29-demoras-calculadas-tabla.sql
-- demoras_calculadas (hechos) + demoras_config (config OPERATIVA).
-- =====================================================================

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

-- Los dos COMMENT de abajo son CONDICIONALES a proposito.
--
-- 2026-07-31-demoras-calcular-run-v2.sql da de baja factor_calibracion y
-- ritmo_default_minutos de demoras_config (se mudaron a demoras_modelo). Como
-- COMMENT ON COLUMN no tiene forma IF EXISTS, dejarlos sueltos rompia la
-- idempotencia de este archivo: re-pegarlo DESPUES de esa migracion abortaba
-- con `column "factor_calibracion" of relation "demoras_config" does not
-- exist` y hacia rollback de todo.
--
-- No es un detalle teorico: la instruccion de recuperacion de
-- 2026-07-31-MOTOR-DEMORA-TODO.sql es justamente "volve a pegar el archivo
-- entero", y este archivo va adentro. O sea que el camino de recuperacion no
-- funcionaba. Con la guarda, re-aplicar es inocuo en cualquier orden.
DO $comentarios$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'demoras_config' AND column_name = 'factor_calibracion') THEN
    EXECUTE $q$COMMENT ON COLUMN demoras_config.factor_calibracion IS
      'Multiplicador global del resultado crudo. Existe por el riesgo R1: demora_efectiva_mins ya incluye la espera en cola, asi que multiplicarla por los pendientes puede doble-contar. Permite corregir el nivel sin tocar codigo.'$q$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'demoras_config' AND column_name = 'ritmo_default_minutos') THEN
    EXECUTE $q$COMMENT ON COLUMN demoras_config.ritmo_default_minutos IS
      'Piso del ritmo cuando no hay ninguna estadistica disponible (ni zona ni global): antes era un 30 hardcodeado en el orquestador que no quedaba registrado en la fila calculada. Ahora es un parametro del modelo, editable desde Preferencias Globales, y el valor efectivamente usado se persiste en demoras_calculadas.ritmo_usado (auditable).'$q$;
  END IF;
END
$comentarios$;

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


-- =====================================================================
-- ARCHIVO 4 de 12: 2026-07-31-demoras-modelo-tabla.sql
-- demoras_modelo (parametros del CALCULO) + historial versionado + modelo_version.
-- =====================================================================

-- =====================================================================
-- demoras_modelo — TODOS los parametros del calculo de demora
-- Fecha: 2026-07-31 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Una fila POR ESCENARIO. El calculo es global a proposito: mientras
-- estemos buscando la formula correcta no tiene sentido que URGENTE mida
-- el ritmo de una manera y SERVICE de otra. Lo OPERATIVO (motor_activo,
-- hora_inicio, hora_fin) se queda en demoras_config, por tipo, porque
-- NOCTURNO si tiene su propia ventana horaria (18:00-23:30).
--
-- Las columnas de calculo que hoy viven en demoras_config se copian aca
-- y se BORRAN de alla en la migracion final de esta tanda
-- (2026-07-31-demoras-calcular-run-v2.sql). No se borran aca: el motor
-- que esta corriendo las sigue leyendo, y dejarlo sin columnas entre una
-- migracion y la siguiente lo tumba en silencio cada 10 minutos.
-- =====================================================================
CREATE TABLE IF NOT EXISTS demoras_modelo (
  escenario_id integer PRIMARY KEY,
  version      integer NOT NULL DEFAULT 1,

  -- ── Lo que se informa ──────────────────────────────────────────────
  min_minutos            integer NOT NULL DEFAULT 30  CHECK (min_minutos     >= 0),
  max_minutos            integer NOT NULL DEFAULT 120 CHECK (max_minutos     >= 0),
  escalon_minutos        integer NOT NULL DEFAULT 15  CHECK (escalon_minutos >  0),
  -- false = la demora llega hasta que el movil SALE, no hasta la entrega.
  incluir_entrega_propia boolean NOT NULL DEFAULT true,

  -- ── Estabilidad entre corridas ─────────────────────────────────────
  subida_max integer NOT NULL DEFAULT 30 CHECK (subida_max >= 0),
  bajada_max integer NOT NULL DEFAULT 15 CHECK (bajada_max >= 0),
  -- Cuando cambia la cantidad de moviles activos de la zona, la baja es
  -- REAL (entro un refuerzo), no ruido: con esto en true el suavizado no
  -- la frena. Ver DEMORA_MODELO.md 8.4.
  suavizado_bypass_cambio_capacidad boolean NOT NULL DEFAULT false,

  -- ── El ritmo ───────────────────────────────────────────────────────
  -- ENTRE_ENTREGAS: minutos entre un cumplimiento y el siguiente del mismo
  --   movil. Es el ritmo de trabajo real.
  -- ASIGNADO_A_ENTREGA: la metrica vieja (demora_efectiva_mins), que YA
  --   incluye la espera en cola. Se conserva para poder correr el modelo
  --   viejo y compararlo, no porque sea correcta.
  ritmo_metrica           text    NOT NULL DEFAULT 'ENTRE_ENTREGAS'
                                  CHECK (ritmo_metrica IN ('ENTRE_ENTREGAS','ASIGNADO_A_ENTREGA')),
  estadistico             text    NOT NULL DEFAULT 'MEDIANA'
                                  CHECK (estadistico IN ('MEDIA','MEDIANA','P75','P90')),
  ritmo_cascada           text    NOT NULL DEFAULT 'CHOFER,MOVIL,ZONA,GLOBAL',
  ritmo_dias_ventana      integer NOT NULL DEFAULT 7  CHECK (ritmo_dias_ventana  > 0),
  ritmo_min_muestras      integer NOT NULL DEFAULT 5  CHECK (ritmo_min_muestras  > 0),
  -- Corte de huecos: un intervalo mas largo que esto es almuerzo, recarga o
  -- inactividad, no ritmo de trabajo. Ver DEMORA_MODELO.md 8.5.
  ritmo_hueco_max_minutos integer NOT NULL DEFAULT 90 CHECK (ritmo_hueco_max_minutos > 0),
  -- Contar solo los intervalos en que el movil YA tenia el proximo pedido
  -- asignado cuando termino el anterior (o sea, tenia cola). Si no la
  -- tenia, ese tiempo es ocio.
  ritmo_solo_con_cola     boolean NOT NULL DEFAULT false,
  ritmo_default_minutos   integer NOT NULL DEFAULT 30 CHECK (ritmo_default_minutos > 0),

  -- ── Quien atiende el pedido ────────────────────────────────────────
  modelo                   text    NOT NULL DEFAULT 'PROXIMO_HUECO'
                                   CHECK (modelo IN ('PROXIMO_HUECO','CAPACIDAD_PROMEDIO')),
  -- IGUAL          : el transito compite como si fuera prioridad.
  -- CASTIGO        : se le suman transito_castigo_minutos al libre_en.
  -- SOLO_SI_NO_HAY : entra solo si ninguna prioridad se libera dentro de
  --                  transito_margen_minutos del mejor transito.
  -- ALPHA          : su libre_en se estira dividiendo por peso_transito_alpha.
  transito_modo            text    NOT NULL DEFAULT 'SOLO_SI_NO_HAY'
                                   CHECK (transito_modo IN ('IGUAL','CASTIGO','SOLO_SI_NO_HAY','ALPHA')),
  transito_castigo_minutos integer NOT NULL DEFAULT 20 CHECK (transito_castigo_minutos >= 0),
  transito_margen_minutos  integer NOT NULL DEFAULT 15 CHECK (transito_margen_minutos  >= 0),

  -- ── La cola ────────────────────────────────────────────────────────
  vecinas_modo       text    NOT NULL DEFAULT 'IGNORAR'
                             CHECK (vecinas_modo IN ('IGNORAR','TODOS','PONDERADO')),
  -- Pedidos asignados a un movil que hoy NO salio. EXCLUIR: no suman a la
  -- cola, porque nadie los va a entregar con esa asignacion.
  atrapados_modo     text    NOT NULL DEFAULT 'EXCLUIR'
                             CHECK (atrapados_modo IN ('EXCLUIR','COMO_SIN_ASIGNAR','EN_COLA')),
  factor_calibracion numeric NOT NULL DEFAULT 1.0 CHECK (factor_calibracion > 0),

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,

  CONSTRAINT demoras_modelo_rango CHECK (max_minutos >= min_minutos)
);

COMMENT ON TABLE demoras_modelo IS
  'Todos los parametros del CALCULO de demora, una fila por escenario. Lo operativo (motor_activo, ventana horaria) vive en demoras_config, por tipo. Cada UPDATE que cambia algo bumpea version y deja la fila anterior en demoras_modelo_historial; demoras_calculadas.modelo_version apunta a la version que produjo cada corrida.';
COMMENT ON COLUMN demoras_modelo.modelo IS
  'PROXIMO_HUECO = simulacion de cola sobre tiempos de liberacion por movil. CAPACIDAD_PROMEDIO = el modelo viejo (pendientes/capacidad*ritmo), conservado para poder comparar los dos sobre los mismos datos.';
COMMENT ON COLUMN demoras_modelo.ritmo_metrica IS
  'ENTRE_ENTREGAS = minutos entre cumplimientos consecutivos del mismo movil (ritmo de trabajo real). ASIGNADO_A_ENTREGA = demora_efectiva_mins, que ya incluye la espera en cola y por eso doble-cuenta al multiplicarse por los pendientes (riesgo R1).';
COMMENT ON COLUMN demoras_modelo.vecinas_modo IS
  'TODAVIA NO IMPLEMENTADO: hoy el calculo se comporta siempre como IGNORAR y poner TODOS o PONDERADO no cambia nada. La columna existe para no migrar la tabla de nuevo cuando se implemente. Que hara: los pedidos sin asignar de OTRAS zonas que comparten moviles con esta tambien compiten por ellos, y hoy el calculo de esta zona los ignora (optimista). El diseno recomienda empezar ignorandolos y medir cuanto se pierde antes de pagar la complejidad; esa medicion es el backtest.';
COMMENT ON COLUMN demoras_modelo.ritmo_cascada IS
  'NO ESTA EN USO: quien manda hoy es demoras_config.ritmo_cascada, leida POR TIPO de servicio tanto por demoras_ritmo (docs/sqls/2026-07-31-demoras-ritmo-v2.sql) como por demoras_ritmo_movil (docs/sqls/2026-07-31-demoras-ritmo-movil.sql) -- las dos cascadas, la de zona y la de movil, comparten la misma fuente para que un UPDATE sobre demoras_config.ritmo_cascada cambie el ritmo que se manda en los dos lugares a la vez. Esta columna existe para el dia que se decida que la cascada pasa a ser global por escenario en vez de por tipo, pero ese cambio no se hizo: hay configuraciones validas donde URGENTE y SERVICE corren cascadas distintas al mismo tiempo, y una sola fila por escenario ACA no puede representar eso sin antes cambiar demoras_ritmo y demoras_ritmo_movil para que dejen de leer por tipo. Migrar la baja de demoras_config.ritmo_cascada sin ese cambio previo rompe las dos funciones en runtime (verificado con el harness): esta columna se queda sin efecto a proposito, no por descuido.';

-- ─── Historial ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demoras_modelo_historial (
  historial_id bigserial PRIMARY KEY,
  escenario_id integer     NOT NULL,
  version      integer     NOT NULL,
  cambiado_at  timestamptz NOT NULL DEFAULT now(),
  cambiado_por text,
  -- Snapshot COMPLETO de la fila anterior. jsonb y no columnas espejo: si
  -- manana se agrega un parametro, el historial lo captura sin migracion.
  fila         jsonb       NOT NULL,
  CONSTRAINT demoras_modelo_historial_uk UNIQUE (escenario_id, version)
);

COMMENT ON TABLE demoras_modelo_historial IS
  'Una fila por cada edicion de demoras_modelo, con el estado ANTERIOR completo. Sin esto, cambiar un parametro un martes vuelve incomparables las corridas del lunes y del miercoles sin que nadie pueda notarlo.';

-- ─── Trigger de versionado ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION demoras_modelo_versionar()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Un UPDATE que no cambia ningun parametro NO versiona: abrir la pantalla
  -- y guardar sin editar no debe inflar el historial ni invalidar la
  -- comparabilidad de las corridas. Se ignoran las tres columnas de
  -- bookkeeping, que cambian siempre.
  IF (to_jsonb(OLD) - 'version' - 'updated_at' - 'updated_by')
   = (to_jsonb(NEW) - 'version' - 'updated_at' - 'updated_by') THEN
    RETURN NEW;
  END IF;

  INSERT INTO demoras_modelo_historial (escenario_id, version, cambiado_por, fila)
  VALUES (OLD.escenario_id, OLD.version, NEW.updated_by, to_jsonb(OLD))
  ON CONFLICT (escenario_id, version) DO NOTHING;

  NEW.version    := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_demoras_modelo_versionar ON demoras_modelo;
CREATE TRIGGER trg_demoras_modelo_versionar
  BEFORE UPDATE ON demoras_modelo
  FOR EACH ROW EXECUTE FUNCTION demoras_modelo_versionar();

-- ─── Seed ────────────────────────────────────────────────────────────
-- Si demoras_config todavia tiene las columnas de calculo (o sea, esta
-- migracion corre por primera vez), los valores vigentes se heredan de la
-- fila URGENTE para no resetear una calibracion en curso. Si ya se borraron
-- (re-aplicacion despues de la Task 7), se siembra con los defaults.
-- Dinamico y guardado por information_schema: sin esto, re-pegar el archivo
-- despues de la baja de columnas falla con "column does not exist".
DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'demoras_config' AND column_name = 'estadistico') THEN
    EXECUTE $q$
      INSERT INTO demoras_modelo (
        escenario_id, min_minutos, max_minutos, escalon_minutos,
        subida_max, bajada_max, estadistico, ritmo_cascada,
        ritmo_default_minutos, factor_calibracion)
      SELECT dc.escenario_id, dc.min_minutos, dc.max_minutos, dc.escalon_minutos,
             dc.subida_max, dc.bajada_max, dc.estadistico, dc.ritmo_cascada,
             dc.ritmo_default_minutos, dc.factor_calibracion
        FROM demoras_config dc
       WHERE dc.tipo_servicio = 'URGENTE'
      ON CONFLICT (escenario_id) DO NOTHING
    $q$;
  END IF;

  -- Red final: el escenario 1000 tiene fila si o si, aunque demoras_config
  -- estuviera vacia.
  INSERT INTO demoras_modelo (escenario_id) VALUES (1000)
  ON CONFLICT (escenario_id) DO NOTHING;
END
$mig$;

-- ─── Sello de version en los hechos ──────────────────────────────────
ALTER TABLE demoras_calculadas
  ADD COLUMN IF NOT EXISTS modelo_version integer;
COMMENT ON COLUMN demoras_calculadas.modelo_version IS
  'Version de demoras_modelo que produjo esta fila. Con esto una corrida de hace seis semanas se reconstruye entera (la fila vive en demoras_modelo si version coincide, o en demoras_modelo_historial si no).';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- demoras_modelo decide QUE calcula el motor. La anon key vive en el bundle
-- del browser: sin REVOKE explicito, si los default privileges del proyecto
-- alcanzan a anon, cualquiera puede cambiar la formula.
REVOKE ALL ON TABLE demoras_modelo           FROM PUBLIC;
REVOKE ALL ON TABLE demoras_modelo           FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_modelo           TO service_role;

REVOKE ALL ON TABLE demoras_modelo_historial FROM PUBLIC;
REVOKE ALL ON TABLE demoras_modelo_historial FROM anon, authenticated;
GRANT  ALL ON TABLE demoras_modelo_historial TO service_role;

REVOKE ALL ON SEQUENCE demoras_modelo_historial_historial_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE demoras_modelo_historial_historial_id_seq FROM anon, authenticated;
GRANT  ALL ON SEQUENCE demoras_modelo_historial_historial_id_seq TO service_role;


-- =====================================================================
-- ARCHIVO 5 de 12: 2026-07-31-demoras-ritmo-muestras.sql
-- demoras_ritmo_muestras: que muestras alimentan el ritmo, con corte de huecos.
-- =====================================================================

-- =====================================================================
-- demoras_ritmo_muestras — las muestras crudas del ritmo
-- Fecha: 2026-07-31 | Idempotente
--
-- Devuelve UNA FILA POR MUESTRA, sin agregar. demoras_ritmo la usa como su
-- CTE `base` y arma arriba la cascada CHOFER -> MOVIL -> ZONA -> GLOBAL.
--
-- Dos metricas, elegibles por demoras_modelo.ritmo_metrica:
--
--   ENTRE_ENTREGAS (la buena): minutos entre un cumplimiento y el
--     siguiente del MISMO movil, dentro del MISMO dia. Es cada cuanto
--     entrega, o sea el ritmo de trabajo. Es la metrica que el modelo del
--     proximo hueco necesita para calcular cuando se libera un movil.
--
--   ASIGNADO_A_ENTREGA (la vieja): demora_efectiva_mins, o sea
--     entrega - asignacion. NO es ritmo: ya incluye la espera detras de los
--     otros pedidos que el movil tenia arriba. Multiplicarla por la
--     cantidad de pendientes cuenta la cola dos veces (riesgo R1). Se
--     conserva UNICAMENTE para poder correr el modelo viejo sobre los
--     mismos datos y medir la diferencia.
--
-- La particion incluye la fecha LOCAL: el salto entre la ultima entrega de
-- un dia y la primera del siguiente no es un intervalo de trabajo, son 10
-- horas de noche. Sin eso, cada movil aportaria una muestra basura por dia.
--
-- p_hueco_max descarta los intervalos largos (almuerzo, recarga, un rato
-- sin pedidos). p_solo_con_cola es mas fino: cuenta el intervalo solo si el
-- pedido que se entrego YA estaba asignado cuando termino el anterior; si
-- se asigno despues, el movil estuvo esperando y ese tiempo es ocio, no
-- ritmo. Con la bandera prendida se excluyen tambien los hechos sin
-- fch_hora_asignado (asignado_source='DERIVADO'): sin ese dato no se puede
-- afirmar que hubiera cola, y para una metrica de ritmo es preferible
-- perder la muestra que inventarla.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo_muestras(
  p_escenario     integer,
  p_hasta         date,
  p_dias          integer,
  p_metrica       text,
  p_hueco_max     integer,
  p_solo_con_cola boolean
)
RETURNS TABLE (
  zona_nro integer,
  tipo     text,
  movil    integer,
  chofer   text,
  v        numeric
)
LANGUAGE sql
STABLE
AS $fn$
  WITH hechos AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.movil,
           m.chofer,
           m.fch_hora_finalizacion,
           m.fch_hora_asignado,
           m.demora_efectiva_mins
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS no tienen oferta propia en moviles_zonas: no son
      -- parte de ninguna cola del motor.
      AND m.tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  intervalos AS (
    SELECT h.zona_nro, h.tipo, h.movil, h.chofer, h.fch_hora_asignado,
           lag(h.fch_hora_finalizacion) OVER w AS prev_fin,
           EXTRACT(EPOCH FROM (
             h.fch_hora_finalizacion - lag(h.fch_hora_finalizacion) OVER w
           )) / 60.0 AS mins
    FROM hechos h
    WHERE h.movil IS NOT NULL
    WINDOW w AS (
      PARTITION BY h.movil, h.tipo,
                   (h.fch_hora_finalizacion AT TIME ZONE 'America/Montevideo')::date
      ORDER BY h.fch_hora_finalizacion
    )
  )
  SELECT i.zona_nro, i.tipo, i.movil, i.chofer, round(i.mins::numeric, 2)
    FROM intervalos i
   WHERE p_metrica = 'ENTRE_ENTREGAS'
     AND i.mins IS NOT NULL
     AND i.mins > 0
     AND i.mins <= p_hueco_max
     AND (
       NOT p_solo_con_cola
       OR (i.fch_hora_asignado IS NOT NULL AND i.fch_hora_asignado <= i.prev_fin)
     )
  UNION ALL
  SELECT h.zona_nro, h.tipo, h.movil, h.chofer, h.demora_efectiva_mins
    FROM hechos h
   WHERE p_metrica = 'ASIGNADO_A_ENTREGA';
$fn$;

COMMENT ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, boolean) IS
  'Muestras crudas del ritmo, una fila por muestra. ENTRE_ENTREGAS = minutos entre cumplimientos consecutivos del mismo movil dentro del mismo dia local (el ritmo de trabajo real); ASIGNADO_A_ENTREGA = demora_efectiva_mins, que ya incluye la espera en cola y se conserva solo para poder comparar contra el modelo viejo. p_hueco_max corta almuerzos y ratos sin pedidos; p_solo_con_cola exige que el pedido ya estuviera asignado al terminar el anterior (y descarta los hechos sin fch_hora_asignado, donde eso no se puede afirmar).';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto:
-- sin este REVOKE, anon/authenticated (las claves que viajan al browser)
-- pueden invocarla via RPC. Mismo patron que
-- docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, boolean) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_ritmo_muestras(integer, date, integer, text, integer, boolean) TO service_role;


-- =====================================================================
-- ARCHIVO 6 de 12: 2026-07-31-demoras-ritmo-v2.sql
-- demoras_ritmo: cascada por ZONA, leyendo parametros de la config.
-- =====================================================================

-- =====================================================================
-- demoras_ritmo v2 — los parametros salen de demoras_modelo
-- Fecha: 2026-07-31 | Idempotente
--
-- Mismo algoritmo que 2026-07-30-demoras-ritmo-cascada.sql (cascada
-- CHOFER -> MOVIL -> ZONA -> GLOBAL, blend ponderado en CHOFER/MOVIL,
-- GLOBAL siempre ultimo como red final). Cambian tres cosas:
--
--   1. La firma pierde p_dias y p_min_muestras: ahora salen de
--      demoras_modelo (ritmo_dias_ventana, ritmo_min_muestras), para que
--      se puedan cambiar sin tocar a los llamadores.
--   2. La CTE `base` ya no lee metricas_cumplimiento directo: llama a
--      demoras_ritmo_muestras, que resuelve cual de las dos metricas usar
--      (ENTRE_ENTREGAS / ASIGNADO_A_ENTREGA) y aplica el corte de huecos.
--   3. Todo el resto es identico.
--
-- HAY QUE DROPEAR la version vieja: tenia 4 parametros con default, asi que
-- una llamada de 2 argumentos matchea las DOS firmas y Postgres aborta con
-- "function demoras_ritmo(integer, date) is not unique" en tiempo de
-- ejecucion. CREATE OR REPLACE no alcanza porque la firma cambio.
-- =====================================================================
DROP FUNCTION IF EXISTS demoras_ritmo(integer, date, integer, integer);

CREATE OR REPLACE FUNCTION demoras_ritmo(p_escenario integer, p_hasta date)
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
  WITH cfg AS (
    -- Defaults defensivos: si falta la fila del escenario, la funcion tiene
    -- que seguir devolviendo algo razonable en vez de colapsar a cero filas.
    SELECT coalesce(dm.ritmo_dias_ventana, 7)          AS dias,
           coalesce(dm.ritmo_min_muestras, 5)          AS min_muestras,
           coalesce(dm.ritmo_metrica, 'ENTRE_ENTREGAS') AS metrica,
           coalesce(dm.ritmo_hueco_max_minutos, 90)    AS hueco_max,
           coalesce(dm.ritmo_solo_con_cola, false)     AS solo_con_cola
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  universo AS (
    SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
    FROM moviles_zonas mz
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  base AS (
    SELECT m.zona_nro, m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.solo_con_cola
         ) m
  ),
  -- ↓↓↓ COPIADO TEXTUAL desde `por_zona AS (` hasta el cierre de
  --     `elegido AS (...)` de docs/sqls/2026-07-30-demoras-ritmo-cascada.sql
  --     (lineas 121-363). Unico cambio: en `elegido`, las dos apariciones
  --     de `p_min_muestras` en el ORDER BY pasan a
  --     `(SELECT min_muestras FROM cfg)`. El resto, comentarios incluidos,
  --     es identico al original.
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
             (n >= (SELECT min_muestras FROM cfg)) DESC,
             CASE WHEN n >= (SELECT min_muestras FROM cfg) THEN ord ELSE -ord END ASC
  )
  SELECT zona_id, tipo, media, mediana, p75, p90, nivel, n
  FROM elegido;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date) IS
  'Cascada de cuatro niveles (CHOFER, MOVIL, ZONA, GLOBAL) por (zona, tipo). Los parametros (ventana en dias, minimo de muestras, metrica, corte de huecos) salen de demoras_modelo, no de la firma, para poder cambiarlos sin tocar a los llamadores. Las muestras vienen de demoras_ritmo_muestras, que resuelve si el ritmo se mide entre cumplimientos consecutivos (ENTRE_ENTREGAS, lo correcto) o de asignacion a entrega (ASIGNADO_A_ENTREGA, la metrica vieja que doble-cuenta la cola). El resto del algoritmo es identico a la version del 2026-07-30: blend ponderado en CHOFER/MOVIL, chofer que maneja varios moviles no duplica muestras, nivel sin peso real no gana la cascada, GLOBAL siempre ultimo.';


-- =====================================================================
-- ARCHIVO 7 de 12: 2026-07-31-demoras-cola.sql
-- demoras_cola: demanda pendiente por (zona, tipo), con atrapados_modo.
-- =====================================================================

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

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto:
-- sin este REVOKE, anon/authenticated (las claves que viajan al browser)
-- pueden invocarla via RPC. Mismo patron que
-- docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_cola(integer, date, timestamptz) TO service_role;


-- =====================================================================
-- ARCHIVO 8 de 12: 2026-07-31-demoras-ritmo-movil.sql
-- demoras_ritmo_movil: ritmo PROPIO de cada movil (cascada CHOFER -> MOVIL).
-- =====================================================================

-- =====================================================================
-- demoras_ritmo_movil — el ritmo PROPIO de cada movil
-- Fecha: 2026-07-31 | Idempotente
--
-- demoras_ritmo devuelve un ritmo por (zona, tipo): sus niveles CHOFER y
-- MOVIL vienen ya mezclados en un promedio ponderado por el aporte de cada
-- movil a la zona. Eso alcanza para el modelo viejo, que multiplica un solo
-- ritmo por la cola de la zona.
--
-- El modelo del proximo hueco necesita otra cosa: cuanto tarda CADA movil,
-- porque libre_en = carga x ritmo y el pedido nuevo va al que se libera
-- primero. Con un ritmo compartido, dos moviles solo se diferencian por
-- cuantos pedidos llevan -- y se pierde justo lo que hace al modelo.
--
-- Cascada de dos niveles, en el orden configurado en
-- demoras_config.ritmo_cascada -- POR TIPO, la MISMA columna y la MISMA
-- fuente que usa demoras_ritmo (docs/sqls/2026-07-31-demoras-ritmo-v2.sql).
-- Un UPDATE sobre demoras_config.ritmo_cascada cambia el reparto de los
-- dos lugares a la vez: es lo que hace que "saltear CHOFER"
-- (DEMORA_INFORMADA.md #5) tenga el mismo efecto sobre el ritmo de zona y
-- sobre el ritmo propio del movil. demoras_modelo.ritmo_cascada NO
-- alimenta esta cascada (ver su COMMENT ON COLUMN: no se lee en ningun
-- lado). Se leen solo las entradas CHOFER y MOVIL de la lista (ZONA y
-- GLOBAL no aplican a un movil suelto y las resuelve el llamador cayendo
-- a demoras_ritmo):
--
--   CHOFER  el historial propio del chofer que mas veces manejo ese movil
--           en la ventana. Un chofer rapido lo es en cualquier camion.
--   MOVIL   el historial del movil en si.
--
-- Un movil sin muestras suficientes en ningun nivel NO devuelve fila: el
-- llamador (demoras_servidores) cae al ritmo de la zona, y si tampoco hay,
-- al piso configurado. Devolver una fila con las cuatro estadisticas en
-- NULL obligaria a cada consumidor a distinguir "no hay dato" de "hay dato
-- nulo", que es exactamente el tipo de ambiguedad que ya rompio este motor.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_ritmo_movil(p_escenario integer, p_hasta date)
RETURNS TABLE (
  movil          integer,
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
  WITH cfg AS (
    -- Subconsulta escalar y no FROM: si falta la fila del escenario, un FROM
    -- deja este CTE vacio y los CROSS JOIN de abajo colapsan la funcion a
    -- cero filas. Mismo patron defensivo que demoras_cola y demoras_ritmo v2.
    SELECT coalesce((SELECT dm.ritmo_dias_ventana      FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 7)                AS dias,
           coalesce((SELECT dm.ritmo_min_muestras      FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 5)                AS min_muestras,
           coalesce((SELECT dm.ritmo_metrica           FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 'ENTRE_ENTREGAS') AS metrica,
           coalesce((SELECT dm.ritmo_hueco_max_minutos FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 90)               AS hueco_max,
           coalesce((SELECT dm.ritmo_solo_con_cola     FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), false)            AS solo_con_cola
  ),
  base AS (
    SELECT m.tipo, m.movil, m.chofer, m.v
    FROM cfg c,
         LATERAL demoras_ritmo_muestras(
           p_escenario, p_hasta, c.dias, c.metrica, c.hueco_max, c.solo_con_cola
         ) m
    WHERE m.movil IS NOT NULL
  ),
  -- Estadisticas propias del movil.
  por_movil AS (
    SELECT b.movil, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b
    GROUP BY b.movil, b.tipo
  ),
  -- El chofer que mas veces manejo cada movil en la ventana. Empate:
  -- alfabetico, para que el resultado sea reproducible.
  chofer_top AS (
    SELECT DISTINCT ON (movil, tipo) movil, tipo, chofer
    FROM (
      SELECT b.movil, b.tipo, b.chofer, count(*) AS n
      FROM base b WHERE b.chofer IS NOT NULL
      GROUP BY b.movil, b.tipo, b.chofer
    ) c
    ORDER BY movil, tipo, n DESC, chofer
  ),
  -- Estadisticas propias del chofer, sin importar que movil manejo.
  por_chofer AS (
    SELECT b.chofer, b.tipo,
           round(avg(b.v), 2) AS media,
           round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS mediana,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p75,
           round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.v)::numeric, 2) AS p90,
           count(*)::integer AS n
    FROM base b WHERE b.chofer IS NOT NULL
    GROUP BY b.chofer, b.tipo
  ),
  -- Cascada por TIPO, leida de demoras_config.ritmo_cascada -- la MISMA
  -- fuente que demoras_ritmo (ver el header de este archivo). Se filtra a
  -- CHOFER/MOVIL (los unicos niveles que aplican a un movil suelto); si
  -- para ese tipo no queda ninguno valido (falta la fila, lista vacia o
  -- basura), cae al default CHOFER,MOVIL.
  cascada_cruda AS (
    SELECT dc.tipo_servicio AS tipo, trim(u.lvl) AS lvl, u.ord
    FROM demoras_config dc,
         LATERAL unnest(string_to_array(upper(coalesce(dc.ritmo_cascada,'')), ',')) WITH ORDINALITY AS u(lvl, ord)
    WHERE dc.escenario_id = p_escenario
  ),
  niveles AS (
    SELECT t.tipo,
           coalesce(
             nullif(array_agg(cc.lvl ORDER BY cc.ord) FILTER (WHERE cc.lvl IN ('CHOFER','MOVIL')), '{}'),
             ARRAY['CHOFER','MOVIL']) AS lista
    FROM (SELECT unnest(ARRAY['URGENTE','NOCTURNO','SERVICE']) AS tipo) t
    LEFT JOIN cascada_cruda cc ON cc.tipo = t.tipo
    GROUP BY t.tipo
  ),
  candidatos AS (
    SELECT pm.movil, pm.tipo, lv.ord, lv.nivel,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.media   ELSE pm.media   END AS media,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.mediana ELSE pm.mediana END AS mediana,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p75     ELSE pm.p75     END AS p75,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p90     ELSE pm.p90     END AS p90,
           coalesce(CASE lv.nivel WHEN 'CHOFER' THEN pc.n ELSE pm.n END, 0) AS n
    FROM por_movil pm
    JOIN niveles nv ON nv.tipo = pm.tipo
    CROSS JOIN LATERAL unnest(nv.lista) WITH ORDINALITY AS lv(nivel, ord)
    LEFT JOIN chofer_top ct ON ct.movil = pm.movil AND ct.tipo = pm.tipo
    LEFT JOIN por_chofer pc ON pc.chofer = ct.chofer AND pc.tipo = pm.tipo
  )
  -- Gana el primer nivel que llegue al minimo. Si NINGUNO llega, el movil no
  -- devuelve fila y el llamador cae al ritmo de la zona.
  SELECT DISTINCT ON (movil, tipo)
         movil, tipo, media, mediana, p75, p90, nivel, n
  FROM candidatos c, cfg
  WHERE c.n >= cfg.min_muestras
  ORDER BY movil, tipo, ord;
$fn$;

COMMENT ON FUNCTION demoras_ritmo_movil(integer, date) IS
  'Ritmo propio de cada movil por tipo de servicio, con cascada CHOFER -> MOVIL en el orden configurado en demoras_config.ritmo_cascada (por tipo -- la misma columna y fuente que demoras_ritmo; demoras_modelo.ritmo_cascada no alimenta nada, ver su COMMENT ON COLUMN). Existe porque demoras_ritmo devuelve un ritmo por ZONA (los niveles CHOFER y MOVIL ya vienen mezclados en un promedio ponderado), y el modelo del proximo hueco necesita cuanto tarda CADA movil: libre_en = carga x ritmo, y el pedido nuevo va al que se libera primero. Un movil sin muestras suficientes en ningun nivel NO devuelve fila, para que el llamador pueda distinguir "no hay dato" de "hay dato nulo" y caer al ritmo de la zona.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto
-- (a diferencia de las tablas): sin este REVOKE, anon/authenticated -las
-- claves que viajan al browser- pueden invocar esta funcion via RPC.
-- Mismo patron que las tablas de docs/sqls/2026-07-31-demoras-modelo-tabla.sql
-- y que docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_ritmo_movil(integer, date) TO service_role;


-- =====================================================================
-- ARCHIVO 9 de 12: 2026-07-31-demoras-servidores.sql
-- demoras_servidores: a que hora queda libre cada movil, con transito_modo.
-- =====================================================================

-- =====================================================================
-- demoras_servidores — a que hora queda libre cada movil de la zona
-- Fecha: 2026-07-31 | Idempotente
--
-- El corazon del modelo del proximo hueco:
--
--   libre_en(movil) = (pedidos pendientes que tiene asignados) x (su ritmo)
--
-- La carga se cuenta en TODAS las zonas, no solo en esta. El movil es un
-- solo camion: si tiene trabajo en otro lado, ese trabajo tambien lo ocupa.
-- Aca muere el doble castigo del prorrateo: no hay que repartir al movil
-- entre sus zonas con una suposicion, porque los pedidos ya asignados
-- dicen exactamente donde esta su trabajo.
--
-- APROXIMACION DOCUMENTADA: un movil que lleva pedidos de mas de un tipo
-- (2 URGENTE + 1 SERVICE) se resuelve con el ritmo del tipo que se esta
-- calculando, no con uno distinto por pedido. Contar el ritmo real de cada
-- pedido segun su tipo es posible y queda anotado como mejora; hoy se
-- prefiere que la funcion sea legible y auditable.
--
-- transito_modo decide que hacer con un movil que en esta zona es de
-- transito, o sea que pasa por ahi pero no es su zona (DEMORA_MODELO.md 8.1):
--   IGUAL          compite como si fuera prioridad. Optimista: promete un
--                  movil que quiza no va.
--   CASTIGO        se le suman transito_castigo_minutos de desvio.
--   ALPHA          se le estira el libre_en dividiendo por peso_transito_alpha
--                  (0.3 -> tarda 3,3 veces mas en "estar disponible" para esta
--                  zona). Reusa el parametro que ya existe, pero ojo: alpha se
--                  diseno para repartir capacidad, no para estirar tiempos.
--   SOLO_SI_NO_HAY entra solo si ninguna prioridad de la zona se libera
--                  dentro de transito_margen_minutos del mejor transito.
--                  Es lo mas parecido a como trabaja la operacion.
--
-- Un movil descartado se DEVUELVE igual, con descartado=true, en vez de
-- filtrarse: quien audite una zona tiene que poder ver que habia un
-- transito disponible y por que no se uso.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_servidores(
  p_escenario integer,
  p_fecha     date
)
RETURNS TABLE (
  zona_id       integer,
  tipo_servicio text,
  movil         integer,
  carga         integer,
  ritmo         numeric,
  ritmo_origen  text,
  libre_en      numeric,
  es_transito   boolean,
  descartado    boolean
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    SELECT coalesce(dm.transito_modo, 'SOLO_SI_NO_HAY')       AS modo,
           coalesce(dm.transito_castigo_minutos, 20)::numeric AS castigo,
           coalesce(dm.transito_margen_minutos, 15)::numeric  AS margen,
           coalesce(dm.estadistico, 'MEDIANA')                AS estadistico,
           coalesce(dm.ritmo_default_minutos, 30)::numeric    AS ritmo_defecto
      FROM (SELECT p_escenario AS e) x
      LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e
  ),
  alpha AS (
    SELECT coalesce((SELECT es.peso_transito_alpha FROM escenario_settings es
                      WHERE es.escenario_id = p_escenario), 0.3)::numeric AS a
  ),
  -- Moviles ACTIVOS con asignacion vigente a cada (zona, tipo).
  asign AS (
    SELECT mz.zona_id,
           mz.tipo_de_servicio AS tipo,
           mz.movil_id::integer AS movil,
           (mz.prioridad_o_transito <> 1) AS es_transito
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id     = mz.movil_id::integer
     AND md.escenario_id = mz.escenario_id
     AND md.fecha        = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true)
      AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  -- Carga real de cada movil: pendientes asignados en TODAS las zonas y de
  -- TODOS los tipos -- SIN filtrar servicio_nombre, a diferencia de
  -- demoras_cola y demoras_ritmo_muestras, que SI excluyen ESPECIAL/OTROS.
  -- Es DELIBERADO, no la ausencia por omision del mismo filtro (Important 4,
  -- review final): ESPECIAL/OTROS no tienen oferta propia en moviles_zonas,
  -- asi que no son DEMANDA de ninguna zona (por eso demoras_cola los saca de
  -- la cola). Pero SI son TRABAJO real que ocupa al movil -- el camion que
  -- entrega un ESPECIAL en otra zona no esta disponible mientras tanto, ni
  -- mas ni menos que si llevara un URGENTE -- y libre_en necesita saber
  -- CUANDO queda libre, no de que tipo es lo que lo ocupa. Contarlos aca es
  -- lo mismo que ya hace esta carga con el trabajo de OTRAS zonas: hace
  -- falta contarlo para saber cuando el movil se libera, aunque no compita
  -- por el pedido nuevo. Un asignado cuenta siempre (regla canonica de la
  -- ventana SA), asi que aca no hay filtro horario.
  carga_movil AS (
    SELECT p.movil, count(*)::integer AS n
    FROM (
      SELECT movil FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil
  ),
  -- Ritmo de la ZONA: el blend ponderado de toda la cascada. Es el fallback
  -- para un movil sin historial propio.
  rit_zona AS (
    SELECT r.zona_id, r.tipo_servicio, r.ritmo_media, r.ritmo_mediana,
           r.ritmo_p75, r.ritmo_p90
    FROM demoras_ritmo(p_escenario, p_fecha) r
  ),
  -- Ritmo PROPIO de cada movil. Es el que manda: el pedido nuevo va al que
  -- se libera primero, y sin ritmo por movil dos moviles solo se
  -- diferenciarian por cuantos pedidos llevan.
  rit_movil AS (
    SELECT m.movil, m.tipo_servicio, m.ritmo_media, m.ritmo_mediana,
           m.ritmo_p75, m.ritmo_p90
    FROM demoras_ritmo_movil(p_escenario, p_fecha) m
  ),
  crudo AS (
    SELECT a.zona_id, a.tipo, a.movil, a.es_transito,
           coalesce(cm.n, 0) AS carga,
           -- Cascada de tres pasos, en este orden:
           --   1. El ritmo PROPIO del movil (chofer o movil, segun resolvio
           --      demoras_ritmo_movil).
           --   2. Si no tiene historial propio, el de la ZONA (blend).
           --   3. Si la zona tampoco tiene, el piso configurado.
           -- El piso no es opcional: con ritmo NULL, libre_en seria NULL y el
           -- movil desapareceria de la simulacion sin dejar rastro.
           coalesce(
             CASE c.estadistico
               WHEN 'MEDIA' THEN rm.ritmo_media
               WHEN 'P75'   THEN rm.ritmo_p75
               WHEN 'P90'   THEN rm.ritmo_p90
               ELSE rm.ritmo_mediana
             END,
             CASE c.estadistico
               WHEN 'MEDIA' THEN rz.ritmo_media
               WHEN 'P75'   THEN rz.ritmo_p75
               WHEN 'P90'   THEN rz.ritmo_p90
               ELSE rz.ritmo_mediana
             END,
             c.ritmo_defecto) AS ritmo,
           -- De donde salio el ritmo de ESTE movil. Sin esto no se puede
           -- contestar "por que este movil se libera antes que el otro".
           CASE
             WHEN (CASE c.estadistico
                     WHEN 'MEDIA' THEN rm.ritmo_media
                     WHEN 'P75'   THEN rm.ritmo_p75
                     WHEN 'P90'   THEN rm.ritmo_p90
                     ELSE rm.ritmo_mediana END) IS NOT NULL THEN 'MOVIL'
             WHEN (CASE c.estadistico
                     WHEN 'MEDIA' THEN rz.ritmo_media
                     WHEN 'P75'   THEN rz.ritmo_p75
                     WHEN 'P90'   THEN rz.ritmo_p90
                     ELSE rz.ritmo_mediana END) IS NOT NULL THEN 'ZONA'
             ELSE 'DEFECTO'
           END AS ritmo_origen
    FROM asign a
    CROSS JOIN cfg c
    LEFT JOIN carga_movil cm ON cm.movil = a.movil
    LEFT JOIN rit_zona  rz ON rz.zona_id = a.zona_id AND rz.tipo_servicio = a.tipo
    LEFT JOIN rit_movil rm ON rm.movil   = a.movil   AND rm.tipo_servicio = a.tipo
  ),
  con_libre AS (
    SELECT k.*,
           round(
             ((k.carga * k.ritmo)
              + CASE WHEN k.es_transito AND c.modo = 'CASTIGO' THEN c.castigo ELSE 0 END)
             * CASE WHEN k.es_transito AND c.modo = 'ALPHA' AND al.a > 0
                    THEN 1 / al.a ELSE 1 END
           , 2) AS libre_en
    FROM crudo k CROSS JOIN cfg c CROSS JOIN alpha al
  ),
  -- Mejor prioridad de cada (zona, tipo): la referencia contra la que se
  -- mide si vale la pena mandar un transito.
  mejor_prioridad AS (
    SELECT zona_id, tipo, min(libre_en) AS libre_min
    FROM con_libre
    WHERE NOT es_transito
    GROUP BY zona_id, tipo
  )
  SELECT l.zona_id, l.tipo, l.movil, l.carga, l.ritmo, l.ritmo_origen,
         l.libre_en, l.es_transito,
         (l.es_transito
          AND c.modo = 'SOLO_SI_NO_HAY'
          AND mp.libre_min IS NOT NULL
          AND mp.libre_min <= l.libre_en + c.margen) AS descartado
  FROM con_libre l
  CROSS JOIN cfg c
  LEFT JOIN mejor_prioridad mp ON mp.zona_id = l.zona_id AND mp.tipo = l.tipo;
$fn$;

COMMENT ON FUNCTION demoras_servidores(integer, date) IS
  'Tiempo de liberacion de cada movil ACTIVO por (zona, tipo): libre_en = carga x ritmo, con la carga contada en TODAS las zonas porque el movil es un solo camion. Es el punto exacto donde el modelo deja de prorratear: los pedidos ya asignados dicen donde esta el trabajo, no hace falta suponerlo. La carga cuenta TAMBIEN los pedidos ESPECIAL/OTROS (a diferencia de demoras_cola, que los excluye de la demanda): no son demanda de ninguna zona, pero si son trabajo real que ocupa al movil -- ver el comentario junto a carga_movil. transito_modo (IGUAL / CASTIGO / ALPHA / SOLO_SI_NO_HAY) decide como compite un movil que en esa zona es de transito; el descartado se devuelve igual con descartado=true para que se pueda auditar por que no se uso. Aproximacion documentada: un movil con pedidos de varios tipos usa el ritmo del tipo que se esta calculando.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto:
-- sin este REVOKE, anon/authenticated (las claves que viajan al browser)
-- pueden invocarla via RPC. Mismo patron que
-- docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_servidores(integer, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_servidores(integer, date) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_servidores(integer, date) TO service_role;


-- =====================================================================
-- ARCHIVO 10 de 12: 2026-07-31-demoras-proximo-hueco.sql
-- demoras_proximo_hueco: la simulacion de cola.
-- =====================================================================

-- =====================================================================
-- demoras_proximo_hueco — la simulacion
-- Fecha: 2026-07-31 | Idempotente
--
-- Averigua a que hora queda libre cada movil de la zona, hace la fila con
-- los pedidos que ya estan esperando, y ve en que momento le toca al
-- pedido nuevo:
--
--   1. Servidores    -> demoras_servidores (libre_en por movil, ya con
--                       transito_modo aplicado; los descartados no juegan).
--   2. Cola          -> demoras_cola.cola_efectiva (los sin asignar de la
--                       zona; los asignados NO, porque ese trabajo ya esta
--                       adentro de libre_en).
--   3. Reparto       -> cada pedido de la cola va al movil que se libera
--                       primero, y a ese movil se le corre el reloj su
--                       propio ritmo.
--   4. El nuevo      -> al que quede libre primero. La demora es esa espera
--                       mas su propia entrega (incluir_entrega_propia).
--
-- Por que un LOOP en plpgsql y no SQL puro: el reparto es inherentemente
-- secuencial (cada asignacion cambia quien es el minimo para la siguiente).
-- Expresarlo con window functions requiere un recursivo pesado y mucho
-- menos legible. El costo real es chico: ~106 zonas x 3 tipos, con pocos
-- moviles y pocas decenas de cola por zona. Se hace UNA sola pasada sobre
-- los datos (los servidores se agregan a arrays por zona antes del loop) y
-- adentro solo se recorren arrays en memoria.
--
-- Barrido lineal en vez de heap: con la cantidad de moviles que tiene una
-- zona real (unidades, no cientos), un heap es mas codigo y mas riesgo sin
-- ganancia medible.
--
-- Devuelve demora_cruda SIN clamp, suavizado ni redondeo: de eso se sigue
-- ocupando demoras_acabado, que no cambia.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_proximo_hueco(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id              integer,
  tipo_servicio        text,
  demora_cruda         numeric,
  moviles_considerados integer,
  libre_primero        numeric,
  cola_por_delante     integer,
  ritmo_aplicado       numeric,
  sin_capacidad        boolean
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  c            record;
  z            record;
  v_libres     numeric[];
  v_ritmos     numeric[];
  v_n          integer;
  v_i          integer;
  v_k          integer;
  v_idx        integer;
  v_min        numeric;
  v_espera     numeric;
  v_ritmo_sel  numeric;
  v_demora     numeric;
BEGIN
  SELECT coalesce(dm.max_minutos, 120)::numeric      AS max_min,
         coalesce(dm.factor_calibracion, 1.0)        AS factor,
         coalesce(dm.incluir_entrega_propia, true)   AS incluir_entrega
    INTO c
    FROM (SELECT p_escenario AS e) x
    LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e;

  FOR z IN
    -- El universo sale de moviles_zonas, NO de los servidores: una zona con
    -- pedidos y CERO moviles activos (el peor caso operativo, y a las 07:00
    -- la mayoria) tiene que devolver fila igual, con sin_capacidad=true.
    -- Si saliera de los servidores, desapareceria sin dejar nada que auditar.
    SELECT u.zona_id, u.tipo,
           coalesce(s.libres, ARRAY[]::numeric[]) AS libres,
           coalesce(s.ritmos, ARRAY[]::numeric[]) AS ritmos,
           coalesce(q.cola_efectiva, 0)           AS cola
    FROM (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
      FROM moviles_zonas mz
      WHERE mz.escenario_id = p_escenario
        AND coalesce(mz.activa, true)
        AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ) u
    LEFT JOIN (
      -- Una sola pasada: los servidores de TODAS las zonas se agregan a
      -- arrays de una, y el loop de abajo solo toca memoria.
      SELECT sv.zona_id, sv.tipo_servicio AS tipo,
             array_agg(sv.libre_en ORDER BY sv.movil) AS libres,
             array_agg(sv.ritmo    ORDER BY sv.movil) AS ritmos
      FROM demoras_servidores(p_escenario, p_fecha) sv
      WHERE NOT sv.descartado
      GROUP BY sv.zona_id, sv.tipo_servicio
    ) s ON s.zona_id = u.zona_id AND s.tipo = u.tipo
    LEFT JOIN demoras_cola(p_escenario, p_fecha, p_corrida_at) q
           ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo
  LOOP
    v_libres := z.libres;
    v_ritmos := z.ritmos;
    v_n      := coalesce(array_length(v_libres, 1), 0);

    IF v_n = 0 THEN
      -- Sin nadie trabajando la zona, la respuesta honesta a "cuanto
      -- demora" no es "poco": un pedido que entre ahora no tiene quien lo
      -- atienda. Se informa el techo, y la bandera deja constancia de que
      -- ese numero salio de una definicion y no de un calculo (el endpoint
      -- de comparativa lo usa para excluir estas filas de la calibracion).
      zona_id              := z.zona_id;
      tipo_servicio        := z.tipo;
      demora_cruda         := c.max_min;
      moviles_considerados := 0;
      libre_primero        := NULL;
      cola_por_delante     := z.cola;
      ritmo_aplicado       := NULL;
      sin_capacidad        := true;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- El mejor tiempo de liberacion ANTES de repartir la cola. Se devuelve
    -- para poder auditar cuanto de la demora es cola y cuanto es el trabajo
    -- que los moviles ya tenian encima.
    SELECT min(x) INTO libre_primero FROM unnest(v_libres) AS x;

    -- Reparto de la cola: cada pedido al que se libera primero. A igual
    -- libre_en, gana el de MENOR ritmo (entrega antes), no el primero del
    -- array. El empate no es una rareza: al arranque del dia TODOS los
    -- moviles activos estan en libre_en = 0, asi que el empate es la
    -- situacion NORMAL, y "el primero del array" (que hoy es el de
    -- movil_id mas bajo, por el ORDER BY del array_agg de mas arriba) no es
    -- una decision de nadie -- es un efecto lateral del orden de lectura.
    -- El segundo criterio usa "<" ESTRICTO, no "<=": si tambien empatan en
    -- ritmo, el resultado tiene que seguir siendo determinista, y el orden
    -- estable del array_agg ya alcanza para eso.
    FOR v_k IN 1 .. z.cola LOOP
      v_idx := 1;
      v_min := v_libres[1];
      FOR v_i IN 2 .. v_n LOOP
        IF v_libres[v_i] < v_min
           OR (v_libres[v_i] = v_min AND v_ritmos[v_i] < v_ritmos[v_idx]) THEN
          v_min := v_libres[v_i];
          v_idx := v_i;
        END IF;
      END LOOP;
      v_libres[v_idx] := v_libres[v_idx] + v_ritmos[v_idx];
    END LOOP;

    -- El pedido nuevo va al que quede libre primero. Mismo criterio de
    -- desempate que el reparto de arriba (menor ritmo, "<" estricto): si
    -- los dos barridos usaran reglas distintas, el reparto y la ubicacion
    -- del pedido nuevo se contradirian entre si.
    v_idx := 1;
    v_min := v_libres[1];
    FOR v_i IN 2 .. v_n LOOP
      IF v_libres[v_i] < v_min
         OR (v_libres[v_i] = v_min AND v_ritmos[v_i] < v_ritmos[v_idx]) THEN
        v_min := v_libres[v_i];
        v_idx := v_i;
      END IF;
    END LOOP;

    v_espera    := v_min;
    v_ritmo_sel := v_ritmos[v_idx];

    -- El cliente tiene la garrafa cuando el movil se la lleva, no cuando el
    -- movil arranca. incluir_entrega_propia=false deja la demora en la pura
    -- espera, para poder medir las dos definiciones en el backtest.
    v_demora := v_espera + CASE WHEN c.incluir_entrega THEN v_ritmo_sel ELSE 0 END;

    zona_id              := z.zona_id;
    tipo_servicio        := z.tipo;
    demora_cruda         := round(v_demora * c.factor, 2);
    moviles_considerados := v_n;
    cola_por_delante     := z.cola;
    ritmo_aplicado       := v_ritmo_sel;
    sin_capacidad        := false;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION demoras_proximo_hueco(integer, date, timestamptz) IS
  'Simulacion del proximo hueco por (zona, tipo): reparte los pedidos sin asignar entre los moviles activos, cada uno al que se libera primero, y ubica el pedido nuevo en el primer hueco que queda. La demora es esa espera mas la propia entrega (configurable). Devuelve demora_cruda SIN clamp, suavizado ni redondeo: de eso sigue ocupandose demoras_acabado. El universo sale de moviles_zonas y no de los servidores, para que una zona sin ningun movil activo devuelva fila igual con sin_capacidad=true y el techo, en vez de desaparecer sin dejar nada que auditar. libre_primero es el mejor tiempo de liberacion ANTES de repartir la cola, para poder separar cuanto de la demora es cola y cuanto es trabajo ya encima de los moviles. Empate de libre_en (el caso normal al arranque del dia, con todos los moviles en 0): gana el de menor ritmo, no el primero del array -- desempate determinista con "<" estricto si tambien empatan en ritmo.';

-- ─── Grants: solo service_role ───────────────────────────────────────
-- Postgres otorga EXECUTE a PUBLIC en cada CREATE FUNCTION por defecto:
-- sin este REVOKE, anon/authenticated (las claves que viajan al browser)
-- pueden invocarla via RPC. Mismo patron que
-- docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
REVOKE EXECUTE ON FUNCTION demoras_proximo_hueco(integer, date, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION demoras_proximo_hueco(integer, date, timestamptz) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION demoras_proximo_hueco(integer, date, timestamptz) TO service_role;


-- =====================================================================
-- ARCHIVO 11 de 12: 2026-07-31-demoras-calcular-run-v2.sql
-- demoras_calcular_run: el orquestador. OJO: da de baja columnas de demoras_config.
-- =====================================================================

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
      h.demora_cruda         AS hueco_cruda,
      h.sin_capacidad        AS hueco_sin_cap,
      -- Insumos de auditoria del modelo PROXIMO_HUECO (Important 1, review
      -- final): se llevan crudos hasta `crudo`, que los deja en NULL cuando
      -- corre CAPACIDAD_PROMEDIO -- ver el comentario de mas abajo.
      h.ritmo_aplicado       AS hueco_ritmo_aplicado,
      h.libre_primero        AS hueco_libre_primero,
      h.cola_por_delante     AS hueco_cola_por_delante,
      h.moviles_considerados AS hueco_moviles_considerados,
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
           -- sin_cap describe el ESTADO DEL MUNDO (habia algun movil
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
           -- Los insumos que PRODUJERON demora_cruda en PROXIMO_HUECO, para
           -- poder contestar "por que esta zona informo 90" sin adivinar
           -- (Important 1, review final): antes de este fix se descartaban
           -- y demoras_calculadas guardaba ritmo_usado/ritmo_origen del
           -- blend de ZONA -el fallback del modelo nuevo, no lo que usa
           -- cuando el movil SI tiene ritmo propio-. NULL en
           -- CAPACIDAD_PROMEDIO: asi queda visible a simple vista que
           -- modelo produjo cada fila, sin tener que mirar modelo_version.
           CASE WHEN m.modelo = 'PROXIMO_HUECO' THEN a.hueco_ritmo_aplicado       ELSE NULL END AS ritmo_aplicado,
           CASE WHEN m.modelo = 'PROXIMO_HUECO' THEN a.hueco_libre_primero        ELSE NULL END AS libre_primero,
           CASE WHEN m.modelo = 'PROXIMO_HUECO' THEN a.hueco_cola_por_delante     ELSE NULL END AS cola_por_delante,
           CASE WHEN m.modelo = 'PROXIMO_HUECO' THEN a.hueco_moviles_considerados ELSE NULL END AS moviles_considerados,
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
      ritmo_aplicado, libre_primero, cola_por_delante, moviles_considerados,
      sin_capacidad, clampeado, suavizado_aplicado, modelo_version
    )
    SELECT
      p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
      f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
      f.asignados, f.sin_asignar, f.atrapados,
      f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
      f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
      f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
      f.ritmo_aplicado, f.libre_primero, f.cola_por_delante, f.moviles_considerados,
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
      ritmo_aplicado          = EXCLUDED.ritmo_aplicado,
      libre_primero           = EXCLUDED.libre_primero,
      cola_por_delante        = EXCLUDED.cola_por_delante,
      moviles_considerados    = EXCLUDED.moviles_considerados,
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

-- ─── Auditoria de los insumos del modelo nuevo (Important 1, review final) ──
-- demoras_proximo_hueco ya devolvia ritmo_aplicado / libre_primero /
-- cola_por_delante / moviles_considerados, pero el orquestador los
-- descartaba y persistia ritmo_usado/ritmo_origen del blend de ZONA (el
-- FALLBACK del modelo nuevo, no lo que usa cuando el movil tiene ritmo
-- propio). Sobre el ejemplo de DEMORA_MODELO.md 7.3: Centro informa 60
-- desde el ritmo 15 de M2, pero la fila guardaba 17.50 -- un numero que no
-- participo del calculo. El diseno promete poder reconstruir "por que esta
-- zona informo 90" seis semanas despues; sin estas columnas, no se puede.
-- NULL en CAPACIDAD_PROMEDIO (ver el CASE en la funcion de arriba): asi
-- queda visible a simple vista, sin mirar modelo_version, que modelo
-- produjo cada fila.
ALTER TABLE demoras_calculadas
  ADD COLUMN IF NOT EXISTS ritmo_aplicado       numeric,
  ADD COLUMN IF NOT EXISTS libre_primero        numeric,
  ADD COLUMN IF NOT EXISTS cola_por_delante     integer,
  ADD COLUMN IF NOT EXISTS moviles_considerados integer;

COMMENT ON COLUMN demoras_calculadas.ritmo_aplicado IS
  'Ritmo (minutos) del movil que efectivamente entrega el pedido nuevo en la simulacion PROXIMO_HUECO -- demoras_proximo_hueco.ritmo_aplicado. NULL en CAPACIDAD_PROMEDIO (esa columna la llena ritmo_usado, el blend de zona). Es el numero real detras de demora_cruda, no el fallback de zona.';
COMMENT ON COLUMN demoras_calculadas.libre_primero IS
  'Mejor tiempo de liberacion (minutos) ANTES de repartir la cola -- demoras_proximo_hueco.libre_primero. Permite separar cuanto de la demora es cola por delante y cuanto es trabajo que los moviles ya tenian encima. NULL en CAPACIDAD_PROMEDIO.';
COMMENT ON COLUMN demoras_calculadas.cola_por_delante IS
  'Pedidos sin asignar que la simulacion reparto antes de ubicar al pedido nuevo -- demoras_proximo_hueco.cola_por_delante. NULL en CAPACIDAD_PROMEDIO (esa informacion vive en pendientes_sin_asignar para los dos modelos).';
COMMENT ON COLUMN demoras_calculadas.moviles_considerados IS
  'Cantidad de moviles (servidores) que compitieron en la simulacion -- demoras_proximo_hueco.moviles_considerados. 0 implica sin_capacidad=true. NULL en CAPACIDAD_PROMEDIO.';

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
-- puede representar sin cambiar el diseno de esa tabla.
-- Dropear esta columna igual que las otras ocho rompe demoras_ritmo en
-- runtime ("column dc.ritmo_cascada does not exist"), y como
-- demoras_servidores, demoras_proximo_hueco Y este mismo orquestador
-- llaman a demoras_ritmo, el motor entero -los dos modelos, no solo el
-- viejo- queda fallando callado cada 10 minutos: exactamente el modo de
-- falla que este comentario de mas arriba dice evitar. demoras_modelo.
-- ritmo_cascada (Task 1) queda sin uso por ahora: migrar la cascada a
-- global-por-escenario es un cambio de diseno de demoras_ritmo, fuera del
-- alcance de esta task (que es solo el orquestador). Ver
-- docs/DEMORA_INFORMADA.md para el detalle.
--
-- BACKUP antes del DROP (C3, review final): el DROP de abajo no tenia
-- snapshot previo, y el seed de demoras_modelo (archivo 4) hereda SOLO de
-- la fila URGENTE -- si alguien calibro factor_calibracion de NOCTURNO o
-- SERVICE en produccion, ese valor se pierde sin quedar en ningun lado.
-- Esta tabla es esa red: copia completa de demoras_config, con las 8
-- columnas de calculo todavia adentro, tomada justo antes del DROP.
-- Borrable cuando el modelo nuevo este calibrado y nadie necesite volver a
-- mirar los valores viejos por tipo.
--
-- IF NOT EXISTS y no CREATE OR REPLACE / DROP+CREATE: re-pegar este
-- archivo DESPUES de que el DROP ya corrio no debe pisar el backup bueno
-- (con las 8 columnas) con uno mutilado -- en esa segunda pasada
-- demoras_config YA no las tiene, y un CREATE TABLE que se re-ejecutara
-- sobreescribiria el backup con una copia sin ellas. Con IF NOT EXISTS, la
-- tabla ya existe desde la primera vez y el SELECT ni se evalua.
CREATE TABLE IF NOT EXISTS demoras_config_backup_20260731 AS
  SELECT * FROM demoras_config;

COMMENT ON TABLE demoras_config_backup_20260731 IS
  'Snapshot de demoras_config tomado justo antes de que esta misma migracion (2026-07-31-demoras-calcular-run-v2.sql) le hiciera DROP COLUMN a las 8 columnas de calculo (min_minutos, max_minutos, escalon_minutos, subida_max, bajada_max, estadistico, ritmo_default_minutos, factor_calibracion), por tipo_servicio -- el seed de demoras_modelo solo hereda de la fila URGENTE, asi que es la unica forma de recuperar una calibracion de NOCTURNO o SERVICE hecha en produccion antes de esta migracion. Borrable cuando el modelo nuevo este calibrado y nadie necesite consultar los valores viejos por tipo.';

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


-- =====================================================================
-- ARCHIVO 12 de 12: 2026-07-29-demoras-cron.sql
-- Los dos jobs de pg_cron. REQUIERE la extension pg_cron habilitada.
-- =====================================================================

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



-- =====================================================================
-- PASO 9 - VOLVER A PRENDER EL MOTOR
--
-- Si llegaste hasta aca sin errores, las 12 migraciones estan aplicadas y el
-- motor arranca con el modelo PROXIMO_HUECO en la proxima corrida del cron
-- (maximo 10 minutos).
-- =====================================================================
UPDATE demoras_config SET motor_activo = true WHERE escenario_id = 1000;


-- =====================================================================
-- VERIFICACION (correr despues, en otra pestania)
-- =====================================================================
-- 1) Una corrida manual, fuera del cron:
--      SELECT demoras_calcular_run(now());
--
-- 2) Que escribio, y con que modelo:
--      SELECT zona_id, tipo_servicio, demora_informada, demora_as400,
--             ritmo_aplicado, libre_primero, cola_por_delante,
--             moviles_considerados, sin_capacidad, modelo_version
--        FROM demoras_calculadas
--       WHERE corrida_at = (SELECT max(corrida_at) FROM demoras_calculadas)
--       ORDER BY demora_informada DESC LIMIT 20;
--
--    Las cuatro columnas de auditoria (ritmo_aplicado, libre_primero,
--    cola_por_delante, moviles_considerados) vienen llenas SOLO con
--    PROXIMO_HUECO. Si salen NULL, esta corriendo el modelo viejo.
--
-- 3) Los jobs quedaron programados:
--      SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
--
-- 4) El cron viene corriendo bien (no alcanza con que este programado):
--      SELECT runid, status, start_time, return_message
--        FROM cron.job_run_details
--       WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-calcular')
--       ORDER BY start_time DESC LIMIT 10;
--
-- 5) El backup de la config vieja, por si hace falta:
--      SELECT * FROM demoras_config_backup_20260731;
--
-- Si demoras_calcular_run devuelve 0 no es necesariamente un error: puede ser
-- que estes fuera de la ventana horaria de los tres tipos. Revisa
-- demoras_config antes de asumir que algo se rompio.
-- =====================================================================
