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
  'NO ESTA EN USO: quien manda hoy es demoras_config.ritmo_cascada, leida POR TIPO de servicio (docs/sqls/2026-07-31-demoras-ritmo-v2.sql). Esta columna existe para el dia que se decida que la cascada pasa a ser global por escenario en vez de por tipo, pero ese cambio no se hizo: hay configuraciones validas donde URGENTE y SERVICE corren cascadas distintas al mismo tiempo, y una sola fila por escenario ACA no puede representar eso sin antes cambiar demoras_ritmo para que deje de leer por tipo. Migrar la baja de demoras_config.ritmo_cascada sin ese cambio previo rompe demoras_ritmo en runtime (verificado con el harness): esta columna se queda sin efecto a proposito, no por descuido.';

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
