# Motor de demora "próximo hueco" — Plan de implementación (1 de 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el cálculo de demora `pendientes ÷ capacidad × ritmo` por el modelo del "próximo hueco" (tiempo de liberación por móvil + simulación de cola), con **todo el cálculo parametrizado** en una tabla nueva y versionada.

**Architecture:** Siete migraciones SQL puras en Supabase. Una tabla `demoras_modelo` (una fila por escenario) concentra todos los parámetros del cálculo y se auto-versiona por trigger; `demoras_config` queda solo con lo operativo por tipo. El cálculo se descompone en funciones chicas e independientemente testeables — muestras del ritmo, cola por zona, servidores con su tiempo de liberación, simulación — y `demoras_calcular_run` despacha entre el modelo nuevo y el viejo según el parámetro `modelo`.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql + SQL functions, `pg_cron`, harness Docker (`scripts/sql-harness/run.sh`).

## Global Constraints

- **El Postgres de producción está firewalleado.** Todas las migraciones se aplican pegando el archivo en el **SQL Editor de Supabase**. No hay `psql` ni CLI de migraciones contra prod.
- **Toda migración es idempotente**: volver a pegarla no da error ni duplica. `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` antes de `ADD CONSTRAINT`.
- **Los cuerpos `plpgsql` NO se validan al crearse.** Un error de tipo o una columna inexistente pasa el `CREATE` sin chistar y revienta recién cuando `pg_cron` la ejecuta, fallando en silencio cada 10 minutos. **Toda función nueva o modificada se valida con el harness antes de commitear.** No es opcional.
- **Comentarios SQL sin tildes** (convención del repo: `migracion`, `prorrateo`, `calculo`). Los `.md` sí llevan tildes.
- El motor calcula **solo el escenario 1000** (`v_esc integer := 1000` en `demoras_calcular_run`). Generalizarlo está fuera de alcance.
- Tipos de servicio válidos: `URGENTE`, `NOCTURNO`, `SERVICE`. `ESPECIAL` y `OTROS` quedan fuera del motor.
- Zona horaria de referencia: `America/Montevideo`. `pg_cron` corre en UTC.
- Diseño de referencia: `docs/DEMORA_MODELO.md` (commit `149db41`).
- Los archivos nuevos van a `docs/sqls/` con prefijo `2026-07-31-`; los asserts a `scripts/sql-harness/`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `docs/sqls/2026-07-31-demoras-modelo-tabla.sql` | Tabla `demoras_modelo` + `demoras_modelo_historial` + trigger de versionado + seed + `modelo_version` en `demoras_calculadas` + grants |
| `docs/sqls/2026-07-31-demoras-ritmo-muestras.sql` | `demoras_ritmo_muestras` — las muestras crudas del ritmo, con las dos métricas |
| `docs/sqls/2026-07-31-demoras-ritmo-v2.sql` | `demoras_ritmo` leyendo sus parámetros de `demoras_modelo` |
| `docs/sqls/2026-07-31-demoras-cola.sql` | `demoras_cola` — demanda por (zona, tipo), honrando `atrapados_modo` |
| `docs/sqls/2026-07-31-demoras-ritmo-movil.sql` | `demoras_ritmo_movil` — el ritmo **propio de cada móvil** (cascada CHOFER → MOVIL) |
| `docs/sqls/2026-07-31-demoras-servidores.sql` | `demoras_servidores` — `libre_en` por móvil, honrando `transito_modo` |
| `docs/sqls/2026-07-31-demoras-proximo-hueco.sql` | `demoras_proximo_hueco` — la simulación |
| `docs/sqls/2026-07-31-demoras-calcular-run-v2.sql` | Despacho por `modelo`, sello de versión, y baja de las columnas migradas |
| `scripts/sql-harness/assert-modelo.sql` … `assert-run-v2.sql` | Un assert por función |

**Por qué se parte así:** hoy `demoras_calcular_run` es un CTE gigante donde la demanda, la capacidad y el acabado viven mezclados, y no hay forma de testear la cola sin correr el motor entero. Cada función nueva es independientemente testeable y tiene una sola responsabilidad.

---

### Task 1: Tabla `demoras_modelo` con versionado automático

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-modelo-tabla.sql`
- Create: `scripts/sql-harness/assert-modelo.sql`

**Interfaces:**
- Produces: tabla `demoras_modelo` (PK `escenario_id`) con las 22 columnas de parámetros listadas abajo; tabla `demoras_modelo_historial`; trigger `trg_demoras_modelo_versionar`; columna `demoras_calculadas.modelo_version integer`.
- Consumes: nada. Es la primera.

**Nota de orden:** esta migración **NO** borra las columnas viejas de `demoras_config`. El motor que está corriendo las sigue leyendo, y borrarlas acá lo dejaría roto hasta la Task 7. La baja va al final.

- [ ] **Step 1: Escribir el assert (falla porque la tabla no existe)**

Crear `scripts/sql-harness/assert-modelo.sql`:

```sql
\set ON_ERROR_STOP on

-- 1) La fila del escenario 1000 existe con los defaults del diseno.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = 1000;
  IF NOT FOUND THEN RAISE EXCEPTION 'falta la fila del escenario 1000'; END IF;
  IF m.version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'version inicial: % (esperaba 1)', m.version; END IF;
  IF m.modelo IS DISTINCT FROM 'PROXIMO_HUECO' THEN RAISE EXCEPTION 'modelo: %', m.modelo; END IF;
  IF m.ritmo_metrica IS DISTINCT FROM 'ENTRE_ENTREGAS' THEN RAISE EXCEPTION 'ritmo_metrica: %', m.ritmo_metrica; END IF;
  IF m.ritmo_dias_ventana IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'ritmo_dias_ventana: %', m.ritmo_dias_ventana; END IF;
  IF m.ritmo_min_muestras IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'ritmo_min_muestras: %', m.ritmo_min_muestras; END IF;
  RAISE NOTICE 'ok seed con defaults';
END $$;

-- 2) Un UPDATE real versiona: bump de version + fila anterior al historial.
DO $$
DECLARE v_ver integer; v_hist integer; v_old text;
BEGIN
  UPDATE demoras_modelo SET estadistico = 'P90', updated_by = 'tester' WHERE escenario_id = 1000;

  SELECT version INTO v_ver FROM demoras_modelo WHERE escenario_id = 1000;
  IF v_ver IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'version tras update: % (esperaba 2)', v_ver; END IF;

  SELECT count(*) INTO v_hist FROM demoras_modelo_historial WHERE escenario_id = 1000;
  IF v_hist IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'filas de historial: % (esperaba 1)', v_hist; END IF;

  SELECT fila->>'estadistico' INTO v_old
    FROM demoras_modelo_historial WHERE escenario_id = 1000 AND version = 1;
  IF v_old IS DISTINCT FROM 'MEDIANA' THEN
    RAISE EXCEPTION 'el historial guardo el valor NUEVO (%), tiene que guardar el ANTERIOR', v_old;
  END IF;
  RAISE NOTICE 'ok versionado';
END $$;

-- 3) Un UPDATE que no cambia nada NO versiona (si no, tocar la pantalla
--    sin editar infla el historial y rompe la trazabilidad).
DO $$
DECLARE v_ver integer; v_hist integer;
BEGIN
  UPDATE demoras_modelo SET estadistico = 'P90' WHERE escenario_id = 1000;
  SELECT version INTO v_ver FROM demoras_modelo WHERE escenario_id = 1000;
  SELECT count(*) INTO v_hist FROM demoras_modelo_historial WHERE escenario_id = 1000;
  IF v_ver IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'update sin cambios versiono: %', v_ver; END IF;
  IF v_hist IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'update sin cambios escribio historial: %', v_hist; END IF;
  RAISE NOTICE 'ok update inocuo no versiona';
END $$;

-- 4) Los CHECK rechazan basura.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET modelo = 'FRUTA' WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un modelo invalido';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET max_minutos = 10, min_minutos = 30 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto max < min';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET ritmo_dias_ventana = 0 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto una ventana de 0 dias';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'ok constraints';
END $$;

-- 5) La anon key del browser no puede leer ni escribir la config del motor.
DO $$
BEGIN
  IF has_table_privilege('anon','demoras_modelo','SELECT') THEN RAISE EXCEPTION 'anon puede leer demoras_modelo'; END IF;
  IF has_table_privilege('anon','demoras_modelo','UPDATE') THEN RAISE EXCEPTION 'anon puede escribir demoras_modelo'; END IF;
  IF has_table_privilege('authenticated','demoras_modelo','UPDATE') THEN RAISE EXCEPTION 'authenticated puede escribir demoras_modelo'; END IF;
  IF has_table_privilege('anon','demoras_modelo_historial','SELECT') THEN RAISE EXCEPTION 'anon puede leer el historial'; END IF;
  RAISE NOTICE 'ok grants';
END $$;

-- 6) demoras_calculadas tiene el sello de version.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='demoras_calculadas' AND column_name='modelo_version') THEN
    RAISE EXCEPTION 'falta demoras_calculadas.modelo_version';
  END IF;
  RAISE NOTICE 'ok sello de version';
END $$;

-- Restaurar para no ensuciar asserts posteriores en la misma invocacion.
UPDATE demoras_modelo SET estadistico = 'MEDIANA', min_minutos = 30, max_minutos = 120
 WHERE escenario_id = 1000;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  --assert scripts/sql-harness/assert-modelo.sql
```

Esperado: `FAIL` con `relation "demoras_modelo" does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-07-31-demoras-modelo-tabla.sql`:

```sql
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
```

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  --assert scripts/sql-harness/assert-modelo.sql
```

Esperado: `ok seed con defaults`, `ok versionado`, `ok update inocuo no versiona`, `ok constraints`, `ok grants`, `ok sello de version`, exit 0.

