# Motor de demora — consumo por tramos · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modelo `PROXIMO_HUECO` por `CONSUMO_TRAMOS`: la capacidad de una zona deja de ser un número fijo y pasa a crecer por escalones a medida que los móviles compartidos terminan sus compromisos fuera de zona, consumiendo la demanda tramo a tramo.

**Architecture:** Siete migraciones SQL en Supabase, sobre la base del motor ya implementado. Se reusan `demoras_acabado` y `demoras_capacidad` sin cambios de fondo; `demoras_ritmo` y `demoras_ritmo_movil` sí cambian (Task 2, fix round 1: pasan a leer `demoras_modelo.ritmo_hueco_min_minutos` y a llamar a `demoras_ritmo_muestras` con el séptimo parámetro — ver `docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql`); se reescriben la cola, los aportes por móvil y la simulación; y el orquestador pasa a recorrer todos los escenarios en vez de tener el 1000 clavado.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql + SQL functions, `pg_cron`, harness Docker (`scripts/sql-harness/run.sh`).

## Global Constraints

- **Spec de referencia: `docs/DEMORA_MODELO_TRAMOS.md`.** Todos los números, nombres de parámetro y reglas salen de ahí. El diagnóstico previo está en `docs/DEMORA_MODELO.md` (secciones 1 a 6) y la guía operativa en `docs/DEMORA_INFORMADA.md`.
- **El Postgres de producción está firewalleado.** Las migraciones se aplican pegándolas en el **SQL Editor de Supabase**, y al final se arma un archivo único (`MOTOR-DEMORA-TODO`) igual que en la tanda anterior.
- **Toda migración es idempotente.** `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS` antes de `ADD`. Un `COMMENT ON COLUMN` sobre una columna que otra migración da de baja **rompe la idempotencia** — hay que guardarlo con `information_schema` (ver `2026-07-29-demoras-calculadas-tabla.sql`).
- **Los cuerpos plpgsql NO se validan al crearse.** Un error de tipo pasa el `CREATE` sin ruido y revienta recién cuando `pg_cron` ejecuta, **fallando en silencio cada 10 minutos**. Toda función nueva o modificada se valida con el harness antes de commitear. No es opcional.
- **Patrón defensivo para leer configuración:** nunca `FROM tabla_config WHERE ...` en un CTE que después se cruza — si falta la fila, el CTE queda vacío y el CROSS JOIN colapsa la función a cero filas. Usar subconsulta escalar o `LEFT JOIN` contra fila sintética.
- **Los asserts tienen que morder.** En la tanda anterior aparecieron cinco que pasaban con la lógica rota. Para cada bloque nuevo hay que correr un mutante que rompa esa lógica y confirmar que el bloque falla ahí.
- **Comentarios SQL sin tildes** (convención del repo). Los `.md` sí llevan tildes.
- Tipos: `URGENTE`, `NOCTURNO`, `SERVICE`. `ESPECIAL` y `OTROS` fuera del motor. Zona horaria `America/Montevideo`; `pg_cron` corre en UTC.
- **El motor está APAGADO en producción** (`motor_activo = false`) mientras dura esta tanda. No hay urgencia de dejarlo consistente entre migraciones, pero la secuencia de aplicación tiene que quedar documentada igual.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `docs/sqls/2026-08-01-demoras-modelo-tramos.sql` | Los 4 parámetros nuevos, el `CHECK` de `modelo`, la baja de los 3 `transito_*` |
| `docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql` | Piso del ritmo (`ritmo_hueco_min_minutos`) |
| `docs/sqls/2026-08-01-demoras-cola-v2.sql` | `Q` incluye los asignados en zona; unión de demanda URGENTE+NOCTURNO |
| `docs/sqls/2026-08-01-demoras-aportes.sql` | `demoras_aportes` — `p_j` con tope, `r_j` con traslado, `μ_j`. Reemplaza a `demoras_servidores` |
| `docs/sqls/2026-08-01-demoras-consumo-tramos.sql` | `demoras_consumo_tramos` — la simulación por tramos |
| `docs/sqls/2026-08-01-demoras-calcular-run-v3.sql` | Despacho + **loop sobre todos los escenarios** |
| `docs/sqls/2026-08-01-MOTOR-DEMORA-TRAMOS-TODO.sql` | El archivo único para pegar en Supabase |

---

### Task 1: Parámetros del modelo nuevo

**Files:**
- Create: `docs/sqls/2026-08-01-demoras-modelo-tramos.sql`
- Create: `scripts/sql-harness/assert-modelo-tramos.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (existente).
- Produces: columnas `dedicacion_transito`, `transito_dedicacion_max_total`, `traslado_fuera_zona_minutos`, `ritmo_hueco_min_minutos`; `modelo` con `CHECK (modelo IN ('CONSUMO_TRAMOS','CAPACIDAD_PROMEDIO'))`; sin `transito_modo`, `transito_castigo_minutos`, `transito_margen_minutos`.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-modelo-tramos.sql`:

```sql
\set ON_ERROR_STOP on

-- 1) Los cuatro parametros nuevos existen con sus defaults.
DO $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM demoras_modelo WHERE escenario_id = 1000;
  IF m.dedicacion_transito           IS DISTINCT FROM 0.20 THEN RAISE EXCEPTION 'dedicacion_transito: %', m.dedicacion_transito; END IF;
  IF m.transito_dedicacion_max_total IS DISTINCT FROM 0.60 THEN RAISE EXCEPTION 'transito_max_total: %', m.transito_dedicacion_max_total; END IF;
  IF m.traslado_fuera_zona_minutos   IS DISTINCT FROM 15   THEN RAISE EXCEPTION 'traslado: %', m.traslado_fuera_zona_minutos; END IF;
  IF m.ritmo_hueco_min_minutos       IS DISTINCT FROM 5    THEN RAISE EXCEPTION 'hueco_min: %', m.ritmo_hueco_min_minutos; END IF;
  IF m.modelo IS DISTINCT FROM 'CONSUMO_TRAMOS' THEN RAISE EXCEPTION 'modelo: %', m.modelo; END IF;
  RAISE NOTICE 'ok parametros nuevos con sus defaults';
END $$;

-- 2) PROXIMO_HUECO ya no es un valor valido: el CHECK lo rechaza.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET modelo = 'PROXIMO_HUECO' WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto PROXIMO_HUECO, que fue retirado';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- CAPACIDAD_PROMEDIO si sigue siendo valido: es contra lo que se compara.
  UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
  UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS'     WHERE escenario_id = 1000;
  RAISE NOTICE 'ok el CHECK de modelo';
END $$;

-- 3) Los CHECK de los parametros nuevos rechazan basura.
DO $$
BEGIN
  BEGIN
    UPDATE demoras_modelo SET dedicacion_transito = 1.5 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto una dedicacion mayor a 1';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET transito_dedicacion_max_total = -0.1 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un tope negativo';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    UPDATE demoras_modelo SET traslado_fuera_zona_minutos = -5 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un traslado negativo';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- El piso del ritmo TIENE que ser menor que el techo, o no queda ninguna
  -- muestra viva y todas las zonas caen al ritmo por defecto en silencio.
  BEGIN
    UPDATE demoras_modelo SET ritmo_hueco_min_minutos = 200 WHERE escenario_id = 1000;
    RAISE EXCEPTION 'acepto un piso del ritmo mayor que el techo (90)';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'ok constraints de los parametros nuevos';
END $$;

-- 4) Los tres parametros de transito_modo se dieron de baja.
DO $$
DECLARE v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['transito_modo','transito_castigo_minutos','transito_margen_minutos'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'demoras_modelo' AND column_name = v_col) THEN
      RAISE EXCEPTION 'demoras_modelo todavia tiene %', v_col;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok los transito_* se dieron de baja';
END $$;

-- 5) El versionado sigue andando sobre las columnas nuevas.
DO $$
DECLARE v0 integer; v1 integer;
BEGIN
  SELECT version INTO v0 FROM demoras_modelo WHERE escenario_id = 1000;
  UPDATE demoras_modelo SET dedicacion_transito = 0.25 WHERE escenario_id = 1000;
  SELECT version INTO v1 FROM demoras_modelo WHERE escenario_id = 1000;
  IF v1 <> v0 + 1 THEN RAISE EXCEPTION 'el trigger no versiono un cambio de parametro nuevo'; END IF;
  IF (SELECT (fila->>'dedicacion_transito')::numeric FROM demoras_modelo_historial
       WHERE escenario_id = 1000 AND version = v0) IS DISTINCT FROM 0.20 THEN
    RAISE EXCEPTION 'el historial no guardo el valor anterior del parametro nuevo';
  END IF;
  UPDATE demoras_modelo SET dedicacion_transito = 0.20 WHERE escenario_id = 1000;
  RAISE NOTICE 'ok versionado sobre los parametros nuevos';
END $$;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  --assert scripts/sql-harness/assert-modelo-tramos.sql
```

