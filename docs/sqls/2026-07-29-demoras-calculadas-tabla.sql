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