- [ ] **Step 5: Verificar la idempotencia (aplicar dos veces seguidas)**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  --assert scripts/sql-harness/assert-modelo.sql
```

Esperado: exit 0. Si el segundo apply falla, el `IF NOT EXISTS` o el `ON CONFLICT` del seed están mal.

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-modelo-tabla.sql scripts/sql-harness/assert-modelo.sql
git commit -m "feat(demoras): tabla demoras_modelo con todos los parametros del calculo

Una fila por escenario con los 22 parametros del calculo, auto-versionada
por trigger. Un UPDATE que cambia algo bumpea version y deja la fila
anterior completa en demoras_modelo_historial (jsonb, para que agregar un
parametro manana no requiera migrar el historial); un UPDATE que no cambia
nada NO versiona, para que abrir la pantalla y guardar no invalide la
comparabilidad de las corridas.

demoras_calculadas.modelo_version sella que configuracion produjo cada fila:
sin eso, cambiar el estadistico un martes vuelve incomparables el lunes y el
miercoles sin forma de notarlo.

El seed hereda los valores vigentes de la fila URGENTE de demoras_config
para no resetear una calibracion en curso, con guarda por information_schema
para que re-aplicar el archivo despues de la baja de columnas no explote.

Las columnas viejas de demoras_config NO se borran aca: el motor en
produccion las sigue leyendo y quedaria tumbado en silencio hasta la
migracion final."
```

---

### Task 2: `demoras_ritmo_muestras` — el ritmo de entrega real

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-ritmo-muestras.sql`
- Create: `scripts/sql-harness/assert-ritmo-muestras.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1) — solo para los defaults del assert; la función recibe todo por parámetro.
- Produces:
  ```sql
  demoras_ritmo_muestras(
    p_escenario integer, p_hasta date, p_dias integer,
    p_metrica text, p_hueco_max integer, p_solo_con_cola boolean
  ) RETURNS TABLE (zona_nro integer, tipo text, movil integer, chofer text, v numeric)
  ```
  Una fila por muestra cruda. `demoras_ritmo` (Task 3) la usa como su CTE `base`.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-ritmo-muestras.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE metricas_cumplimiento;

-- Movil 10, zona 100, URGENTE, un solo dia: entrega a las 09:00, 09:20,
-- 09:40 y 12:00. Los intervalos son 20, 20 y 140 minutos.
-- El de 140 es el hueco del almuerzo y tiene que caer por el corte.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_asignado, fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
VALUES
  ('PEDIDO', 1, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 08:40:00-03', timestamptz '2026-07-28 09:00:00-03', 20, 20, 'CAMPO'),
  -- asignado 08:50 < fin del anterior (09:00) -> el movil YA tenia cola
  ('PEDIDO', 2, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 08:50:00-03', timestamptz '2026-07-28 09:20:00-03', 30, 30, 'CAMPO'),
  -- asignado 09:30 > fin del anterior (09:20) -> el movil estuvo ocioso
  ('PEDIDO', 3, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 09:30:00-03', timestamptz '2026-07-28 09:40:00-03', 10, 10, 'CAMPO'),
  ('PEDIDO', 4, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
   timestamptz '2026-07-28 11:00:00-03', timestamptz '2026-07-28 12:00:00-03', 60, 60, 'CAMPO');

-- 1) ENTRE_ENTREGAS: 3 intervalos crudos (20, 20, 140), el de 140 se corta.
DO $$
DECLARE v_n integer; v_max numeric;
BEGIN
  SELECT count(*), max(v) INTO v_n, v_max
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, false);
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'muestras: % (esperaba 2: los de 20 y 20)', v_n; END IF;
  IF v_max IS DISTINCT FROM 20 THEN RAISE EXCEPTION 'max: % (esperaba 20; el hueco de 140 debio caer)', v_max; END IF;
  RAISE NOTICE 'ok entre_entregas con corte de huecos';
END $$;

-- 2) El corte es parametro: con 200 entra el hueco de 140.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 200, false);
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'con corte 200 esperaba 3 muestras, dio %', v_n; END IF;
  RAISE NOTICE 'ok el corte es parametro';
END $$;

-- 3) solo_con_cola descarta el intervalo en que el movil estuvo ocioso.
--    Queda solo el 2do (asignado 08:50 <= fin anterior 09:00).
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, true);
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'solo_con_cola: % (esperaba 1)', v_n; END IF;
  RAISE NOTICE 'ok solo_con_cola';
END $$;

-- 4) La metrica vieja devuelve demora_efectiva_mins tal cual: las 4 filas.
DO $$
DECLARE v_n integer; v_sum numeric;
BEGIN
  SELECT count(*), sum(v) INTO v_n, v_sum
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ASIGNADO_A_ENTREGA', 90, false);
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'asignado_a_entrega: % filas (esperaba 4)', v_n; END IF;
  IF v_sum IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'suma: % (esperaba 20+30+10+60=120)', v_sum; END IF;
  RAISE NOTICE 'ok asignado_a_entrega';
END $$;

-- 5) El intervalo NO cruza de un dia al otro: la ultima entrega del lunes y
--    la primera del martes no son un intervalo de trabajo.
DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_asignado, fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  VALUES
    ('PEDIDO', 5, 1000, DATE '2026-07-27', 'URGENTE', 10, 100, 'ANA',
     timestamptz '2026-07-27 22:30:00-03', timestamptz '2026-07-27 23:00:00-03', 30, 30, 'CAMPO');

  SELECT count(*) INTO v_n
    FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, false);
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'muestras: % (esperaba 2; el salto 27-jul 23:00 -> 28-jul 09:00 no es un intervalo)', v_n;
  END IF;
  RAISE NOTICE 'ok no cruza dias';
END $$;

TRUNCATE metricas_cumplimiento;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh --assert scripts/sql-harness/assert-ritmo-muestras.sql
```

Esperado: `FAIL` con `function demoras_ritmo_muestras(...) does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-07-31-demoras-ritmo-muestras.sql`:

```sql
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
```

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  --assert scripts/sql-harness/assert-ritmo-muestras.sql
```

Esperado: `ok entre_entregas con corte de huecos`, `ok el corte es parametro`, `ok solo_con_cola`, `ok asignado_a_entrega`, `ok no cruza dias`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-ritmo-muestras.sql scripts/sql-harness/assert-ritmo-muestras.sql
git commit -m "feat(demoras): ritmo de entrega real (entre cumplimientos consecutivos)

La metrica que el motor usaba como 'ritmo' es demora_efectiva_mins, o sea
entrega menos asignacion, que YA incluye la espera detras de los otros
pedidos que el movil tenia arriba. Multiplicarla por la cantidad de
pendientes cuenta la cola dos veces: es el riesgo R1, y no es un problema de
calibracion sino la metrica equivocada.

La buena se deriva de datos que ya tenemos: la diferencia entre
fch_hora_finalizacion consecutivos del mismo movil. Un movil con 3 pedidos
que entrega uno cada 20' da demora_efectiva 20/40/60 (mediana 40) pero
intervalos 20/20 (mediana 20). El 40 es 20 de trabajo y 20 de cola.

La particion incluye la fecha local: el salto entre la ultima entrega de un
dia y la primera del siguiente son 10 horas de noche, no un intervalo de
trabajo. p_hueco_max corta almuerzos; p_solo_con_cola exige que el pedido ya
estuviera asignado al terminar el anterior, que es la forma precisa de
distinguir ritmo de ocio con los datos que hay.

Las dos metricas conviven detras de un parametro para poder correr el modelo
viejo y el nuevo sobre los mismos datos."
```

---

### Task 3: `demoras_ritmo` lee sus parámetros de `demoras_modelo`

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-ritmo-v2.sql`
- Modify: `scripts/sql-harness/assert-ritmo.sql` (agregar dos bloques al final)

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1), `demoras_ritmo_muestras` (Task 2).
- Produces:
  ```sql
  demoras_ritmo(p_escenario integer, p_hasta date)
  RETURNS TABLE (zona_id integer, tipo_servicio text,
                 ritmo_media numeric, ritmo_mediana numeric,
                 ritmo_p75 numeric, ritmo_p90 numeric,
                 ritmo_origen text, ritmo_muestras integer)
  ```
  **La firma cambia**: se van `p_dias` y `p_min_muestras`, que ahora salen de `demoras_modelo`. Hay que `DROP FUNCTION` la vieja de 4 parámetros o las llamadas de 2 argumentos quedan ambiguas.

- [ ] **Step 1: Agregar los asserts nuevos al final de `assert-ritmo.sql`**

Los bloques que ya están en el archivo siguen valiendo (llaman `demoras_ritmo(1000, DATE '2026-07-29')`, que es la firma nueva). Agregar al final:

```sql
-- ─── Los parametros salen de demoras_modelo, no de la firma ──────────

-- ritmo_min_muestras es parametro: con el minimo en 2, la zona 200 (que
-- tiene 2 hechos y hoy cae a GLOBAL) tiene que resolverse por ZONA.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET ritmo_min_muestras = 2 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'ZONA' THEN
    RAISE EXCEPTION 'con min_muestras=2 la zona 200 debio resolver por ZONA, dio %', r.ritmo_origen;
  END IF;
  UPDATE demoras_modelo SET ritmo_min_muestras = 5 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok ritmo_min_muestras es parametro';
END $$;

-- ritmo_dias_ventana es parametro. Se afirma sobre ritmo_MUESTRAS y NO sobre
-- ritmo_origen, a proposito: para cuando corren estos bloques el archivo ya
-- sembro moviles_dia (movil 10, chofer ANA, zona 100), asi que los niveles
-- CHOFER y MOVIL tienen aporte y ganan la cascada antes que ZONA. Que nivel
-- gane es asunto del bloque de cascada, no de este.
--
-- Y hay una razon mas fuerte: los 5 hechos de ANA caen todos en el 2026-07-28,
-- el unico dia que entra en una ventana de 1, asi que CHOFER gana igual con
-- la ventana recortada. Un assert sobre el origen daria el mismo resultado
-- aunque ritmo_dias_ventana no fuera parametrizable en absoluto -- seria un
-- test que no puede fallar. Lo que este bloque tiene que probar es que mover
-- la ventana cambia QUE HECHOS VE la funcion, y eso se ve en las muestras.
DO $$
DECLARE r_dentro record; r_fuera record;
BEGIN
  UPDATE demoras_modelo SET ritmo_dias_ventana = 1 WHERE escenario_id = 1000;

  -- Ventana de 1 dia sobre 2026-07-29 = [2026-07-28, 2026-07-28], que es
  -- justo donde estan los hechos: tiene que verlos.
  SELECT * INTO r_dentro FROM demoras_ritmo(1000, DATE '2026-07-29')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF coalesce(r_dentro.ritmo_muestras, 0) = 0 THEN
    RAISE EXCEPTION 'ventana 1 dia sobre 2026-07-29 debio ver los hechos del 28, dio % muestras',
                    r_dentro.ritmo_muestras;
  END IF;

  -- La MISMA ventana de 1 dia, corrida dos dias = [2026-07-30, 2026-07-30],
  -- donde no hay ningun hecho. Si la ventana no se estuviera aplicando, este
  -- chequeo veria los mismos hechos que el anterior.
  SELECT * INTO r_fuera FROM demoras_ritmo(1000, DATE '2026-07-31')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r_fuera.ritmo_muestras IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ventana 1 dia sobre 2026-07-31 no debio ver nada, dio % muestras',
                    r_fuera.ritmo_muestras;
  END IF;

  UPDATE demoras_modelo SET ritmo_dias_ventana = 7 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok ritmo_dias_ventana es parametro (% muestras dentro, % fuera)',
               r_dentro.ritmo_muestras, r_fuera.ritmo_muestras;
END $$;

-- ritmo_metrica es parametro: con ENTRE_ENTREGAS los hechos de este assert
-- (todos con la misma fch_hora_finalizacion) no producen ningun intervalo
-- valido, asi que no hay muestras y cae a DEFECTO. Es la prueba de que la
-- funcion realmente cambia de fuente y no ignora el parametro.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.ritmo_muestras <> 0 THEN
    RAISE EXCEPTION 'con ENTRE_ENTREGAS no debia haber muestras, dio %', r.ritmo_muestras;
  END IF;
  UPDATE demoras_modelo SET ritmo_metrica = 'ASIGNADO_A_ENTREGA' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok ritmo_metrica es parametro';
END $$;

-- Restaurar el default para no ensuciar asserts posteriores.
UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS' WHERE escenario_id = 1000;
```

**Ojo:** los bloques que ya existían en `assert-ritmo.sql` insertan hechos con `fch_hora_finalizacion = now()` (todos iguales) y afirman medianas sobre `demora_efectiva_mins`. Para que sigan pasando, el archivo tiene que poner `ritmo_metrica = 'ASIGNADO_A_ENTREGA'` **antes** de esos bloques. Agregar justo después del `TRUNCATE` inicial del archivo:

```sql
-- Los asserts historicos de este archivo afirman estadisticas sobre
-- demora_efectiva_mins, asi que fijan la metrica vieja explicitamente en vez
-- de depender del default (que es ENTRE_ENTREGAS).
UPDATE demoras_modelo SET ritmo_metrica = 'ASIGNADO_A_ENTREGA' WHERE escenario_id = 1000;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-30-demoras-ritmo-cascada.sql \
  --assert scripts/sql-harness/assert-ritmo.sql
```

Esperado: `FAIL`. La versión vieja de `demoras_ritmo` ignora `demoras_modelo`, así que el bloque de `ritmo_min_muestras` va a dar `GLOBAL` en vez de `ZONA`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-07-31-demoras-ritmo-v2.sql`. Es la función de `2026-07-30-demoras-ritmo-cascada.sql` con tres cambios: firma de 2 parámetros, un CTE `cfg` que lee `demoras_modelo`, y la CTE `base` reemplazada por la llamada a `demoras_ritmo_muestras`. **Todo lo demás (los CTEs `por_zona`, `global`, `por_movil`, `chofer_top_por_movil`, `por_chofer`, `alpha`, `asign`, `aporte`, `por_zona_movil`, `movil_chofer`, `zona_chofer`, `por_zona_chofer`, `cascada_cruda`, `cascada_valida`, `cascada`, `candidatos`, `elegido`) se copia textual del archivo del 2026-07-30**, incluyendo sus comentarios: el blend ponderado, el colapso por chofer y el filtro por `peso_norm > 0` son fixes de una revisión anterior y no se tocan.

```sql
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
  -- ↓↓↓ COPIAR TEXTUAL desde `por_zona AS (` hasta `elegido AS (...)`
  --     de docs/sqls/2026-07-30-demoras-ritmo-cascada.sql, con UN solo
  --     cambio: en `elegido`, reemplazar `p_min_muestras` por
  --     `(SELECT min_muestras FROM cfg)` en las dos apariciones del
  --     ORDER BY. El resto no se toca.
  ...
  SELECT zona_id, tipo, media, mediana, p75, p90, nivel, n
  FROM elegido;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date) IS
  'Cascada de cuatro niveles (CHOFER, MOVIL, ZONA, GLOBAL) por (zona, tipo). Los parametros (ventana en dias, minimo de muestras, metrica, corte de huecos) salen de demoras_modelo, no de la firma, para poder cambiarlos sin tocar a los llamadores. Las muestras vienen de demoras_ritmo_muestras, que resuelve si el ritmo se mide entre cumplimientos consecutivos (ENTRE_ENTREGAS, lo correcto) o de asignacion a entrega (ASIGNADO_A_ENTREGA, la metrica vieja que doble-cuenta la cola). El resto del algoritmo es identico a la version del 2026-07-30: blend ponderado en CHOFER/MOVIL, chofer que maneja varios moviles no duplica muestras, nivel sin peso real no gana la cascada, GLOBAL siempre ultimo.';