Esperado: `FAIL` con `column m.dedicacion_transito does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-08-01-demoras-modelo-tramos.sql`:

```sql
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
-- Se normaliza ANTES de cambiar el CHECK: si quedara alguna fila con el valor
-- viejo, el ADD CONSTRAINT falla y hace rollback de todo el archivo.
UPDATE demoras_modelo SET modelo = 'CONSUMO_TRAMOS' WHERE modelo = 'PROXIMO_HUECO';

ALTER TABLE demoras_modelo DROP CONSTRAINT IF EXISTS demoras_modelo_modelo_check;
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
```

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-08-01-demoras-modelo-tramos.sql \
  --assert scripts/sql-harness/assert-modelo-tramos.sql
```

Esperado: los 5 `ok`, exit 0.

- [ ] **Step 5: Verificar la idempotencia (dos veces seguidas)**

Repetir el comando con `2026-08-01-demoras-modelo-tramos.sql` listado **dos veces**. Esperado exit 0. Es el camino que más se rompe: el `DROP COLUMN` de los `transito_*` seguido de un re-apply.

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-08-01-demoras-modelo-tramos.sql scripts/sql-harness/assert-modelo-tramos.sql
git commit -m "feat(demoras): parametros de CONSUMO_TRAMOS

Cuatro parametros nuevos: la dedicacion de un movil de transito a cada zona
(0.20), el tope de lo que pueden sumar todos sus transitos (0.60, que es lo
que le garantiza el piso de 0.40 a la prioridad), el traslado de vuelta a la
zona (15 min, una sola vez y no por pedido) y el piso del ritmo (5 min).

El piso del ritmo sale de datos reales: el 2026-07-31, 12 de 194 zonas tenian
ritmos menores a 5 minutos y una de 8 segundos -- choferes marcando varias
entregas juntas. El CHECK exige que el piso sea menor que el techo, porque
cruzarlos deja sin muestras a todas las zonas y el motor sigue escribiendo
numeros que no salieron de ningun dato.

Se dan de baja transito_modo, transito_castigo_minutos y
transito_margen_minutos: eran las cuatro maneras de decidir si un transito
entraba a la zona. En CONSUMO_TRAMOS siempre entra, con su fraccion.

PROXIMO_HUECO se retira del CHECK de modelo. Las filas que lo tuvieran se
normalizan ANTES del ADD CONSTRAINT, o el apply entero hace rollback."
```

---

### Task 2: Piso del ritmo

**Files:**
- Create: `docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql`
- Create: `docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql` — **actualiza a los dos llamadores**
- Modify: `scripts/sql-harness/assert-ritmo-muestras.sql` (agregar un bloque al final)
- Modify: `scripts/sql-harness/assert-grants-funciones.sql` (la firma cambió)

**Interfaces:**
- Consumes: `demoras_modelo.ritmo_hueco_min_minutos` (Task 1).
- Produces: `demoras_ritmo_muestras(p_escenario, p_hasta, p_dias, p_metrica, p_hueco_max, p_hueco_min, p_solo_con_cola)` — **la firma gana `p_hueco_min` en la sexta posición**, antes de `p_solo_con_cola`. Hay que `DROP FUNCTION` la de 6 parámetros.

> **Un cambio de firma no está terminado hasta que sus llamadores compilan.**
> `demoras_ritmo` (en `2026-07-31-demoras-ritmo-v2.sql`) y `demoras_ritmo_movil`
> (en `2026-07-31-demoras-ritmo-movil.sql`) llaman a `demoras_ritmo_muestras`
> con **6 argumentos**. Después del `DROP FUNCTION` las dos quedan rotas en
> runtime: `function demoras_ritmo_muestras(integer, date, integer, text,
> integer, boolean) does not exist`.
>
> Y a diferencia del caso de la Task 1 —donde la Task 4 terminaba reemplazando
> a `demoras_servidores`— acá **ninguna task posterior las toca**. La rotura
> sobreviviría hasta que alguien prenda el motor.
>
> Por eso esta task incluye un archivo que **recrea las dos funciones**
> pasándoles el parámetro nuevo, que ya leen de `demoras_modelo` junto al
> `ritmo_hueco_max_minutos`. Es un cambio de una línea en cada una: agregar
> `ritmo_hueco_min_minutos` al CTE `cfg` y pasarlo en la llamada.
>
> `scripts/sql-harness/assert-grants-funciones.sql` también hardcodea la firma
> de 6 argumentos y falla apenas se aplica esta migración. Hay que
> actualizarlo acá, no en la Task 7: dejarlo roto seis tasks vuelve inútil la
> corrida de regresión mientras tanto.

- [ ] **Step 1: Agregar el bloque al assert existente**

Al final de `scripts/sql-harness/assert-ritmo-muestras.sql`, antes del `TRUNCATE` final:

```sql
-- 7) El piso descarta las marcaciones en lote. El fixture del bloque 1 tiene
--    intervalos de 20 y 20; se agregan dos entregas separadas por 1 minuto,
--    que es lo que produce un chofer marcando varias juntas.
DO $$
DECLARE v_con integer; v_sin integer;
BEGIN
  INSERT INTO metricas_cumplimiento
    (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
     fch_hora_asignado, fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
  VALUES
    ('PEDIDO', 90, 1000, DATE '2026-07-28', 'URGENTE', 30, 100, 'ANA',
     timestamptz '2026-07-28 14:00:00-03', timestamptz '2026-07-28 14:30:00-03', 30, 30, 'CAMPO'),
    ('PEDIDO', 91, 1000, DATE '2026-07-28', 'URGENTE', 30, 100, 'ANA',
     timestamptz '2026-07-28 14:00:00-03', timestamptz '2026-07-28 14:31:00-03', 31, 31, 'CAMPO');

  -- Sin piso (0): el intervalo de 1 minuto entra.
  SELECT count(*) INTO v_sin FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, 0, false)
   WHERE movil = 30;
  IF v_sin <> 1 THEN RAISE EXCEPTION 'sin piso esperaba 1 muestra del movil 30, dio %', v_sin; END IF;

  -- Con piso 5: el intervalo de 1 minuto se descarta.
  SELECT count(*) INTO v_con FROM demoras_ritmo_muestras(1000, DATE '2026-07-29', 7, 'ENTRE_ENTREGAS', 90, 5, false)
   WHERE movil = 30;
  IF v_con <> 0 THEN RAISE EXCEPTION 'con piso 5 el intervalo de 1 min no debio entrar, dio % muestras', v_con; END IF;

  RAISE NOTICE 'ok piso del ritmo (1 min entra con piso 0, no entra con piso 5)';
END $$;
```

