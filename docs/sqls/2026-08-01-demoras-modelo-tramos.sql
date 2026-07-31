-- =====================================================================
-- demoras_modelo — parametros del modelo CONSUMO_TRAMOS
-- Fecha: 2026-08-01 | Idempotente | Aplicar en: Supabase SQL Editor.
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md
--
-- El modelo PROXIMO_HUECO trataba a un movil compartido como todo o nada
-- (entra / entra con castigo / no entra), y esa decision vivia en tres
-- parametros: transito_modo, transito_castigo_minutos y
-- transito_margen_minutos. En CONSUMO_TRAMOS el movil SIEMPRE entra, con la
-- fraccion de tiempo que le corresponda, asi que esos tres se dan de baja y
-- los reemplaza un solo numero calibrable.
-- =====================================================================

-- ── Los cuatro parametros nuevos ─────────────────────────────────────
ALTER TABLE demoras_modelo
  ADD COLUMN IF NOT EXISTS dedicacion_transito numeric NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS transito_dedicacion_max_total numeric NOT NULL DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS traslado_fuera_zona_minutos integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ritmo_hueco_min_minutos integer NOT NULL DEFAULT 5;

-- Constraints por separado y con DROP previo: ADD COLUMN IF NOT EXISTS no
-- reaplica el CHECK si la columna ya existia de un apply anterior.
ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_dedicacion;
ALTER TABLE demoras_modelo ADD  CONSTRAINT demoras_modelo_dedicacion
  CHECK (dedicacion_transito > 0 AND dedicacion_transito <= 1);

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_transito_max;
ALTER TABLE demoras_modelo ADD  CONSTRAINT demoras_modelo_transito_max
  CHECK (transito_dedicacion_max_total > 0 AND transito_dedicacion_max_total <= 1);

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_traslado;
ALTER TABLE demoras_modelo ADD  CONSTRAINT demoras_modelo_traslado
  CHECK (traslado_fuera_zona_minutos >= 0);

-- El piso del ritmo tiene que ser MENOR que el techo. Si alguien los cruza,
-- el filtro de muestras no deja pasar ninguna y TODAS las zonas caen al ritmo
-- por defecto sin que nadie se entere: el motor sigue escribiendo, con
-- numeros que no salieron de ningun dato.
ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_hueco_rango;
ALTER TABLE demoras_modelo ADD  CONSTRAINT demoras_modelo_hueco_rango
  CHECK (ritmo_hueco_min_minutos >= 0 AND ritmo_hueco_min_minutos < ritmo_hueco_max_minutos);

COMMENT ON COLUMN demoras_modelo.dedicacion_transito IS
  'Fraccion del tiempo que un movil le dedica a CADA zona donde es de transito. Es la perilla mas sensible del modelo: con 0.20 en vez de 0.50, el ejemplo canonico de la spec pasa de 117 a ~152 minutos. Va aparte de escenario_settings.peso_transito_alpha, que es del calculo viejo, para no mezclar dos cosas distintas.';
COMMENT ON COLUMN demoras_modelo.transito_dedicacion_max_total IS
  'Cuanto pueden sumar entre TODAS las zonas de transito de un mismo movil. Si se pasan, se achican a prorrata. Es lo que le garantiza un piso a la zona de prioridad: con 0.60, la prioridad nunca baja de 0.40 por mas zonas de transito que se le agreguen al movil.';
COMMENT ON COLUMN demoras_modelo.traslado_fuera_zona_minutos IS
  'Minutos que tarda un movil en volver a la zona despues de terminar lo que tenia afuera. Se suma UNA SOLA VEZ al tiempo de liberacion, no por pedido: es el viaje de regreso. Con 0 se comporta como si el traslado ya estuviera absorbido en el ritmo historico.';
COMMENT ON COLUMN demoras_modelo.ritmo_hueco_min_minutos IS
  'Piso del ritmo: los intervalos entre entregas menores a esto se descartan como marcacion en lote. Sin el, un chofer que marca cinco entregas juntas queda con un ritmo de segundos y arrastra la mediana de toda su zona. Medido en produccion el 2026-07-31: 12 zonas de 194 tenian ritmos menores a 5 minutos, una de 8 segundos.';

-- ── modelo: PROXIMO_HUECO se retira ──────────────────────────────────
-- El DROP va ANTES del UPDATE: el CHECK viejo (inline, autonombrado
-- demoras_modelo_modelo_check por Postgres) solo permite PROXIMO_HUECO y
-- CAPACIDAD_PROMEDIO, y sigue activo hasta que se lo saca -- si no se dropea
-- primero, el UPDATE de mas abajo rechaza su propio valor nuevo.
ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_modelo_check;

-- Se normaliza ANTES de agregar el CHECK nuevo: si quedara alguna fila con el
-- valor viejo, el ADD CONSTRAINT falla y hace rollback de todo el archivo.
UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE modelo = 'PROXIMO_HUECO';

ALTER TABLE demoras_modelo ADD  CONSTRAINT demoras_modelo_modelo_check
  CHECK (modelo IN ('CONSUMO_TRAMOS','CAPACIDAD_PROMEDIO'));

ALTER TABLE demoras_modelo ALTER COLUMN modelo SET DEFAULT 'CONSUMO_TRAMOS';

COMMENT ON COLUMN demoras_modelo.modelo IS
  'CONSUMO_TRAMOS = la capacidad de la zona crece por escalones a medida que los moviles compartidos se liberan, y la demanda se consume tramo a tramo. CAPACIDAD_PROMEDIO = el modelo viejo (pendientes/capacidad*ritmo), conservado para poder correr los dos sobre los mismos datos. PROXIMO_HUECO fue retirado: no podia expresar que un movil le dedique una fraccion de su tiempo a la zona de forma continua.';

-- ── Baja de los tres parametros de transito_modo ─────────────────────
-- En CONSUMO_TRAMOS un movil de transito SIEMPRE entra, con su fraccion.
-- La decision de "entra o no entra" desaparece.
ALTER TABLE demoras_modelo
  DROP COLUMN IF EXISTS transito_modo,
  DROP COLUMN IF EXISTS transito_castigo_minutos,
  DROP COLUMN IF EXISTS transito_margen_minutos;