```

> **Al implementador:** el `...` de arriba es la única parte que se copia de otro archivo. Abrir `docs/sqls/2026-07-30-demoras-ritmo-cascada.sql`, tomar las líneas desde `por_zona AS (` hasta el cierre de `elegido AS (...)`, pegarlas, y hacer el reemplazo de `p_min_muestras`. No reescribir esos CTEs de memoria.

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  --assert scripts/sql-harness/assert-ritmo.sql
```

Esperado: todos los `ok` viejos más `ok ritmo_min_muestras es parametro`, `ok ritmo_dias_ventana es parametro`, `ok ritmo_metrica es parametro`. Exit 0.

- [ ] **Step 5: Verificar que no quedó la firma vieja**

```bash
docker rm -f pgharness >/dev/null 2>&1; \
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-30-demoras-ritmo-cascada.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  --assert scripts/sql-harness/assert-ritmo.sql
```

Aplicar primero la vieja y después la nueva es el caso real de producción. Esperado: exit 0. Si da `function demoras_ritmo(integer, date) is not unique`, falta el `DROP FUNCTION`.

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-ritmo-v2.sql scripts/sql-harness/assert-ritmo.sql
git commit -m "feat(demoras): demoras_ritmo lee sus parametros de demoras_modelo

La ventana en dias y el minimo de muestras estaban clavados en la firma
(DEFAULT 7 y DEFAULT 5) y por lo tanto en el codigo: cambiarlos requeria
migracion. Ahora salen de demoras_modelo, y la fuente de las muestras es
demoras_ritmo_muestras, que decide entre la metrica nueva y la vieja.

La firma pasa de 4 parametros a 2, asi que hay DROP FUNCTION explicito: con
las dos firmas vivas, una llamada de 2 argumentos matchea ambas y Postgres
aborta con 'is not unique' en tiempo de ejecucion, no al aplicar.

El algoritmo de la cascada no se toca: el blend ponderado de CHOFER/MOVIL,
el colapso por chofer y el filtro de peso real son fixes de una revision
anterior y se copian textual.

assert-ritmo.sql fija ASIGNADO_A_ENTREGA antes de sus bloques historicos,
que afirman estadisticas sobre demora_efectiva_mins."
```

---

### Task 4: `demoras_cola` — la demanda por zona, con `atrapados_modo`

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-cola.sql`
- Create: `scripts/sql-harness/assert-cola.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1).
- Produces:
  ```sql
  demoras_cola(p_escenario integer, p_fecha date, p_corrida_at timestamptz)
  RETURNS TABLE (zona_id integer, tipo_servicio text,
                 asignados integer, sin_asignar integer, atrapados integer,
                 cola_efectiva integer)
  ```
  `cola_efectiva` es lo que el simulador pone en fila **por delante** del pedido nuevo, ya resuelto según `atrapados_modo`. `asignados`/`sin_asignar`/`atrapados` se devuelven crudos para auditoría y para que `demoras_calcular_run` los persista.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-cola.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE pedidos, services, moviles_dia;

-- Zona 100 URGENTE: 2 asignados a un movil ACTIVO, 1 asignado a un movil
-- INACTIVO (atrapado), 3 sin asignar.
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 10, DATE '2026-07-30', true),
       (1000, 99, DATE '2026-07-30', false);

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
VALUES
  (1, 1000, 'URGENTE', 10,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (2, 1000, 'URGENTE', 10,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (3, 1000, 'URGENTE', 99,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (4, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (5, 1000, 'URGENTE', 0,    100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  (6, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  -- Cumplido: no es cola.
  (7, 1000, 'URGENTE', 10,   100, 2, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  -- ESPECIAL: fuera del motor.
  (8, 1000, 'ESPECIAL', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 15:00:00-03'),
  -- fch_para NULL pero fch_hora_para del dia: tiene que contar igual (el 4%).
  (9, 1000, 'URGENTE', NULL, 100, 1, NULL, timestamptz '2026-07-30 15:00:00-03');

-- 1) Los conteos crudos.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.asignados   IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'asignados: % (esperaba 3: 2 del activo + 1 atrapado)', r.asignados; END IF;
  IF r.atrapados   IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'atrapados: % (esperaba 1)', r.atrapados; END IF;
  IF r.sin_asignar IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'sin_asignar: % (esperaba 4: movil NULL, movil 0, y el de fch_para NULL)', r.sin_asignar; END IF;
  RAISE NOTICE 'ok conteos crudos';
END $$;

-- 2) atrapados_modo = EXCLUIR (default): el atrapado no entra en la cola.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'EXCLUIR: cola_efectiva % (esperaba 4 = los sin asignar; los asignados a moviles activos los lleva el simulador via libre_en)', r.cola_efectiva;
  END IF;
  RAISE NOTICE 'ok atrapados EXCLUIR';
END $$;

-- 3) atrapados_modo = COMO_SIN_ASIGNAR: el atrapado se suma a la cola,
--    porque lo va a agarrar otro movil.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET atrapados_modo = 'COMO_SIN_ASIGNAR' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'COMO_SIN_ASIGNAR: cola_efectiva % (esperaba 5)', r.cola_efectiva;
  END IF;
  UPDATE demoras_modelo SET atrapados_modo = 'EXCLUIR' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok atrapados COMO_SIN_ASIGNAR';
END $$;

-- 4) La ventana SA: un sin asignar que arranca mucho mas tarde todavia no
--    existe para el sistema y no debe empujar la demora. Un ASIGNADO cuenta
--    siempre, aunque arranque tarde (regla canonica, lib/sa-window-filter.ts).
DO $$
DECLARE r record;
BEGIN
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
  VALUES (20, 1000, 'URGENTE', NULL, 100, 1, DATE '2026-07-30', timestamptz '2026-07-30 23:00:00-03'),
         (21, 1000, 'URGENTE', 10,   100, 1, DATE '2026-07-30', timestamptz '2026-07-30 23:00:00-03');

  -- escenario_settings.pedidos_sa_minutos_antes = 60 en los stubs.
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.sin_asignar IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'el SA de las 23:00 no debio contar a las 14:00: sin_asignar %', r.sin_asignar;
  END IF;
  IF r.asignados IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'el ASIGNADO de las 23:00 debio contar igual: asignados %', r.asignados;
  END IF;
  RAISE NOTICE 'ok ventana SA';
END $$;

-- 5) Un escenario SIN fila en escenario_settings no puede hacer desaparecer
--    la demanda. Es el peor modo de falla posible: la funcion devolveria
--    cero filas, el motor informaria el piso, y una zona con cola real
--    saldria como si estuviera vacia. Los ASIGNADOS cuentan siempre, y sin
--    configuracion de ventana los SIN ASIGNAR tambien (NULL = sin filtro).
DO $$
DECLARE r record; v_mins integer;
BEGIN
  SELECT pedidos_sa_minutos_antes INTO v_mins FROM escenario_settings WHERE escenario_id = 1000;
  DELETE FROM escenario_settings WHERE escenario_id = 1000;

  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin fila en escenario_settings la funcion devolvio CERO filas: la demanda desaparecio';
  END IF;
  IF r.asignados = 0 THEN
    RAISE EXCEPTION 'sin fila en escenario_settings se perdieron los asignados, que cuentan siempre';
  END IF;

  INSERT INTO escenario_settings (escenario_id, peso_transito_alpha, nombre, pedidos_sa_minutos_antes)
  VALUES (1000, 0.3, 'Escenario 1000', v_mins);
  RAISE NOTICE 'ok sin escenario_settings degrada a "sin filtro", no a cero filas';
END $$;

TRUNCATE pedidos, services, moviles_dia;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  --assert scripts/sql-harness/assert-cola.sql
```

Esperado: `FAIL` con `function demoras_cola(...) does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-07-31-demoras-cola.sql`:

```sql
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
-- seria exactamente el doble conteo que este modelo vino a arreglar.
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
```

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  --assert scripts/sql-harness/assert-cola.sql
```

Esperado: `ok conteos crudos`, `ok atrapados EXCLUIR`, `ok atrapados COMO_SIN_ASIGNAR`, `ok ventana SA`. Exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-cola.sql scripts/sql-harness/assert-cola.sql
git commit -m "feat(demoras): demoras_cola con atrapados_modo parametrizable

Saca la CTE 'dem' de adentro de demoras_calcular_run para poder testearla
sola. La ventana SA, el COALESCE de fch_para y el tratamiento de los
atrapados son tres reglas con esquinas propias que hoy no se podian probar
sin correr el motor entero.

cola_efectiva es lo que se pone en fila POR DELANTE del pedido nuevo, y a
proposito NO incluye a los asignados: ese trabajo entra al modelo por el
tiempo de liberacion del movil. Contarlo en los dos lados es exactamente el
doble conteo que este modelo vino a arreglar.

atrapados_modo hace configurable la decision 8.3 (hoy EXCLUIR) para poder
medir su impacto en el backtest en vez de asumirla."
```

---

### Task 5: `demoras_servidores` — cuándo se libera cada móvil

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-ritmo-movil.sql`
- Create: `docs/sqls/2026-07-31-demoras-servidores.sql`
- Create: `scripts/sql-harness/assert-servidores.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1), `demoras_ritmo_muestras` (Task 2), `demoras_ritmo` (Task 3).
- Produces:
  ```sql
  demoras_ritmo_movil(p_escenario integer, p_hasta date)
  RETURNS TABLE (movil integer, tipo_servicio text,
                 ritmo_media numeric, ritmo_mediana numeric,
                 ritmo_p75 numeric, ritmo_p90 numeric,
                 ritmo_origen text, ritmo_muestras integer)

  demoras_servidores(p_escenario integer, p_fecha date)
  RETURNS TABLE (zona_id integer, tipo_servicio text, movil integer,
                 carga integer, ritmo numeric, ritmo_origen text,
                 libre_en numeric, es_transito boolean, descartado boolean)
  ```
  Una fila por (zona, tipo, móvil **activo**). `libre_en` son minutos desde ahora, ya con `transito_modo` aplicado. `descartado = true` cuando `transito_modo='SOLO_SI_NO_HAY'` deja el móvil afuera.

> **Por qué hace falta `demoras_ritmo_movil`.** `demoras_ritmo` (Task 3)
> devuelve **un ritmo por (zona, tipo)**: los niveles CHOFER y MOVIL de su
> cascada ya vienen mezclados en un promedio ponderado por el aporte de cada
> móvil a la zona. Sirve para el modelo viejo, que multiplica un solo ritmo
> por la cola de la zona.
>
> El modelo del próximo hueco necesita otra cosa: **el ritmo propio de cada
> móvil**, porque `libre_en = carga × ritmo` y el pedido nuevo va al que se
> libera primero. Con un ritmo compartido, dos móviles solo se diferencian
> por cuántos pedidos llevan, y el ejemplo publicado en `DEMORA_MODELO.md`
> § 7.3 —M1 a 20 min y M2 a 15, que es lo que hace que Centro dé 60— se
> vuelve irreproducible.
>
> Las muestras por móvil ya existen: `demoras_ritmo_muestras` devuelve la
> columna `movil`. Solo faltaba agruparlas por móvil en vez de por zona.
> `demoras_servidores` usa el ritmo propio del móvil si lo tiene, cae al de
> la zona si no, y al piso configurado si tampoco.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-servidores.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
UPDATE demoras_modelo SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', transito_modo = 'IGUAL'
 WHERE escenario_id = 1000;

-- M1 prioridad en 100. M2 prioridad en 100 y TRANSITO en 200. M3 prioridad en 200.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000, '1', 100, 'URGENTE', 1, true),
       (1000, '2', 100, 'URGENTE', 1, true),
       (1000, '2', 200, 'URGENTE', 2, true),
       (1000, '3', 200, 'URGENTE', 1, true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 1, DATE '2026-07-30', true),
       (1000, 2, DATE '2026-07-30', true),
       (1000, 3, DATE '2026-07-30', true);

-- Carga: M1 lleva 3 pedidos (zona 100), M2 lleva 1 (zona 200), M3 lleva 2 (zona 200).
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,100,1,DATE '2026-07-30'),
       (2,1000,'URGENTE',1,100,1,DATE '2026-07-30'),
       (3,1000,'URGENTE',1,100,1,DATE '2026-07-30'),
       (4,1000,'URGENTE',2,200,1,DATE '2026-07-30'),
       (5,1000,'URGENTE',3,200,1,DATE '2026-07-30'),
       (6,1000,'URGENTE',3,200,1,DATE '2026-07-30');

-- Ritmo propio por movil: M1=20, M2=15, M3=25. Cinco hechos cada uno para
-- superar ritmo_min_muestras y ganar el nivel MOVIL de la cascada.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 1000 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, m.zona, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (1,100,20.0),(2,100,15.0),(3,200,25.0)) AS m(movil, zona, r),
     generate_series(1,5) g;

-- 0) El ritmo es PROPIO de cada movil, no el blend de la zona. Sin esto, M1
--    y M2 (que comparten la zona 100) tendrian el mismo numero y el modelo
--    perderia lo unico que distingue un movil rapido de uno lento.
DO $$
DECLARE r1 record; r2 record;
BEGIN
  SELECT * INTO r1 FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 1 AND tipo_servicio = 'URGENTE';
  SELECT * INTO r2 FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 2 AND tipo_servicio = 'URGENTE';
  IF round(r1.ritmo_mediana) IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'ritmo propio de M1: % (esperaba 20)', r1.ritmo_mediana;
  END IF;
  IF round(r2.ritmo_mediana) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'ritmo propio de M2: % (esperaba 15)', r2.ritmo_mediana;
  END IF;
  IF r1.ritmo_mediana = r2.ritmo_mediana THEN
    RAISE EXCEPTION 'M1 y M2 comparten ritmo (%): el ritmo no es por movil', r1.ritmo_mediana;
  END IF;
  RAISE NOTICE 'ok ritmo propio por movil (M1=%, M2=%)', r1.ritmo_mediana, r2.ritmo_mediana;
END $$;