**Ojo:** los bloques 1 a 6 que ya existen llaman a la función con **6 argumentos**. Hay que agregarles el `0` del piso en la sexta posición para que sigan compilando. Es un cambio mecánico: `..., 90, false)` pasa a `..., 90, 0, false)`. **No cambiar ningún otro valor de esos bloques** — sus números esperados siguen siendo los mismos con piso 0.

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  --assert scripts/sql-harness/assert-ritmo-muestras.sql
```

Esperado: `FAIL` — la función de 6 parámetros no acepta 7.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql`. Es el archivo `2026-07-31-demoras-ritmo-muestras.sql` con tres cambios:

1. Un `DROP FUNCTION IF EXISTS demoras_ritmo_muestras(integer, date, integer, text, integer, boolean);` al principio — sin eso, las dos firmas conviven y una llamada de 7 argumentos no matchea la vieja pero **la de 6 sí sigue existiendo y la puede llamar código viejo**, quedando dos comportamientos vivos.
2. `p_hueco_min integer` en la firma, entre `p_hueco_max` y `p_solo_con_cola`.
3. En el `WHERE` de la rama `ENTRE_ENTREGAS`, agregar `AND i.mins >= p_hueco_min`.

El resto —la CTE `hechos`, la de `intervalos` con su `PARTITION BY` por fecha local, la rama `ASIGNADO_A_ENTREGA` y el `COMMENT`— se copia **textual** del archivo del 2026-07-31. **No reescribir de memoria**: la partición por día local y el manejo de `fch_hora_asignado` NULL son fixes de revisiones anteriores.

Actualizar el `COMMENT ON FUNCTION` para que mencione el piso y por qué existe (las marcaciones en lote medidas en producción).

- [ ] **Step 4: Correr el harness y verificar que pasa**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-31-demoras-ritmo-muestras.sql \
  docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql \
  --assert scripts/sql-harness/assert-ritmo-muestras.sql
```

Aplicar la vieja y después la nueva es el caso real. Esperado: los 7 `ok`, exit 0. Si da `is not unique`, falta el `DROP FUNCTION`.

- [ ] **Step 5: Verificar que el bloque nuevo muerde**

Correr el harness contra una copia de la migración **sin** el `AND i.mins >= p_hueco_min`. El bloque 7 tiene que fallar. Si pasa, no protege nada.

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql scripts/sql-harness/assert-ritmo-muestras.sql
git commit -m "feat(demoras): piso del ritmo contra las marcaciones en lote

El corte de huecos solo miraba para arriba (almuerzo, recarga). Los datos de
produccion del 2026-07-31 mostraron el problema de abajo: 12 de 194 zonas con
ritmos menores a 5 minutos y una de 0.13 -- ocho segundos por entrega. No son
moviles rapidos, son choferes marcando varias entregas juntas en el AS400.

Sin piso, esos intervalos casi nulos arrastran la mediana del movil hacia
abajo, lo hacen parecer instantaneo y la zona informa de menos.

La firma gana p_hueco_min y se dropea la de 6 argumentos: dejarlas conviviendo
mantiene dos comportamientos vivos, porque la vieja sigue siendo llamable."
```

---

### Task 3: La cola incluye los asignados en zona, y une urgente con nocturno

**Files:**
- Create: `docs/sqls/2026-08-01-demoras-cola-v2.sql`
- Modify: `scripts/sql-harness/assert-cola.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1).
- Produces: `demoras_cola(p_escenario, p_fecha, p_corrida_at)` con la misma firma y las mismas columnas, pero **`cola_efectiva` cambia de significado**: ahora es `sin_asignar + asignados_en_zona` (+ atrapados según `atrapados_modo`), y la demanda de URGENTE y NOCTURNO se suma entre sí.

- [ ] **Step 1: Reescribir el assert**

En `scripts/sql-harness/assert-cola.sql`, **los bloques 1 y 4 cambian de valor esperado** (antes `cola_efectiva` no incluía los asignados) y hay que agregar dos bloques nuevos. Reemplazar los bloques 2 y 3 por:

```sql
-- 2) cola_efectiva AHORA incluye los asignados en zona. Con 3 asignados
--    (2 al movil activo + 1 atrapado, que se excluye) y 4 sin asignar:
--    2 + 4 = 6.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'cola_efectiva %: esperaba 6 = 4 sin asignar + 2 asignados al movil activo (el atrapado se excluye)', r.cola_efectiva;
  END IF;
  RAISE NOTICE 'ok la cola incluye los asignados en zona';
END $$;

-- 3) atrapados_modo = COMO_SIN_ASIGNAR: el atrapado tambien entra -> 7.
DO $$
DECLARE r record;
BEGIN
  UPDATE demoras_modelo SET atrapados_modo = 'COMO_SIN_ASIGNAR' WHERE escenario_id = 1000;
  SELECT * INTO r FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  IF r.cola_efectiva IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'COMO_SIN_ASIGNAR: cola_efectiva % (esperaba 7)', r.cola_efectiva;
  END IF;
  UPDATE demoras_modelo SET atrapados_modo = 'EXCLUIR' WHERE escenario_id = 1000;
  RAISE NOTICE 'ok atrapados COMO_SIN_ASIGNAR';
