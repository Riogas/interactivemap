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
  ritmo_origen           text CHECK (ritmo_origen IN ('CHOFER','MOVIL','ZONA','GLOBAL')),
  ritmo_muestras         integer,

  sin_capacidad          boolean     NOT NULL DEFAULT false,
  clampeado              text CHECK (clampeado IN ('MIN','MAX')),
  suavizado_aplicado     boolean     NOT NULL DEFAULT false,

  PRIMARY KEY (corrida_at, escenario, zona_id, tipo_servicio)
);

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