-- 0b) Un movil SIN historial propio no devuelve fila, para que el llamador
--     pueda caer al ritmo de la zona en vez de recibir un NULL ambiguo.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM demoras_ritmo_movil(1000, DATE '2026-07-30')
   WHERE movil = 4;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un movil sin historial devolvio % filas', v_n; END IF;
  RAISE NOTICE 'ok movil sin historial no devuelve fila';
END $$;

-- 1) libre_en = carga x ritmo, con la carga contada en TODAS las zonas.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 1;
  IF r.carga IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'M1 carga: % (esperaba 3)', r.carga; END IF;
  IF round(r.ritmo) IS DISTINCT FROM 20 THEN RAISE EXCEPTION 'M1 ritmo: % (esperaba 20)', r.ritmo; END IF;
  IF r.ritmo_origen IS DISTINCT FROM 'MOVIL' THEN
    RAISE EXCEPTION 'M1 ritmo_origen: % (esperaba MOVIL, tiene historial propio)', r.ritmo_origen;
  END IF;
  IF round(r.libre_en) IS DISTINCT FROM 60 THEN RAISE EXCEPTION 'M1 libre_en: % (esperaba 60)', r.libre_en; END IF;

  -- M2 tiene su unico pedido en la zona 200, pero en la zona 100 su
  -- libre_en tiene que reflejar ese trabajo igual: es el mismo camion.
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.carga IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M2 en zona 100 carga: % (esperaba 1: su pedido de la zona 200 tambien lo ocupa)', r.carga;
  END IF;
  IF round(r.libre_en) IS DISTINCT FROM 15 THEN RAISE EXCEPTION 'M2 libre_en: % (esperaba 15)', r.libre_en; END IF;
  RAISE NOTICE 'ok libre_en con carga de todas las zonas';
END $$;

-- 2) Un movil INACTIVO no es servidor.
DO $$
DECLARE v_n integer;
BEGIN
  UPDATE moviles_dia SET activo = false WHERE movil_id = 1 AND fecha = DATE '2026-07-30';
  SELECT count(*) INTO v_n FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND movil = 1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un movil inactivo aparecio como servidor'; END IF;
  UPDATE moviles_dia SET activo = true WHERE movil_id = 1 AND fecha = DATE '2026-07-30';
  RAISE NOTICE 'ok inactivo no es servidor';
END $$;

-- 3) es_transito se marca bien.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF NOT r.es_transito THEN RAISE EXCEPTION 'M2 en zona 200 debio marcarse como transito'; END IF;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.es_transito THEN RAISE EXCEPTION 'M2 en zona 100 es prioridad, no transito'; END IF;
  RAISE NOTICE 'ok rol prioridad/transito';
END $$;

-- 4) transito_modo = CASTIGO: al transito se le suman los minutos de desvio.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET transito_modo = 'CASTIGO', transito_castigo_minutos = 20
   WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF round(r.libre_en) IS DISTINCT FROM 35 THEN
    RAISE EXCEPTION 'CASTIGO: libre_en % (esperaba 15 + 20 = 35)', r.libre_en;
  END IF;
  RAISE NOTICE 'ok transito CASTIGO';
END $$;

-- 5) transito_modo = ALPHA: el libre_en se estira dividiendo por alpha.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET transito_modo = 'ALPHA' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF round(r.libre_en) IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'ALPHA: libre_en % (esperaba 15 / 0.3 = 50)', r.libre_en;
  END IF;
  RAISE NOTICE 'ok transito ALPHA';
END $$;

-- 6) transito_modo = SOLO_SI_NO_HAY: M3 (prioridad) se libera a los 50 y M2
--    (transito) a los 15. Con margen 15, la prioridad NO llega dentro del
--    margen del transito (15 + 15 = 30 < 50), asi que el transito entra.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET transito_modo = 'SOLO_SI_NO_HAY', transito_margen_minutos = 15
   WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF r.descartado THEN RAISE EXCEPTION 'con la prioridad a 50 y margen 15, el transito debio entrar'; END IF;

  -- Ahora M3 queda libre ya (le sacamos sus pedidos): 0 <= 15 + 15, entra la
  -- prioridad y el transito sobra.
  DELETE FROM pedidos WHERE movil = 3;
  SELECT * INTO r FROM demoras_servidores(1000, DATE '2026-07-30')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE' AND movil = 2;
  IF NOT r.descartado THEN
    RAISE EXCEPTION 'con una prioridad libre ya, el transito debio quedar descartado';
  END IF;
  RAISE NOTICE 'ok transito SOLO_SI_NO_HAY';
END $$;