END $$;
```

Y agregar al final, antes del `TRUNCATE`:

```sql
-- 6) URGENTE y NOCTURNO unen la demanda: un nocturno de la zona tiene que
--    aparecer en la cola de URGENTE y viceversa. Un SERVICE no.
DO $$
DECLARE r_urg record; r_noc record; r_srv record;
BEGIN
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (30, 1000, 'NOCTURNO', NULL, 100, 1, DATE '2026-07-30'),
         (31, 1000, 'NOCTURNO', NULL, 100, 1, DATE '2026-07-30');
  INSERT INTO services (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (32, 1000, 'SERVICE', NULL, 100, 1, DATE '2026-07-30');

  SELECT * INTO r_urg FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'URGENTE';
  SELECT * INTO r_noc FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'NOCTURNO';
  SELECT * INTO r_srv FROM demoras_cola(1000, DATE '2026-07-30', timestamptz '2026-07-30 14:00:00-03')
   WHERE zona_id = 100 AND tipo_servicio = 'SERVICE';

  -- Los 2 nocturnos se suman a los 6 que ya habia.
  IF r_urg.cola_efectiva IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'URGENTE debio sumar los 2 nocturnos: cola % (esperaba 8)', r_urg.cola_efectiva;
  END IF;
  IF r_noc.cola_efectiva IS DISTINCT FROM r_urg.cola_efectiva THEN
    RAISE EXCEPTION 'NOCTURNO y URGENTE deben ver la MISMA demanda: % vs %', r_noc.cola_efectiva, r_urg.cola_efectiva;
  END IF;
  -- SERVICE no se mezcla: solo su propio pedido.
  IF r_srv.cola_efectiva IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SERVICE no debe mezclarse: cola % (esperaba 1)', r_srv.cola_efectiva;
  END IF;
  RAISE NOTICE 'ok urgente+nocturno unen demanda, service no';
END $$;
```

- [ ] **Step 2: Correr el harness y verificar que falla**

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-31-demoras-modelo-tabla.sql \
  docs/sqls/2026-08-01-demoras-modelo-tramos.sql \
  docs/sqls/2026-07-31-demoras-cola.sql \
  --assert scripts/sql-harness/assert-cola.sql
```

Esperado: `FAIL` en el bloque 2 — la versión vieja da 4, no 6.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-08-01-demoras-cola-v2.sql`. Partir de `2026-07-31-demoras-cola.sql` y cambiar dos cosas:

**a) El pool de tipos.** Agregar una CTE que expanda cada tipo a los tipos cuya demanda le corresponde:

```sql
  -- URGENTE y NOCTURNO son equivalentes a los efectos de la demanda: un movil
  -- haciendo un nocturno esta igual de ocupado que si hiciera un urgente. Los
  -- MOVILES no se unen (eso lo resuelve demoras_aportes, que sale de
  -- moviles_zonas por tipo), pero la cola si.
  pool AS (
    SELECT 'URGENTE'::text  AS tipo_calculado, unnest(ARRAY['URGENTE','NOCTURNO']) AS tipo_pedido
    UNION ALL
    SELECT 'NOCTURNO',       unnest(ARRAY['URGENTE','NOCTURNO'])
    UNION ALL
    SELECT 'SERVICE',        'SERVICE'
  ),
```

y agregar el `pool` al agregado final, agrupando por `tipo_calculado`.

**b) `cola_efectiva` incluye los asignados en zona:**

```sql
         (a.sin_asignar
          + a.asignados_activos                    -- NUEVO: los que ya tienen movil ACA
          + CASE c.atrapados_modo
              WHEN 'EXCLUIR' THEN 0
              ELSE a.atrapados
            END)::integer AS cola_efectiva
```

donde `asignados_activos = asignados - atrapados` (los asignados a un móvil que sí salió). **Es el cambio conceptual central de esta task:** esos pedidos son demanda de la zona, no de su móvil, y por eso `demoras_aportes` (Task 4) **no** los va a contar en el tiempo de liberación. Contarlos en los dos lugares sería el doble conteo que este modelo vino a evitar.

Actualizar el `COMMENT ON FUNCTION` explicando el cambio de significado de `cola_efectiva` y la unión de la demanda.

- [ ] **Step 4: Correr el harness y verificar que pasa**

Mismo comando del Step 2 más `docs/sqls/2026-08-01-demoras-cola-v2.sql`. Esperado: los 6 `ok`.

- [ ] **Step 5: Verificar que los bloques nuevos muerden**

Dos mutantes: uno que saque `asignados_activos` del `cola_efectiva` (tiene que romper el bloque 2), y otro que deje el `pool` como identidad —cada tipo consigo mismo— (tiene que romper el bloque 6).

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-08-01-demoras-cola-v2.sql scripts/sql-harness/assert-cola.sql
git commit -m "feat(demoras): la cola incluye los asignados en zona y une urgente con nocturno

Dos cambios que vienen de la spec del consumo por tramos.

1. cola_efectiva pasa a incluir los pedidos ya asignados a un movil DENTRO de
   la zona. Antes estaban clavados a su movil y entraban por su tiempo de
   liberacion; ahora son demanda de la ZONA. En la calle el despacho
   reacomoda, asi que clavarlos no es fiel. demoras_aportes deja de contarlos
   en el tiempo de liberacion, para que no se cuenten dos veces.

2. URGENTE y NOCTURNO unen su demanda: un movil haciendo un nocturno esta
   igual de ocupado que si hiciera un urgente. Los MOVILES no se unen -- cada
   tipo usa los que tiene habilitados en moviles_zonas -- asi que los dos
   tipos pueden dar numeros distintos aunque vean la misma cola. SERVICE no
   se mezcla con ninguno."
```

---

### Task 4: `demoras_aportes` — cuánto y desde cuándo aporta cada móvil

**Files:**
- Create: `docs/sqls/2026-08-01-demoras-aportes.sql`
- Create: `scripts/sql-harness/assert-aportes.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1), `demoras_ritmo` y `demoras_ritmo_movil`. **Actualizado (Task 7):** no quedaron "sin cambios" — el fix round 1 de la Task 2 las recreó en `docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql` para que pasaran el piso del ritmo (`ritmo_hueco_min_minutos`) a `demoras_ritmo_muestras`. La Task 4 las sigue consumiendo con la misma firma `(integer, date)`, así que no hay ruptura de interfaz para esta task.
- Produces:
  ```sql
  demoras_aportes(p_escenario integer, p_fecha date)
  RETURNS TABLE (zona_id integer, tipo_servicio text, movil integer,
                 es_transito boolean, p_j numeric, ritmo numeric,
                 ritmo_origen text, carga_fuera integer,
                 r_j numeric, mu_j numeric)
  ```
  Una fila por (zona, tipo, móvil **activo**). `r_j` en minutos desde ahora; `mu_j` en pedidos por minuto.

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-aportes.sql`. Los casos que tiene que cubrir, cada uno con números calculados a mano:

```sql
\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, metricas_cumplimiento;
UPDATE demoras_modelo
   SET ritmo_metrica = 'ASIGNADO_A_ENTREGA', dedicacion_transito = 0.20,
       transito_dedicacion_max_total = 0.60, traslado_fuera_zona_minutos = 15,
       estadistico = 'MEDIANA'
 WHERE escenario_id = 1000;

-- M1: prioridad en 100. Nada mas -> p_j = 1,00
-- M2: prioridad en 100, transito en 200 -> 0,80 en 100 y 0,20 en 200
-- M3: prioridad en 100, transito en 200/300/400/500 -> los 4 transitos suman
--     0,80 > 0,60, se achican a 0,15 c/u; la prioridad queda con 0,40
INSERT INTO moviles_zonas (escenario_id, movil_id, zona_id, tipo_de_servicio, prioridad_o_transito, activa)
VALUES (1000,'1',100,'URGENTE',1,true),
       (1000,'2',100,'URGENTE',1,true), (1000,'2',200,'URGENTE',2,true),
       (1000,'3',100,'URGENTE',1,true), (1000,'3',200,'URGENTE',2,true),
       (1000,'3',300,'URGENTE',2,true), (1000,'3',400,'URGENTE',2,true),
       (1000,'3',500,'URGENTE',2,true);

INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000,1,DATE '2026-08-01',true),(1000,2,DATE '2026-08-01',true),(1000,3,DATE '2026-08-01',true);

-- Ritmo propio: los tres a 20 min (5 hechos c/u para ganar el nivel MOVIL).
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 100 + g*10 + m, 1000, DATE '2026-07-31', 'URGENTE', m, 100, NULL,
       now(), 20.0, 20.0, 'CAMPO'
FROM generate_series(1,3) m, generate_series(1,5) g;

-- Carga: M1 tiene 2 pedidos EN la zona 100 (no cuentan para r_j);
--        M2 tiene 3 pedidos en la zona 200 (fuera -> si cuentan).
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (1,1000,'URGENTE',1,100,1,DATE '2026-08-01'),
       (2,1000,'URGENTE',1,100,1,DATE '2026-08-01'),
       (3,1000,'URGENTE',2,200,1,DATE '2026-08-01'),
       (4,1000,'URGENTE',2,200,1,DATE '2026-08-01'),
       (5,1000,'URGENTE',2,200,1,DATE '2026-08-01');
```

Los bloques de aserción:

1. **`p_j` del móvil exclusivo** — M1 en zona 100 → `1,00`.
2. **`p_j` con un tránsito** — M2: `0,80` en 100 y `0,20` en 200.
3. **`p_j` con el tope activo** — M3: sus 4 tránsitos darían `0,80`, se achican a `0,15` cada uno para sumar `0,60`, y la prioridad queda en `0,40`. **Este es el bloque que prueba el tope.**
4. **`r_j` no cuenta los pedidos de la propia zona** — M1 tiene 2 pedidos en la zona 100, así que su `r_j` en la zona 100 tiene que ser **0**, no 40. Es el cambio central respecto del modelo anterior.
5. **`r_j` cuenta los de afuera más el traslado** — M2 en la zona 100 tiene 3 pedidos en la 200: `3 × 20 + 15 = 75`.
6. **El traslado se suma una sola vez** — bajarlo a 0 y verificar que `r_j` de M2 pasa de 75 a 60. Con `traslado = 30`, tiene que dar 90 (no 3 × 30).
7. **Un móvil sin nada afuera no paga traslado** — `r_j` de M1 sigue en 0 con cualquier traslado configurado.
8. **`mu_j` = `p_j / ritmo`** — M2 en la zona 100: `0,80 / 20 = 0,04`.
9. **Un móvil inactivo no aparece.**

- [ ] **Step 2: Correr el harness y verificar que falla**

Esperado: `function demoras_aportes(...) does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-08-01-demoras-aportes.sql`:

```sql
-- =====================================================================
-- demoras_aportes — cuanto y desde cuando aporta cada movil a cada zona
-- Fecha: 2026-08-01 | Idempotente
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md seccion 2
--
-- Reemplaza a demoras_servidores. La diferencia de fondo: aquella calculaba
-- "a que hora queda libre este movil" contando TODA su carga; esta calcula
-- dos cosas separadas:
--
--   r_j   cuando entra a aportar a ESTA zona = lo que tiene FUERA de la zona,
--         mas el traslado de vuelta (una sola vez).
--   mu_j  cuanto aporta una vez adentro = su dedicacion a la zona dividida
--         por su ritmo, en pedidos por minuto.
--
-- Los pedidos que el movil tiene DENTRO de la zona NO entran en r_j: son
-- demanda de la zona y los cuenta demoras_cola. Contarlos en los dos lados
-- seria el doble conteo que este modelo vino a evitar.
--
-- El reparto de p_j (spec seccion 2):
--   1. Cada zona de transito se lleva dedicacion_transito.
--   2. Si la suma de los transitos del movil pasa
--      transito_dedicacion_max_total, se achican TODOS a prorrata.
--   3. Las zonas de prioridad se reparten lo que queda, en partes iguales.
-- Asi la prioridad nunca baja de (1 - tope) por mas zonas de transito que
-- se le agreguen al movil.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_aportes(p_escenario integer, p_fecha date)
RETURNS TABLE (
  zona_id       integer,
  tipo_servicio text,
  movil         integer,
  es_transito   boolean,
  p_j           numeric,
  ritmo         numeric,
  ritmo_origen  text,
  carga_fuera   integer,
  r_j           numeric,
  mu_j          numeric
)
LANGUAGE sql
STABLE
AS $fn$
  WITH cfg AS (
    -- Subconsultas escalares y no FROM: si falta la fila del escenario, un
    -- FROM deja el CTE vacio y los CROSS JOIN de abajo colapsan la funcion a
    -- cero filas.
    SELECT coalesce((SELECT dm.dedicacion_transito           FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 0.20) AS ded,
           coalesce((SELECT dm.transito_dedicacion_max_total FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 0.60) AS tope,
           coalesce((SELECT dm.traslado_fuera_zona_minutos   FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 15)   AS traslado,
           coalesce((SELECT dm.estadistico                   FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 'MEDIANA') AS estadistico,
           coalesce((SELECT dm.ritmo_default_minutos         FROM demoras_modelo dm WHERE dm.escenario_id = p_escenario), 30)::numeric AS ritmo_defecto
  ),
  asign AS (
    SELECT mz.zona_id, mz.tipo_de_servicio AS tipo, mz.movil_id::integer AS movil,
           (mz.prioridad_o_transito <> 1) AS es_transito
    FROM moviles_zonas mz
    JOIN moviles_dia md
      ON md.movil_id = mz.movil_id::integer AND md.escenario_id = mz.escenario_id AND md.fecha = p_fecha
    WHERE mz.escenario_id = p_escenario
      AND coalesce(mz.activa, true) AND md.activo
      AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
  ),
  -- Cuantas zonas de cada clase tiene el movil DENTRO de este tipo.
  conteo AS (
    SELECT movil, tipo,
           count(*) FILTER (WHERE es_transito)::numeric     AS n_tra,
           count(*) FILTER (WHERE NOT es_transito)::numeric AS n_pri
    FROM asign GROUP BY movil, tipo
  ),
  -- El reparto. suma_tra es lo que se llevan TODOS los transitos juntos,
  -- topeado; lo que queda se lo reparten las prioridades.
  reparto AS (
    SELECT c.movil, c.tipo, c.n_tra, c.n_pri,
           least(c.n_tra * cf.ded, cf.tope) AS suma_tra
    FROM conteo c CROSS JOIN cfg cf
  ),
  pj AS (
    SELECT a.zona_id, a.tipo, a.movil, a.es_transito,
           CASE
             WHEN a.es_transito THEN
               CASE WHEN r.n_tra > 0 THEN round(r.suma_tra / r.n_tra, 4) ELSE 0 END
             ELSE
               CASE WHEN r.n_pri > 0 THEN round((1 - r.suma_tra) / r.n_pri, 4) ELSE 0 END
           END AS p_j
    FROM asign a
    JOIN reparto r ON r.movil = a.movil AND r.tipo = a.tipo
  ),
  -- Carga FUERA de la zona: todo lo que el movil tiene pendiente en OTRAS
  -- zonas, de CUALQUIER tipo. El movil es un solo camion y un service lo
  -- ocupa igual que un urgente.
  carga_total AS (
    SELECT p.movil, p.zona_nro, count(*)::integer AS n
    FROM (
      SELECT movil, zona_nro FROM pedidos
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
      UNION ALL
      SELECT movil, zona_nro FROM services
       WHERE escenario = p_escenario AND estado_nro = 1
         AND movil IS NOT NULL AND movil <> 0 AND zona_nro IS NOT NULL
         AND COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date) = p_fecha
    ) p
    GROUP BY p.movil, p.zona_nro
  ),
  rit_zona AS (
    SELECT r.zona_id, r.tipo_servicio, r.ritmo_media, r.ritmo_mediana, r.ritmo_p75, r.ritmo_p90
    FROM demoras_ritmo(p_escenario, p_fecha) r
  ),
  rit_movil AS (
    SELECT m.movil, m.tipo_servicio, m.ritmo_media, m.ritmo_mediana, m.ritmo_p75, m.ritmo_p90
    FROM demoras_ritmo_movil(p_escenario, p_fecha) m
  )
  SELECT
    pj.zona_id, pj.tipo, pj.movil, pj.es_transito, pj.p_j,
    rr.ritmo, rr.origen,
    coalesce(cf_out.n, 0)::integer AS carga_fuera,
    -- r_j: lo de afuera por su ritmo, mas el traslado UNA sola vez. Un movil
    -- sin nada afuera entra en el minuto cero y no paga traslado.
    CASE WHEN coalesce(cf_out.n, 0) = 0 THEN 0
         ELSE round(coalesce(cf_out.n,0) * rr.ritmo + c.traslado, 2) END AS r_j,
    CASE WHEN rr.ritmo > 0 THEN round(pj.p_j / rr.ritmo, 6) ELSE 0 END AS mu_j
  FROM pj
  CROSS JOIN cfg c
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(ct.n), 0) AS n
    FROM carga_total ct
    WHERE ct.movil = pj.movil AND ct.zona_nro <> pj.zona_id
  ) cf_out ON true
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        CASE c.estadistico WHEN 'MEDIA' THEN rm.ritmo_media WHEN 'P75' THEN rm.ritmo_p75
                           WHEN 'P90'  THEN rm.ritmo_p90    ELSE rm.ritmo_mediana END,
        CASE c.estadistico WHEN 'MEDIA' THEN rz.ritmo_media WHEN 'P75' THEN rz.ritmo_p75
                           WHEN 'P90'  THEN rz.ritmo_p90    ELSE rz.ritmo_mediana END,
        c.ritmo_defecto) AS ritmo,
      CASE
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rm.ritmo_media WHEN 'P75' THEN rm.ritmo_p75
                                 WHEN 'P90'  THEN rm.ritmo_p90    ELSE rm.ritmo_mediana END) IS NOT NULL THEN 'MOVIL'
        WHEN (CASE c.estadistico WHEN 'MEDIA' THEN rz.ritmo_media WHEN 'P75' THEN rz.ritmo_p75
                                 WHEN 'P90'  THEN rz.ritmo_p90    ELSE rz.ritmo_mediana END) IS NOT NULL THEN 'ZONA'
        ELSE 'DEFECTO'
      END AS origen
    FROM (SELECT 1) x
    LEFT JOIN rit_movil rm ON rm.movil   = pj.movil   AND rm.tipo_servicio = pj.tipo
    LEFT JOIN rit_zona  rz ON rz.zona_id = pj.zona_id AND rz.tipo_servicio = pj.tipo
  ) rr ON true;
$fn$;

COMMENT ON FUNCTION demoras_aportes(integer, date) IS
  'Cuanto y desde cuando aporta cada movil activo a cada (zona, tipo). r_j = lo que tiene FUERA de la zona por su ritmo, mas el traslado de vuelta una sola vez; los pedidos que tiene DENTRO de la zona NO entran, son demanda de la zona y los cuenta demoras_cola. mu_j = p_j / ritmo, en pedidos por minuto. p_j reparte: cada transito se lleva dedicacion_transito, el conjunto de transitos se topea en transito_dedicacion_max_total achicandolos a prorrata, y las prioridades se reparten el resto -- asi la prioridad nunca baja de (1 - tope). Reemplaza a demoras_servidores.';
```

- [ ] **Step 4: Correr el harness y verificar que pasa** — los 9 `ok`.

- [ ] **Step 5: Verificar que muerden** — mutantes para: sacar el `least(...)` del tope (rompe el bloque 3), sacar el `<> pj.zona_id` del cálculo de carga fuera (rompe el 4), y multiplicar el traslado por la carga (rompe el 6).

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-08-01-demoras-aportes.sql scripts/sql-harness/assert-aportes.sql
git commit -m "feat(demoras): aportes por movil, con dedicacion topeada y traslado

Reemplaza a demoras_servidores. La diferencia de fondo: aquella calculaba
cuando queda libre un movil contando TODA su carga; esta separa dos cosas.

r_j es cuando entra a aportar a ESTA zona: solo lo que tiene afuera, mas el
traslado de vuelta una sola vez. Los pedidos que el movil tiene DENTRO de la
zona ya no cuentan aca -- son demanda de la zona y los cuenta demoras_cola.
Contarlos en los dos lados era el doble conteo que el modelo vino a evitar.

mu_j es cuanto aporta una vez adentro, en pedidos por minuto: su dedicacion
dividida por su ritmo.

El reparto de p_j topea el conjunto de transitos y les da a las prioridades
lo que queda, de modo que la prioridad nunca baja de (1 - tope). Sin el tope,
un movil con cinco zonas de transito dejaba su propia zona de prioridad en
cero -- justo donde mas corresponde que aporte."
```

---

### Task 5: `demoras_consumo_tramos` — la simulación

**Files:**
- Create: `docs/sqls/2026-08-01-demoras-consumo-tramos.sql`
- Create: `scripts/sql-harness/assert-tramos.sql`

**Interfaces:**
- Consumes: `demoras_modelo` (Task 1), `demoras_cola` (Task 3), `demoras_aportes` (Task 4).
- Produces:
  ```sql
  demoras_consumo_tramos(p_escenario integer, p_fecha date, p_corrida_at timestamptz)
  RETURNS TABLE (zona_id integer, tipo_servicio text, demora_cruda numeric,
                 moviles_considerados integer, cola_por_delante integer,
                 capacidad_inicial numeric, capacidad_final numeric,
                 tramos integer, sin_capacidad boolean)
  ```

- [ ] **Step 1: Escribir el assert**

Crear `scripts/sql-harness/assert-tramos.sql`. **El bloque principal reproduce el ejemplo publicado en `docs/DEMORA_MODELO_TRAMOS.md` § 4**: 20 pedidos pendientes, cuatro móviles con ritmo 10, liberaciones en 0 / 15 / 60 / 90 y dedicación 0,50 → **117 minutos**.

Para que la dedicación dé exactamente 0,50 hay que armar el fixture con `dedicacion_transito = 0.50`: tres móviles con una prioridad en otra zona y un tránsito en la zona A no da 0,50 con el reparto por defecto. **La forma correcta de montarlo:** que cada compartido tenga **dos zonas de prioridad** (la A y otra), lo que reparte `1,00 / 2 = 0,50` sin depender del parámetro de tránsito. Así el assert prueba la aritmética de los tramos, no el reparto —que ya lo cubre la Task 4— y el número publicado se reproduce exacto.

Los bloques:

1. **El ejemplo publicado → 117.** Verificar `demora_cruda` redondeada, más `tramos = 4` y `capacidad_final = 0,25`.
2. **La progresión de los tramos.** Verificar `capacidad_inicial = 0,10`.
3. **No esperar al último.** Con el mismo fixture pero forzando que los tres compartidos se liberen todos a los 90 (misma capacidad final, distinta progresión), el resultado tiene que ser **mayor** que 117 — que es la comparación 117 contra 138 de la spec.
4. **Zona sin ningún móvil activo** → `sin_capacidad = true` y el techo.
5. **Todos ocupados afuera** → `sin_capacidad = false` y una demora finita: hay quien va a venir. **Este es el bloque que atrapa la división por cero.**
6. **Zona vacía** → `Q = 1`, la demora es lo que tarda la capacidad en hacer ese uno.
7. **`factor_calibracion`** multiplica el crudo.
8. **Empate en la liberación**: dos móviles que se liberan en el mismo minuto entran los dos en el mismo tramo — verificar que `tramos` cuenta uno solo, no dos.

- [ ] **Step 2: Correr el harness y verificar que falla.**

- [ ] **Step 3: Escribir la migración**

Crear `docs/sqls/2026-08-01-demoras-consumo-tramos.sql`:

```sql
-- =====================================================================
-- demoras_consumo_tramos — la simulacion
-- Fecha: 2026-08-01 | Idempotente
--
-- Spec: docs/DEMORA_MODELO_TRAMOS.md seccion 3
--
-- La demanda de la zona se consume a una velocidad que AUMENTA cada vez que
-- un movil termina lo que tenia en otras zonas. El pedido nuevo se entrega
-- cuando esa demanda, incluyendolo a el, llega a cero.
--
-- Lo importante es el "cada vez": si un movil se libera a los 15, otro a los
-- 60 y otro a los 90, NO hay que esperar al de 90 para empezar a contar. Ese
-- error -esperar al ultimo- es la diferencia entre 117 y 138 minutos sobre el
-- mismo dato.
--
-- Reemplaza a demoras_proximo_hueco, que asignaba la cola pedido por pedido
-- al primer movil libre y no podia expresar una dedicacion parcial continua.
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_consumo_tramos(
  p_escenario  integer,
  p_fecha      date,
  p_corrida_at timestamptz
)
RETURNS TABLE (
  zona_id              integer,
  tipo_servicio        text,
  demora_cruda         numeric,
  moviles_considerados integer,
  cola_por_delante     integer,
  capacidad_inicial    numeric,
  capacidad_final      numeric,
  tramos               integer,
  sin_capacidad        boolean
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  c        record;
  z        record;
  v_q      numeric;
  v_t      numeric;
  v_mu     numeric;
  v_proc   numeric;
  v_tramo  numeric;
  v_listo  boolean;
  v_i      integer;
BEGIN
  SELECT coalesce(dm.max_minutos, 120)::numeric    AS max_min,
         coalesce(dm.factor_calibracion, 1.0)      AS factor
    INTO c
    FROM (SELECT p_escenario AS e) x
    LEFT JOIN demoras_modelo dm ON dm.escenario_id = x.e;

  -- UNA SOLA llamada a demoras_aportes para toda la corrida, agregada por
  -- (zona, tipo) en arrays paralelos. El loop de abajo solo toca memoria.
  --
  -- Esto NO es una optimizacion prematura: demoras_aportes llama por dentro a
  -- la cascada del ritmo, que escanea las ~168.000 entregas del historico y
  -- calcula percentiles. Llamarla adentro del loop serian 106 zonas x 3 tipos
  -- x 3 llamadas = 954 ejecuciones POR ESCENARIO. Medido: entre 50 y 477 ms
  -- cada una, o sea entre 48 segundos y 7,5 minutos por escenario, contra los
  -- 265 ms que tarda hoy una corrida completa. Con el cron cada 10 minutos y
  -- varios escenarios, el motor no llega a terminar antes del disparo
  -- siguiente y el advisory lock empieza a rechazar corridas.
  --
  -- Es el mismo patron que ya usaba demoras_proximo_hueco y que su revision
  -- valido.
  --
  -- Los eventos vienen YA AGRUPADOS por r_j: dos moviles que se liberan en el
  -- mismo minuto entran en el MISMO tramo. Sin ese GROUP BY un empate abriria
  -- dos tramos, el segundo de duracion cero -- no cambia el resultado, pero
  -- ensucia el conteo de tramos que se persiste para auditoria.
  FOR z IN
    -- MATERIALIZED es obligatorio, no cosmetico: desde Postgres 12 un CTE
    -- referenciado una sola vez se inlinea, y este se referencia TRES veces
    -- (capacidad inicial, conteo de moviles, eventos). Sin la palabra, el
    -- planner puede evaluar demoras_aportes una vez por referencia, y cada
    -- evaluacion escanea las ~168.000 entregas del historico para la cascada
    -- del ritmo. Con MATERIALIZED se evalua UNA vez por escenario.
    WITH ap AS MATERIALIZED (
      SELECT a.zona_id, a.tipo_servicio, a.r_j, a.mu_j
      FROM demoras_aportes(p_escenario, p_fecha) a
    ),
    -- Capacidad de arranque: los que ya estan adentro (r_j <= 0).
    ini AS (
      SELECT zona_id, tipo_servicio, sum(mu_j) AS mu
      FROM ap WHERE r_j <= 0
      GROUP BY zona_id, tipo_servicio
    ),
    -- Cuantos moviles considera la zona en total (para auditoria).
    tot AS (
      SELECT zona_id, tipo_servicio, count(*) AS n
      FROM ap GROUP BY zona_id, tipo_servicio
    ),
    -- Los eventos de liberacion, agrupados por minuto y en orden. El GROUP BY
    -- por r_j es lo que hace que dos moviles que se liberan en el mismo minuto
    -- entren en el MISMO tramo: aca el empate no necesita desempate, se suman
    -- las capacidades.
    ev AS (
      SELECT zona_id, tipo_servicio,
             array_agg(r  ORDER BY r) AS rs,
             array_agg(mu ORDER BY r) AS mus
      FROM (
        SELECT zona_id, tipo_servicio, r_j AS r, sum(mu_j) AS mu
        FROM ap WHERE r_j > 0
        GROUP BY zona_id, tipo_servicio, r_j
      ) g
      GROUP BY zona_id, tipo_servicio
    )
    -- El universo sale de moviles_zonas y NO de los aportes: una zona sin
    -- ningun movil activo tiene que devolver fila igual, con sin_capacidad y
    -- el techo. A las 07:00 el 72% de la flota esta inactiva y ese es justo
    -- el caso que hay que poder auditar.
    SELECT u.zona_id, u.tipo,
           coalesce(q.cola_efectiva, 0)             AS cola,
           coalesce(ini.mu, 0)                      AS mu_inicial,
           coalesce(tot.n, 0)                       AS n_moviles,
           coalesce(ev.rs,  ARRAY[]::numeric[])     AS rs,
           coalesce(ev.mus, ARRAY[]::numeric[])     AS mus
    FROM (
      SELECT DISTINCT mz.zona_id, mz.tipo_de_servicio AS tipo
      FROM moviles_zonas mz
      WHERE mz.escenario_id = p_escenario
        AND coalesce(mz.activa, true)
        AND mz.tipo_de_servicio IN ('URGENTE','NOCTURNO','SERVICE')
    ) u
    LEFT JOIN demoras_cola(p_escenario, p_fecha, p_corrida_at) q
           ON q.zona_id = u.zona_id AND q.tipo_servicio = u.tipo
    LEFT JOIN ini ON ini.zona_id = u.zona_id AND ini.tipo_servicio = u.tipo
    LEFT JOIN tot ON tot.zona_id = u.zona_id AND tot.tipo_servicio = u.tipo
    LEFT JOIN ev  ON ev.zona_id  = u.zona_id AND ev.tipo_servicio  = u.tipo
  LOOP
    -- Q incluye el pedido que entra ahora.
    v_q     := z.cola + 1;
    v_t     := 0;
    v_listo := false;
    tramos  := 0;
    v_mu    := z.mu_inicial;

    moviles_considerados := z.n_moviles;
    capacidad_inicial    := round(v_mu, 6);

    FOR v_i IN 1 .. coalesce(array_length(z.rs, 1), 0) LOOP
      v_tramo := z.rs[v_i] - v_t;
      v_proc  := v_tramo * v_mu;

      -- Con capacidad cero no se procesa nada y no se puede dividir: se
      -- avanza al evento y listo. Es el caso "todos ocupados afuera".
      IF v_mu > 0 AND v_q <= v_proc THEN
        demora_cruda := round((v_t + v_q / v_mu) * c.factor, 2);
        v_listo := true;
        EXIT;
      END IF;

      v_q     := v_q - v_proc;
      v_t     := z.rs[v_i];
      v_mu    := v_mu + z.mus[v_i];
      tramos  := tramos + 1;
    END LOOP;

    capacidad_final := round(v_mu, 6);

    IF NOT v_listo THEN
      IF v_mu <= 0 THEN
        -- Nadie ahora y nadie por venir: la respuesta honesta no es "poco".
        demora_cruda  := c.max_min;
        sin_capacidad := true;
      ELSE
        demora_cruda  := round((v_t + v_q / v_mu) * c.factor, 2);
        sin_capacidad := false;
      END IF;
    ELSE
      sin_capacidad := false;
    END IF;

    zona_id          := z.zona_id;
    tipo_servicio    := z.tipo;
    cola_por_delante := z.cola;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION demoras_consumo_tramos(integer, date, timestamptz) IS
  'Simulacion por tramos: la demanda de la zona se consume a una velocidad que aumenta cada vez que un movil termina lo que tenia afuera. Devuelve demora_cruda SIN clamp, suavizado ni redondeo (de eso se ocupa demoras_acabado). El universo sale de moviles_zonas y no de los aportes, para que una zona sin ningun movil activo devuelva fila con sin_capacidad y el techo en vez de desaparecer. Dos moviles que se liberan en el mismo minuto entran en el mismo tramo: aca el empate no necesita desempate, se suman las capacidades. Reemplaza a demoras_proximo_hueco.';
```

> **Al implementador — dos cosas sobre este bloque.**
>
> **La estructura de una sola pasada no es negociable.** `demoras_aportes` se
> llama una vez por escenario, desde el `FROM` del loop, y el recorrido de
> tramos toca solo arrays en memoria. Llamarla adentro del loop —que es lo
> natural de escribir— serían 954 ejecuciones por escenario, cada una
> escaneando las 168.000 entregas del histórico: entre 48 segundos y 7,5
> minutos por escenario, contra los 265 ms que tarda hoy una corrida completa.
> Si te resulta más legible moverla adentro, **no lo hagas**.
>
> **Medí igual y reportá.** Armá el fixture más grande que puedas (idealmente
> ~100 zonas × 3 tipos con historial) y poné en el reporte el tiempo real de
> una corrida completa de `demoras_consumo_tramos`. Es el número que necesito
> para saber si con varios escenarios entra en los 10 minutos del cron.

- [ ] **Step 4: Correr el harness** — los 8 `ok`. **Si el ejemplo publicado no da 117, no ajustes el assert:** ese número está en la spec que aprobó el usuario. Devolvé `BLOCKED` con el diagnóstico.

- [ ] **Step 5: Verificar que muerden** — mutantes para: no sumar la capacidad al avanzar de tramo (rompe el 1 y el 3), y arrancar con capacidad cero ignorando los `r_j = 0` (rompe el 2).

- [ ] **Step 6: Commit** con el mensaje que explique la sustitución y el 117 contra 138.

---

### Task 6: El orquestador, con todos los escenarios

**Files:**
- Create: `docs/sqls/2026-08-01-demoras-calcular-run-v3.sql`
- Create: `scripts/sql-harness/assert-run-v3.sql`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `demoras_calcular_run(p_corrida_at timestamptz DEFAULT now()) RETURNS bigint` — misma firma. Ahora **recorre todos los escenarios con fila en `demoras_modelo`** y despacha entre `CONSUMO_TRAMOS` y `CAPACIDAD_PROMEDIO`.

- [ ] **Step 1: Escribir el assert**

Partir de `scripts/sql-harness/assert-run-v2.sql` y agregar:

1. **Dos escenarios configurados, los dos se calculan.** Sembrar `demoras_modelo` y `demoras_config` para el 1000 y para un 2000, con datos en los dos, y verificar que una corrida escribe filas de ambos. **Es el bloque que prueba que se fue el 1000 clavado** — con un mutante que lo reponga, tiene que fallar.
2. **Un escenario sin fila en `demoras_modelo` no se calcula**, aunque tenga `demoras_config`.
3. **Los dos modelos siguen dando distinto** sobre los mismos datos.
4. **Las columnas de auditoría** del modelo nuevo se persisten con `CONSUMO_TRAMOS` y quedan NULL con `CAPACIDAD_PROMEDIO`.
5. **`sin_capacidad` no diverge entre modelos** (el hallazgo Critical de la tanda anterior: tiene que describir el estado del mundo, `mov_act <= 0`, no el atajo interno de cada modelo).
6. **El advisory lock** sigue en su lugar — el assert tiene que contener la cadena `advisory_xact_lock` para que el runner lance el test de concurrencia.
7. **El lock cubre todos los escenarios**: una corrida solapada no debe escribir ninguno, no "algunos sí y otros no".

- [ ] **Step 2 a 6:** mismo ciclo. La migración parte de `2026-07-31-demoras-calcular-run-v2.sql` con estos cambios:

- **El `v_esc integer := 1000` se va.** Un `FOR v_esc IN SELECT escenario_id FROM demoras_modelo ORDER BY escenario_id LOOP ... END LOOP` envuelve todo el cuerpo, acumulando en `v_escritas`.
- **El advisory lock queda AFUERA del loop**, tomado una sola vez al principio: serializa la corrida entera, no escenario por escenario.
- `demoras_cola` → v2, `demoras_servidores` → `demoras_aportes`, `demoras_proximo_hueco` → `demoras_consumo_tramos`.
- Las columnas de auditoría que se persisten pasan a ser las del modelo nuevo (`capacidad_inicial`, `capacidad_final`, `tramos`, `cola_por_delante`) — hay que agregarlas con `ADD COLUMN IF NOT EXISTS` y dar de baja las de `PROXIMO_HUECO` (`ritmo_aplicado`, `libre_primero`, `moviles_considerados` se conserva).
- El `COMMENT ON FUNCTION` actualizado.

> **Cuidado con el volumen.** Con N escenarios la tabla de hechos se multiplica por N. Verificá que el índice `idx_demoras_calc_esc_zona_tipo_at` siga sirviendo para la CTE `prev`, que ahora filtra por escenario dentro del loop.

---

### Task 7: Documentación y archivo único

**Files:**
- Modify: `docs/DEMORA_INFORMADA.md`
- Create: `docs/sqls/2026-08-01-MOTOR-DEMORA-TRAMOS-TODO.sql`
- Modify: `scripts/sql-harness/assert-config.sql` si quedó desactualizado

- [ ] **Step 1:** Actualizar `DEMORA_INFORMADA.md`: la secuencia de aplicación con los archivos nuevos, la sección de parámetros con los cuatro nuevos y los tres que se van, la de cómo volver atrás (`modelo = 'CAPACIDAD_PROMEDIO'`), y el aviso de que ahora se calculan todos los escenarios.
- [ ] **Step 2:** Generar el archivo único con el mismo patrón que `2026-07-31-MOTOR-DEMORA-TODO.sql`: chequeo de `pg_cron` primero, apagado del motor, las migraciones en orden, encendido al final, y las consultas de verificación comentadas.
- [ ] **Step 3:** **Validar el archivo único aplicándolo COMO UN SOLO SCRIPT** en el harness, y después **dos veces seguidas** para confirmar la idempotencia. En la tanda anterior esa segunda prueba encontró que el archivo no era idempotente y que su propia instrucción de recuperación estaba rota.
- [ ] **Step 4:** Correr la **regresión completa** con todos los asserts juntos.
- [ ] **Step 5:** Commit.

---

## Autorrevisión del plan

**Cobertura de la spec:**

| Sección de `DEMORA_MODELO_TRAMOS.md` | Task |
|---|---|
| § 2 · Q | 3 |
| § 2 · r_j y el traslado | 4 |
| § 2 · ritmo y su piso | 2 |
| § 2 · p_j y el tope | 4 |
| § 3 · el algoritmo | 5 |
| § 4 · el ejemplo (117) | assert de la 5 |
| § 5 · urgente + nocturno | 3 |
| § 6 · parámetros | 1 |
| § 7 · casos de borde | assert de la 5 |
| § 8 · todos los escenarios | 6 |
| § 9 · backtest | fuera de alcance — plan aparte |

**Placeholders:** el único bloque que se copia de otro archivo es la Task 2 Step 3, con la ruta, los tres cambios exactos y la instrucción de no reescribir de memoria.

**Consistencia de tipos:** `demoras_cola` conserva su firma y columnas; `demoras_aportes` devuelve `tipo_servicio` y la Task 5 la filtra por ese nombre; `demoras_consumo_tramos` devuelve `zona_id`/`tipo_servicio` como las anteriores, así que el orquestador la joinea igual. `demoras_acabado` no cambia.

**Defecto corregido antes de ejecutar.** La primera versión de la Task 5
llamaba a `demoras_aportes` **tres veces por zona dentro del loop**. Como esa
función escanea por dentro las ~168.000 entregas del histórico para la cascada
del ritmo, eso son 954 ejecuciones por escenario: entre 48 segundos y 7,5
minutos, contra los 265 ms que tarda hoy una corrida. Con el cron cada 10
minutos y varios escenarios, el motor no termina antes del disparo siguiente y
el advisory lock empieza a rechazar corridas.

Lo llamativo es que **la versión anterior ya lo tenía resuelto**:
`demoras_proximo_hueco` materializaba los servidores en arrays en una sola
pasada, justamente por esto, y su revisión lo validó. Al reescribir la
simulación se perdió ese patrón. Está corregido: una sola llamada por
escenario, desde el `FROM` del loop, y el recorrido de tramos sobre arrays en
memoria — con una nota explícita al implementador de que no lo mueva adentro
aunque le parezca más legible.

**Riesgo que queda vivo:** el volumen con N escenarios. La tabla de hechos se
multiplica por la cantidad de escenarios (de 4,5 a 22 millones de filas en
régimen con cinco departamentos) y el tiempo de corrida también. Por eso la
Task 5 pide **medir y reportar** el tiempo real de una corrida completa.