UPDATE demoras_modelo SET transito_modo = 'SOLO_SI_NO_HAY', ritmo_metrica = 'ENTRE_ENTREGAS'
 WHERE escenario_id = 1000;
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  --assert scripts/sql-harness/assert-servidores.sql
```

Esperado: `FAIL` con `function demoras_ritmo_movil(...) does not exist`.

- [ ] **Step 3a: Escribir la migración del ritmo por móvil**

Crear `docs/sqls/2026-07-31-demoras-ritmo-movil.sql`:

```sql
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
-- demoras_modelo.ritmo_cascada (se leen solo las entradas CHOFER y MOVIL;
-- ZONA y GLOBAL no aplican a un movil suelto y las resuelve el llamador
-- cayendo a demoras_ritmo):
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
           coalesce((SELECT dm.ritmo_solo_con_cola     FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), false)            AS solo_con_cola,
           coalesce((SELECT dm.ritmo_cascada           FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 'CHOFER,MOVIL')   AS cascada
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
  -- Orden de la cascada, quedandose solo con los niveles que aplican a un
  -- movil. Una lista sin ninguno de los dos cae al default CHOFER,MOVIL.
  niveles AS (
    SELECT coalesce(
             nullif(array_agg(lvl ORDER BY ord) FILTER (WHERE lvl IN ('CHOFER','MOVIL')), '{}'),
             ARRAY['CHOFER','MOVIL']) AS lista
    FROM cfg c,
         LATERAL unnest(string_to_array(upper(c.cascada), ',')) WITH ORDINALITY AS u(lvl_raw, ord),
         LATERAL (SELECT trim(u.lvl_raw) AS lvl) t
  ),
  candidatos AS (
    SELECT pm.movil, pm.tipo, lv.ord, lv.nivel,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.media   ELSE pm.media   END AS media,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.mediana ELSE pm.mediana END AS mediana,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p75     ELSE pm.p75     END AS p75,
           CASE lv.nivel WHEN 'CHOFER' THEN pc.p90     ELSE pm.p90     END AS p90,
           coalesce(CASE lv.nivel WHEN 'CHOFER' THEN pc.n ELSE pm.n END, 0) AS n
    FROM por_movil pm
    CROSS JOIN niveles nv
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
  'Ritmo propio de cada movil por tipo de servicio, con cascada CHOFER -> MOVIL en el orden configurado en demoras_modelo.ritmo_cascada. Existe porque demoras_ritmo devuelve un ritmo por ZONA (los niveles CHOFER y MOVIL ya vienen mezclados en un promedio ponderado), y el modelo del proximo hueco necesita cuanto tarda CADA movil: libre_en = carga x ritmo, y el pedido nuevo va al que se libera primero. Un movil sin muestras suficientes en ningun nivel NO devuelve fila, para que el llamador pueda distinguir "no hay dato" de "hay dato nulo" y caer al ritmo de la zona.';
```

- [ ] **Step 3b: Escribir la migración de los servidores**

Crear `docs/sqls/2026-07-31-demoras-servidores.sql`:

```sql
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
  -- TODOS los tipos. Un asignado cuenta siempre (regla canonica de la
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
  'Tiempo de liberacion de cada movil ACTIVO por (zona, tipo): libre_en = carga x ritmo, con la carga contada en TODAS las zonas porque el movil es un solo camion. Es el punto exacto donde el modelo deja de prorratear: los pedidos ya asignados dicen donde esta el trabajo, no hace falta suponerlo. transito_modo (IGUAL / CASTIGO / ALPHA / SOLO_SI_NO_HAY) decide como compite un movil que en esa zona es de transito; el descartado se devuelve igual con descartado=true para que se pueda auditar por que no se uso. Aproximacion documentada: un movil con pedidos de varios tipos usa el ritmo del tipo que se esta calculando.';
```

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  docs/sqls/2026-07-31-demoras-ritmo-movil.sql \
  docs/sqls/2026-07-31-demoras-servidores.sql \
  --assert scripts/sql-harness/assert-servidores.sql
```

Esperado: los ocho `ok` — los dos del ritmo por móvil (`ok ritmo propio por movil`, `ok movil sin historial no devuelve fila`) más los seis de los servidores. Exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-servidores.sql scripts/sql-harness/assert-servidores.sql
git commit -m "feat(demoras): tiempo de liberacion por movil, sin prorrateo

libre_en = carga x ritmo, con la carga contada en TODAS las zonas del movil.
Es el punto exacto donde el modelo deja de prorratear: repartir un movil
0,77 aca y 0,23 alla es una suposicion sobre donde va a estar, pero los
pedidos ya asignados son evidencia de donde ESTA su trabajo. Aplicar la
suposicion encima de la evidencia cobra el mismo hecho dos veces.

transito_modo hace configurable la decision 8.1, que es la mas jugada del
modelo: un movil de transito esta fisicamente cerca pero esa no es su zona,
y darle el pedido nuevo porque se libera primero promete algo que quiza no
pasa. Las cuatro opciones se resuelven en el backtest, no discutiendo.

Un movil descartado por SOLO_SI_NO_HAY se devuelve igual con
descartado=true: quien audite tiene que poder ver que habia un transito
disponible y por que no se uso."
```

---

### Task 6: `demoras_proximo_hueco` — la simulación

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-proximo-hueco.sql`
- Create: `scripts/sql-harness/assert-hueco.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1), `demoras_cola` (Task 4), `demoras_servidores` (Task 5).
- Produces:
  ```sql
  demoras_proximo_hueco(p_escenario integer, p_fecha date, p_corrida_at timestamptz)
  RETURNS TABLE (zona_id integer, tipo_servicio text, demora_cruda numeric,
                 moviles_considerados integer, libre_primero numeric,
                 cola_por_delante integer, ritmo_aplicado numeric,
                 sin_capacidad boolean)
  ```
  `demora_cruda` es el número **antes** de clamp, suavizado y redondeo — `demoras_acabado` sigue haciendo eso.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-hueco.sql`. Reproduce **el ejemplo de `DEMORA_MODELO.md` § 7.3**, que es el caso que el documento le prometió al usuario:

```sql
\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE escenario_settings SET peso_transito_alpha = 0.3, pedidos_sa_minutos_antes = NULL
 WHERE escenario_id = 1000;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', transito_modo = 'IGUAL',
       incluir_entrega_propia = true, atrapados_modo = 'EXCLUIR',
       estadistico = 'MEDIANA', max_minutos = 120
 WHERE escenario_id = 1000;

-- ─── El ejemplo del documento (DEMORA_MODELO.md 2.5) ─────────────────
-- Centro=100, Costa=200, Cerro=300.
-- M1 prioridad Centro. M2 prioridad Centro + transito Costa.
-- M3 prioridad Costa. M4 prioridad Cerro, NO salio.
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'1',100,'URGENTE',1,true),
       (1000,'2',100,'URGENTE',1,true),
       (1000,'2',200,'URGENTE',2,true),
       (1000,'3',200,'URGENTE',1,true),
       (1000,'4',300,'URGENTE',1,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,1,DATE '2026-07-30',true),
       (1000,2,DATE '2026-07-30',true),
       (1000,3,DATE '2026-07-30',true),
       (1000,4,DATE '2026-07-30',false);   -- M4 no salio

-- Ritmos: M1=20, M2=15, M3=25 (5 hechos c/u para ganar el nivel MOVIL).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 5000 + g*10 + m.movil, 1000, DATE '2026-07-29', 'URGENTE',
       m.movil, m.zona, NULL, now(), m.r, m.r, 'CAMPO'
FROM (VALUES (1,100,20.0),(2,100,15.0),(3,200,25.0)) AS m(movil, zona, r),
     generate_series(1,5) g;

-- Estado a las 14:00: Centro 3 asignados a M1 + 2 sin asignar.
--                     Costa  1 a M2 + 2 a M3, nada sin asignar.
--                     Cerro  1 atrapado con M4 + 3 sin asignar.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (2,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (3,1000,'URGENTE',1,   100,1,DATE '2026-07-30'),
       (4,1000,'URGENTE',NULL,100,1,DATE '2026-07-30'),
       (5,1000,'URGENTE',NULL,100,1,DATE '2026-07-30'),
       (6,1000,'URGENTE',2,   200,1,DATE '2026-07-30'),
       (7,1000,'URGENTE',3,   200,1,DATE '2026-07-30'),
       (8,1000,'URGENTE',3,   200,1,DATE '2026-07-30'),
       (9,1000,'URGENTE',4,   300,1,DATE '2026-07-30'),
      (10,1000,'URGENTE',NULL,300,1,DATE '2026-07-30'),
      (11,1000,'URGENTE',NULL,300,1,DATE '2026-07-30'),
      (12,1000,'URGENTE',NULL,300,1,DATE '2026-07-30');

-- 1) CENTRO = 60. Es el numero que el documento le prometio al usuario.
--    M1 libre a los 60 (3x20), M2 a los 15 (1x15).
--    SA#1 -> M2 (15 < 60), M2 pasa a 30. SA#2 -> M2 (30 < 60), pasa a 45.
--    El nuevo -> M2 a los 45, mas 15 de su propia entrega = 60.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'CENTRO: % (esperaba 60 = 45 de espera + 15 de entrega)', r.demora_cruda;
  END IF;
  IF r.cola_por_delante IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'CENTRO cola: %', r.cola_por_delante; END IF;
  IF round(r.libre_primero) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'CENTRO libre_primero: % (esperaba 15, M2 antes de la cola)', r.libre_primero;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'CENTRO no puede estar sin capacidad'; END IF;
  RAISE NOTICE 'ok CENTRO = 60 (el ejemplo del documento)';
END $$;

-- 2) COSTA = 30. M3 libre a los 50 (2x25), M2 a los 15 (1x15). Sin cola.
--    El nuevo -> M2 a los 15, mas 15 = 30.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 200 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'COSTA: % (esperaba 30)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok COSTA = 30';
END $$;

-- 3) CERRO: ningun movil activo -> sin_capacidad y se informa el techo.
--    El atrapado de M4 no rescata nada.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 300 AND tipo_servicio = 'URGENTE';
  IF NOT r.sin_capacidad THEN RAISE EXCEPTION 'CERRO debio quedar sin capacidad'; END IF;
  IF round(r.demora_cruda) IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'CERRO: % (esperaba el techo, 120)', r.demora_cruda;
  END IF;
  IF r.moviles_considerados <> 0 THEN RAISE EXCEPTION 'CERRO moviles: %', r.moviles_considerados; END IF;
  RAISE NOTICE 'ok CERRO = techo por falta de moviles';
END $$;

-- 4) incluir_entrega_propia = false: la demora llega hasta que SALE el movil.
--    Centro pasa de 60 a 45.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET incluir_entrega_propia = false WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION 'sin entrega propia: % (esperaba 45)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET incluir_entrega_propia = true WHERE escenario_id = 1000;
  RAISE NOTICE 'ok incluir_entrega_propia';
END $$;

-- 5) El pedido nuevo va al PRIMERO que se libera, no al promedio. Le
--    sacamos la cola a Centro: M1 a 60, M2 a 15 -> 15 + 15 = 30, no el
--    promedio de 37,5 + entrega.
DO $$
DECLARE r record;
BEGIN
  DELETE FROM pedidos WHERE id IN (4,5);
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'el minimo sobre servidores: % (esperaba 30, no un promedio)', r.demora_cruda;
  END IF;
  RAISE NOTICE 'ok el primero que se libera, no el promedio';
END $$;

-- 6) factor_calibracion multiplica el crudo.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET factor_calibracion = 2.0 WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'factor 2.0 sobre 30: % (esperaba 60)', r.demora_cruda;
  END IF;
  UPDATE demoras_modelo SET factor_calibracion = 1.0 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok factor_calibracion';
END $$;

-- 7) Una zona con capacidad y cola vacia da el minimo posible, no cero.
--    (El piso duro lo aplica demoras_acabado; aca solo verificamos que el
--    crudo sea el tiempo real y no un 0 enmascarado.)
--    Vaciamos la carga de M2 -el mas rapido, ritmo 15- que vive en la
--    zona 200 (pedido 6), no la de M1: M2 queda libre YA (0) mientras M1
--    sigue ocupado (60, sus 3 pedidos de zona 100 siguen en pie), asi que
--    el minimo no es ambiguo. Vaciar en cambio zona_nro=100 deja a M1 -el
--    mas LENTO, ritmo 20- en 0 y a M2 en 15 (su pedido de zona 200 sigue
--    contando: la carga es global, no por zona): el minimo pasa a ser M1
--    y el resultado da 20, no 15 -- ese fue justamente el bug que este
--    bloque encontro contra la version original del assert.
DO $$
DECLARE r record;
BEGIN
  DELETE FROM pedidos WHERE movil = 2;
  SELECT * INTO r FROM demoras_proximo_hueco(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF round(r.demora_cruda) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'zona vacia: % (esperaba 15 = el ritmo de M2, libre ya)', r.demora_cruda;
  END IF;
  IF r.sin_capacidad THEN RAISE EXCEPTION 'con moviles activos no puede decir sin_capacidad'; END IF;
  RAISE NOTICE 'ok zona con capacidad y cola vacia';
END $$;

TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo SET ritmo_metrica = 'ENTRE_ENTREGAS', transito_modo = 'SOLO_SI_NO_HAY'
 WHERE escenario_id = 1000;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  docs/sqls/2026-07-31-demoras-ritmo-movil.sql \
  docs/sqls/2026-07-31-demoras-servidores.sql \
  --assert scripts/sql-harness/assert-hueco.sql
```

Esperado: `FAIL` con `function demoras_proximo_hueco(...) does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-07-31-demoras-proximo-hueco.sql`:

```sql
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

    -- Reparto de la cola: cada pedido al que se libera primero.
    FOR v_k IN 1 .. z.cola LOOP
      v_idx := 1;
      v_min := v_libres[1];
      FOR v_i IN 2 .. v_n LOOP
        IF v_libres[v_i] < v_min THEN
          v_min := v_libres[v_i];
          v_idx := v_i;
        END IF;
      END LOOP;
      v_libres[v_idx] := v_libres[v_idx] + v_ritmos[v_idx];
    END LOOP;

    -- El pedido nuevo va al que quede libre primero.
    v_idx := 1;
    v_min := v_libres[1];
    FOR v_i IN 2 .. v_n LOOP
      IF v_libres[v_i] < v_min THEN
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
  'Simulacion del proximo hueco por (zona, tipo): reparte los pedidos sin asignar entre los moviles activos, cada uno al que se libera primero, y ubica el pedido nuevo en el primer hueco que queda. La demora es esa espera mas la propia entrega (configurable). Devuelve demora_cruda SIN clamp, suavizado ni redondeo: de eso sigue ocupandose demoras_acabado. El universo sale de moviles_zonas y no de los servidores, para que una zona sin ningun movil activo devuelva fila igual con sin_capacidad=true y el techo, en vez de desaparecer sin dejar nada que auditar. libre_primero es el mejor tiempo de liberacion ANTES de repartir la cola, para poder separar cuanto de la demora es cola y cuanto es trabajo ya encima de los moviles.';
```

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  docs/sqls/2026-07-31-demoras-ritmo-movil.sql \
  docs/sqls/2026-07-31-demoras-servidores.sql \
  docs/sqls/2026-07-31-demoras-proximo-hueco.sql \
  --assert scripts/sql-harness/assert-hueco.sql
```

Esperado, en orden: `ok CENTRO = 60 (el ejemplo del documento)`, `ok COSTA = 30`, `ok CERRO = techo por falta de moviles`, `ok incluir_entrega_propia`, `ok el primero que se libera, no el promedio`, `ok factor_calibracion`, `ok zona con capacidad y cola vacia`. Exit 0.

> **Si CENTRO no da 60, no ajustes el assert.** Ese número está publicado en `docs/DEMORA_MODELO.md` § 7.3 y en la página que vio el usuario. Si el código da otra cosa, el bug está en el código o el documento está mal, y en el segundo caso hay que corregir el documento explícitamente, no en silencio.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-proximo-hueco.sql scripts/sql-harness/assert-hueco.sql
git commit -m "feat(demoras): la simulacion del proximo hueco

Reemplaza pendientes/capacidad por: a que hora queda libre cada movil,
repartir los sin asignar al que se libera primero, y ubicar el pedido nuevo
en el hueco que queda. Resuelve el tercer error estructural del modelo
viejo: a un pedido nuevo no lo atiende el promedio de la zona, lo atiende el
PRIMER movil disponible, y una division no tiene donde expresar un minimo.

El assert reproduce el ejemplo publicado en DEMORA_MODELO.md 7.3: Centro da
60 minutos contra los 120 del modelo viejo, sobre exactamente los mismos
datos. Ese numero esta en el documento y en la pagina que vio el usuario, no
se ajusta el test para que pase.

LOOP en plpgsql porque el reparto es secuencial (cada asignacion cambia
quien es el minimo siguiente); los servidores se agregan a arrays por zona
en UNA pasada y el loop solo toca memoria. Barrido lineal en vez de heap: una
zona real tiene unidades de moviles, no cientos.

El universo sale de moviles_zonas y no de los servidores, para que una zona
sin ningun movil activo devuelva fila con sin_capacidad=true y el techo en
vez de desaparecer: a las 07:00 el 72% de la flota esta inactiva y ese es
justo el caso que hay que poder auditar."
```

---

### Task 7: `demoras_calcular_run` despacha entre los dos modelos

**Files:**
- Create: `docs/sqls/2026-07-31-demoras-calcular-run-v2.sql`
- Create: `scripts/sql-harness/assert-run-v2.sql`
- Modify: `docs/DEMORA_INFORMADA.md` (secciones 1 y 3)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `demoras_calcular_run(p_corrida_at timestamptz DEFAULT now()) RETURNS bigint` — misma firma, comportamiento nuevo. Escribe `demoras_calculadas` con `modelo_version` sellado.

**Esta task también da de baja las columnas migradas de `demoras_config`.** Va acá y no en la Task 1 porque recién ahora nadie las lee.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-run-v2.sql`. **Copiar el setup de `scripts/sql-harness/assert-run.sql`** (mismo escenario base) y agregar estos bloques:

```sql
\set ON_ERROR_STOP on

-- ─── Los dos modelos corren sobre los MISMOS datos ───────────────────
-- Este es el assert que justifica todo el trabajo: el parametro `modelo`
-- tiene que producir numeros distintos, o no sirve para comparar nada.
DO $$
DECLARE v_hueco integer; v_viejo integer; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:00:00-03');
  IF v_n = 0 THEN RAISE EXCEPTION 'PROXIMO_HUECO no escribio ninguna fila'; END IF;
  SELECT demora_informada INTO v_hueco FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:00:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:10:00-03');
  SELECT demora_informada INTO v_viejo FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:10:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';

  IF v_hueco IS NULL OR v_viejo IS NULL THEN
    RAISE EXCEPTION 'falta alguna de las dos corridas: hueco=% viejo=%', v_hueco, v_viejo;
  END IF;
  IF v_hueco = v_viejo THEN
    RAISE EXCEPTION 'los dos modelos dieron lo mismo (%): el parametro no esta despachando', v_hueco;
  END IF;
  UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok los dos modelos dan distinto (hueco=%, viejo=%)', v_hueco, v_viejo;
END $$;

-- ─── El sello de version ─────────────────────────────────────────────
DO $$
DECLARE v_ver integer; v_actual integer; v_n bigint;
BEGIN
  SELECT version INTO v_actual FROM demoras_modelo WHERE escenario_id = 1000;
  v_n := demoras_calcular_run(timestamptz '2026-07-30 14:20:00-03');
  SELECT DISTINCT modelo_version INTO v_ver FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 14:20:00-03';
  IF v_ver IS DISTINCT FROM v_actual THEN
    RAISE EXCEPTION 'modelo_version sellado: % (esperaba %)', v_ver, v_actual;
  END IF;
  RAISE NOTICE 'ok sello de version en cada fila';
END $$;

-- ─── El suavizado se saltea cuando cambia la capacidad ───────────────
-- Corrida 1 sin moviles (techo 120). Se activa un movil. Corrida 2 tiene
-- que poder bajar mas de bajada_max, porque la baja es real.
DO $$
DECLARE v1 integer; v2 integer; v_n bigint;
BEGIN
  UPDATE demoras_modelo SET suavizado_bypass_cambio_capacidad = true, bajada_max = 15
   WHERE escenario_id = 1000;
  UPDATE moviles_dia SET activo = false WHERE escenario_id = 1000 AND fecha = DATE '2026-07-30';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:00:00-03');
  SELECT demora_informada INTO v1 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:00:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v1 IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'sin moviles esperaba 120, dio %', v1; END IF;

  UPDATE moviles_dia SET activo = true
   WHERE escenario_id = 1000 AND movil_id = 2 AND fecha = DATE '2026-07-30';

  v_n := demoras_calcular_run(timestamptz '2026-07-30 15:10:00-03');
  SELECT demora_informada INTO v2 FROM demoras_calculadas
   WHERE corrida_at = timestamptz '2026-07-30 15:10:00-03'
     AND zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF v2 >= 105 THEN
    RAISE EXCEPTION 'con bypass, la baja no debio frenarse en 15 min/corrida: paso de % a %', v1, v2;
  END IF;
  RAISE NOTICE 'ok bypass del suavizado por cambio de capacidad (% -> %)', v1, v2;
END $$;

-- ─── Las columnas de calculo ya no estan en demoras_config ───────────
DO $$
DECLARE v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['min_minutos','max_minutos','escalon_minutos','subida_max',
                               'bajada_max','estadistico','ritmo_cascada',
                               'ritmo_default_minutos','factor_calibracion'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'demoras_config' AND column_name = v_col) THEN
      RAISE EXCEPTION 'demoras_config todavia tiene la columna de calculo %', v_col;
    END IF;
  END LOOP;

  -- Lo operativo SI se queda.
  FOREACH v_col IN ARRAY ARRAY['motor_activo','hora_inicio','hora_fin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'demoras_config' AND column_name = v_col) THEN
      RAISE EXCEPTION 'demoras_config perdio la columna operativa %', v_col;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok reparto de columnas entre las dos tablas';
END $$;

-- ─── El advisory lock (dispara el test de concurrencia del harness) ───
-- El runner busca la cadena advisory_xact_lock en los asserts para decidir
-- si lanza las dos conexiones concurrentes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.proname = 'demoras_calcular_run'
       AND pg_get_functiondef(p.oid) LIKE '%advisory_xact_lock%') THEN
    RAISE EXCEPTION 'demoras_calcular_run perdio el advisory lock';
  END IF;
  RAISE NOTICE 'ok el lock sigue en su lugar';
END $$;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-acabado.sql \
  docs/sqls/2026-07-29-demoras-capacidad.sql \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  docs/sqls/2026-07-31-demoras-ritmo-movil.sql \
  docs/sqls/2026-07-31-demoras-servidores.sql \
  docs/sqls/2026-07-31-demoras-proximo-hueco.sql \
  docs/sqls/2026-07-29-demoras-calcular-run.sql \
  --assert scripts/sql-harness/assert-run-v2.sql
```

Esperado: `FAIL` — la versión vieja de `demoras_calcular_run` no conoce `modelo` ni sella `modelo_version`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-07-31-demoras-calcular-run-v2.sql`:

```sql
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
--     demoras_config queda SOLO con motor_activo, hora_inicio, hora_fin.
--   - Cada fila sella modelo_version.
--   - suavizado_bypass_cambio_capacidad: si cambio la cantidad de moviles
--     activos respecto de la corrida anterior, se pasa p_prev=NULL a
--     demoras_acabado, o sea se saltea el suavizado. La baja que produce un
--     refuerzo que acaba de entrar es real, y frenarla 50 minutos es
--     informar de mas cuando el movil ya esta en la calle.
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
  -- sigue siendo la forma de apagar un tipo sin borrar histórico.
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
      h.demora_cruda     AS hueco_cruda,
      h.sin_capacidad    AS hueco_sin_cap,
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
           CASE WHEN m.modelo = 'PROXIMO_HUECO'
                THEN coalesce(a.hueco_sin_cap, true)
                ELSE (a.capacidad <= 0) END AS sin_cap,
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
      sin_capacidad, clampeado, suavizado_aplicado, modelo_version
    )
    SELECT
      p_corrida_at, v_esc, f.zona_id, f.tipo_servicio,
      f.informada, f.suavizada, round(f.demora_cruda, 2), f.as400,
      f.asignados, f.sin_asignar, f.atrapados,
      f.capacidad, f.mov_act, f.mov_pri, f.mov_tra, f.alpha,
      f.ritmo_media, f.ritmo_mediana, f.ritmo_p75, f.ritmo_p90,
      f.ritmo_usado, f.ritmo_origen, f.ritmo_muestras,
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
  'Motor de demora. Despacha entre PROXIMO_HUECO (simulacion de cola sobre tiempos de liberacion por movil) y CAPACIDAD_PROMEDIO (el modelo viejo) segun demoras_modelo.modelo, escribiendo las MISMAS columnas en los dos casos para poder compararlos. Los parametros del calculo salen de demoras_modelo (una fila por escenario); demoras_config queda solo con lo operativo por tipo (motor_activo, ventana horaria), asi que NOCTURNO conserva su horario propio. Cada fila sella modelo_version para que una corrida vieja se pueda reconstruir. Con suavizado_bypass_cambio_capacidad, un cambio en la cantidad de moviles activos saltea el suavizado: esa variacion es estructural, no ruido.';

-- ─── Baja de las columnas migradas ───────────────────────────────────
-- Recien ahora nadie las lee. Dejarlas seria garantizar que algun dia
-- demoras_config.estadistico y demoras_modelo.estadistico tengan valores
-- distintos y nadie sepa cual manda.
ALTER TABLE demoras_config
  DROP COLUMN IF EXISTS min_minutos,
  DROP COLUMN IF EXISTS max_minutos,
  DROP COLUMN IF EXISTS escalon_minutos,
  DROP COLUMN IF EXISTS subida_max,
  DROP COLUMN IF EXISTS bajada_max,
  DROP COLUMN IF EXISTS estadistico,
  DROP COLUMN IF EXISTS ritmo_cascada,
  DROP COLUMN IF EXISTS ritmo_default_minutos,
  DROP COLUMN IF EXISTS factor_calibracion;

-- El CHECK de rango vivia sobre dos columnas que ya no estan.
ALTER TABLE demoras_config DROP CONSTRAINT IF EXISTS demoras_config_rango;

COMMENT ON TABLE demoras_config IS
  'Configuracion OPERATIVA del motor por (escenario, tipo de servicio): interruptor y ventana horaria. Los parametros del CALCULO viven en demoras_modelo, una fila por escenario. Si falta la fila de un tipo, ese tipo no se calcula.';
```

- [ ] **Step 4: Correr el harness completo y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-acabado.sql \
  docs/sqls/2026-07-29-demoras-capacidad.sql \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  docs/sqls/2026-07-31-demoras-ritmo-movil.sql \
  docs/sqls/2026-07-31-demoras-servidores.sql \
  docs/sqls/2026-07-31-demoras-proximo-hueco.sql \
  docs/sqls/2026-07-31-demoras-calcular-run-v2.sql \
  --assert scripts/sql-harness/assert-run-v2.sql
```

Esperado: `ok los dos modelos dan distinto (hueco=..., viejo=...)`, `ok sello de version en cada fila`, `ok bypass del suavizado por cambio de capacidad`, `ok reparto de columnas entre las dos tablas`, `ok el lock sigue en su lugar`, más `✓ corrida bloqueada rechazada` del test de concurrencia. Exit 0.

- [ ] **Step 5: Correr TODOS los asserts juntos (regresión)**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-acabado.sql \
  docs/sqls/2026-07-29-demoras-capacidad.sql \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-07-31-demoras-ritmo-v2.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  docs/sqls/2026-07-31-demoras-ritmo-movil.sql \
  docs/sqls/2026-07-31-demoras-servidores.sql \
  docs/sqls/2026-07-31-demoras-proximo-hueco.sql \
  docs/sqls/2026-07-31-demoras-calcular-run-v2.sql \
  --assert scripts/sql-harness/assert-acabado.sql \
  --assert scripts/sql-harness/assert-capacidad.sql \
  --assert scripts/sql-harness/assert-modelo.sql \
  --assert scripts/sql-harness/assert-ritmo-muestras.sql \
  --assert scripts/sql-harness/assert-ritmo.sql \
  --assert scripts/sql-harness/assert-cola.sql \
  --assert scripts/sql-harness/assert-servidores.sql \
  --assert scripts/sql-harness/assert-hueco.sql \
  --assert scripts/sql-harness/assert-run-v2.sql
```

Esperado: exit 0.

**`assert-config.sql` queda obsoleto**: afirmaba el `CHECK (hora_fin > hora_inicio)` (que sigue vigente) y los grants (idem), pero también columnas que ya no están. Editarlo para sacar las afirmaciones sobre las columnas migradas y agregarlo a la lista de arriba. **No borrarlo**: el CHECK de ventana horaria y los grants siguen siendo reglas vivas.

- [ ] **Step 6: Actualizar la guía operativa**

En `docs/DEMORA_INFORMADA.md`:
- § 1 — agregar las siete migraciones nuevas a la secuencia, con la advertencia de que el archivo `-calcular-run-v2` va **último** porque borra columnas.
- § 3 — reescribir la tabla de columnas: `demoras_config` queda con tres, y remitir a `demoras_modelo` para el resto.
- § 4 y § 5 — los `UPDATE` de ejemplo que tocan `estadistico`, `ritmo_cascada` o los topes ahora van contra `demoras_modelo` y **sin** `AND tipo_servicio = ...`.
- Sacar el aviso de "modelo en revisión" del encabezado: ya no está en revisión, está implementado.

- [ ] **Step 7: Commit**

```bash
git add docs/sqls/2026-07-31-demoras-calcular-run-v2.sql \
        scripts/sql-harness/assert-run-v2.sql \
        scripts/sql-harness/assert-config.sql \
        docs/DEMORA_INFORMADA.md
git commit -m "feat(demoras): el motor despacha entre proximo hueco y modelo viejo

demoras_modelo.modelo elige cual de los dos calculos corre, y los dos
escriben las MISMAS columnas en demoras_calculadas. Es lo que permite
correrlos sobre los mismos datos y medir la diferencia en vez de discutirla,
que era el punto de parametrizar todo.

Cada fila sella modelo_version: sin eso, cambiar un parametro un martes
vuelve incomparables el lunes y el miercoles sin forma de notarlo mirando la
tabla.

suavizado_bypass_cambio_capacidad: cuando cambia la cantidad de moviles
activos, la variacion es estructural (entro o salio un movil), no ruido, y
se saltea el suavizado pasando prev=NULL. Frenar 50 minutos la baja que
produce un refuerzo es informar de mas cuando el movil ya esta en la calle.

Se dan de baja las columnas de calculo de demoras_config, que quedan solo en
demoras_modelo. Va en esta migracion y no en la primera porque recien ahora
nadie las lee: borrarlas antes dejaba el motor viejo sin las columnas que
lee, fallando callado cada 10 minutos.

demoras_config conserva motor_activo, hora_inicio y hora_fin por tipo, asi
que NOCTURNO mantiene su ventana 18:00-23:30."
```

---

## Autorrevisión del plan

**1. Cobertura de la spec** — recorriendo `docs/DEMORA_MODELO.md`:

| Sección del diseño | Task |
|---|---|
| § 7.1 ritmo de entrega real | 2 |
| § 7.2 pasos 1–3 del cálculo | 5 y 6 |
| § 7.2 paso 4 (terminación) | 7 (reusa `demoras_acabado`, sin cambios) |
| § 7.3 el ejemplo resuelto (60 / 30 / techo) | assert de la 6 |
| § 8.1 tránsito | `transito_modo`, Task 5 |
| § 8.2 vecinas | `vecinas_modo` — **ver hueco abajo** |
| § 8.3 atrapados | `atrapados_modo`, Task 4 |
| § 8.4 suavizado ante cambio de capacidad | Task 7 |
| § 8.5 corte de huecos | Task 2 |
| § 9.1–9.2 inventario de parámetros | Task 1 |
| § 9.4 versionado | Task 1 (tablas) + Task 7 (sello) |
| § 9.5 la pantalla | **Plan 2**, fuera de alcance |
| § 10 backtest | **Plan 3**, fuera de alcance |

**Hueco detectado:** `vecinas_modo` (§ 8.2) se crea como columna en la Task 1 pero **ninguna task lo consume** — `demoras_cola` solo mira la zona propia. Es deliberado y así queda documentado: el diseño recomienda "empezar ignorándolos y medir cuánto se pierde", y `IGNORAR` es el default. Implementar `TODOS` y `PONDERADO` requiere el backtest para decidir si vale la complejidad, así que va al Plan 3. **Corregido:** la Task 1 ya lleva un `COMMENT ON COLUMN` que dice explícitamente que hoy solo `IGNORAR` está implementado y que los otros dos valores no cambian nada. Un parámetro configurable que no hace nada, sin ese aviso, es una trampa para quien lo toque.

**2. Placeholders** — el único `...` del plan está en la Task 3 Step 3, y es una instrucción explícita de copiar un bloque de otro archivo del repo, con la ruta, los límites exactos y el único reemplazo a hacer. Se deja así a propósito: reescribir de memoria 15 CTEs con fixes de una revisión previa es peor que copiarlos.

**3. Consistencia de tipos** — verificado: `demoras_ritmo` devuelve `tipo_servicio` y la Task 5 la joinea por ese nombre; `demoras_cola` y `demoras_proximo_hueco` devuelven `zona_id`/`tipo_servicio` y la Task 7 las joinea así; `demoras_servidores` devuelve `tipo_servicio` y la Task 6 la agrupa por ese nombre. `demoras_acabado` mantiene su firma de 7 parámetros, sin cambios.

---

## Los otros dos planes

Este plan deja el motor calculando con el modelo nuevo, configurable **por SQL**. Faltan dos deliverables independientes entre sí:

- **Plan 2 — Pantalla de parámetros** en Preferencias Globales: editar `demoras_modelo` desde la UI, con los campos que no aplican apagados (`transito_castigo_minutos` no significa nada si el modo no es `CASTIGO`), volver a defaults, y ver el historial de cambios. Es lo que hace real el "cambiarlo a gusto e ir probando".
- **Plan 3 — Backtest**: persistir la carga por móvil en cada corrida (hoy `demoras_calculadas` solo guarda el agregado por zona, así que el pasado no se puede reconstruir), y la herramienta que corre la fórmula contra pedidos reales y la compara con lo que efectivamente tardaron. Es lo que cierra las cuatro decisiones abiertas — incluida `vecinas_modo`.


