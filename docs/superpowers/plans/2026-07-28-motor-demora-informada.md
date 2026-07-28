# Motor de demora informada — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular cada 10 minutos, por (zona, tipo de servicio), la demora que
correspondería informar, guardarla con sus insumos y compararla contra la que
informa el AS400.

**Architecture:** Todo el cálculo vive en Postgres como funciones SQL puras
disparadas por `pg_cron` — sin endpoint HTTP, sin token (el camino del endpoint
ya demostró dar 504 en nginx). Se descompone en tres funciones auxiliares
independientes y testeables (`demoras_acabado`, `demoras_capacidad`,
`demoras_ritmo`) que un orquestador (`demoras_calcular_run`) combina. La lectura
para la UI es un endpoint Next que consume una RPC.

**Tech Stack:** PostgreSQL 15 (Supabase self-hosted), pg_cron, Next.js 16,
TypeScript, Recharts 3.10, vitest.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md`.
- **El DDL NO se puede aplicar desde acá.** El Postgres (192.168.2.26:5432) está
  firewalleado: solo llega REST por 443. Toda migración se entrega como archivo
  `.sql` para pegar en el SQL Editor de Supabase Studio.
- **Toda migración SQL se valida antes en Postgres 15 local con Docker**, con el
  harness de la Task 1. Los cuerpos `plpgsql` NO se validan al crearlos — hay que
  **ejecutar** las funciones con datos o los errores no aparecen.
- Tipos de servicio válidos: exactamente `URGENTE`, `NOCTURNO`, `SERVICE`.
- Móvil activo = `moviles_dia.activo = true` (ya equivale a `estado_nro NOT IN (3,5,15)`).
- Zona activa = `demoras.activa = true` para la fila `descripcion='URGENTE'` de esa zona.
- Timezone de negocio: `America/Montevideo`. `pg_cron` corre en UTC.
- Las migraciones nuevas van a `docs/sqls/` con prefijo de fecha `2026-07-29-`.
- Gate de config: `x-track-isroot = 'S'` **o** funcionalidad `Preferencias Globales`.
- Escenario de trabajo: 1000.
- Commits en español, sin tildes en el subject (convención del repo).

---

### Task 1: Harness de validación en Docker

Todas las tasks de SQL dependen de esto. Crea un Postgres 15 descartable con
tablas stub que replican producción, para poder ejecutar las migraciones de
verdad antes de tocar Supabase.

**Files:**
- Create: `scripts/sql-harness/00-stubs.sql`
- Create: `scripts/sql-harness/run.sh`

**Interfaces:**
- Consumes: nada.
- Produces: `scripts/sql-harness/run.sh <archivo.sql> [<assert.sql>...]` — levanta
  el contenedor `pgharness`, aplica los stubs, aplica los `.sql` en orden con
  `--single-transaction`, corre los asserts y devuelve exit ≠ 0 si algo falla.

- [ ] **Step 1: Crear los stubs**

`scripts/sql-harness/00-stubs.sql`:

```sql
-- Réplica mínima del estado de producción para validar migraciones.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

CREATE TABLE app_config (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
);

CREATE TABLE escenario_settings (
  escenario_id INTEGER PRIMARY KEY,
  peso_transito_alpha NUMERIC(3,2) NOT NULL DEFAULT 0.3,
  nombre TEXT
);
INSERT INTO escenario_settings (escenario_id, peso_transito_alpha, nombre)
VALUES (1000, 0.3, 'Escenario 1000');

CREATE TABLE zonas (
  zona_id INTEGER, escenario_id INTEGER, nombre TEXT, activa BOOLEAN,
  PRIMARY KEY (zona_id, escenario_id)
);

CREATE TABLE demoras (
  demora_id BIGSERIAL PRIMARY KEY,
  escenario_id INTEGER, zona_id INTEGER, zona_tipo TEXT,
  descripcion TEXT, minutos INTEGER, activa BOOLEAN, zona_nombre TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE moviles_zonas (
  id BIGSERIAL PRIMARY KEY,
  movil_id TEXT, zona_id INTEGER, escenario_id INTEGER,
  tipo_de_zona TEXT, tipo_de_servicio TEXT,
  prioridad_o_transito INTEGER, activa BOOLEAN DEFAULT true
);

CREATE TABLE moviles_dia (
  escenario_id INTEGER, movil_id INTEGER, fecha DATE,
  estado_nro INTEGER, activo BOOLEAN NOT NULL DEFAULT false,
  oculto_operativo BOOLEAN NOT NULL DEFAULT false,
  pedidos_pendientes INTEGER DEFAULT 0, services_pendientes INTEGER DEFAULT 0,
  tamano_lote INTEGER, empresa_fletera_id INTEGER,
  PRIMARY KEY (escenario_id, movil_id, fecha)
);

CREATE TABLE pedidos (
  id BIGINT, escenario INTEGER, servicio_nombre TEXT, movil INTEGER,
  zona_nro INTEGER, empresa_fletera_id INTEGER, fletero TEXT,
  fch_hora_asignado TIMESTAMPTZ, fch_hora_finalizacion TIMESTAMPTZ,
  fch_hora_para TIMESTAMPTZ, fch_hora_max_ent_comp TIMESTAMPTZ,
  demora_movil_desde_asignacion_mins NUMERIC,
  estado_nro INTEGER, sub_estado_nro INTEGER, orden_cancelacion TEXT,
  fch_para TEXT,
  PRIMARY KEY (id, escenario)
);
CREATE TABLE services (LIKE pedidos INCLUDING ALL);

CREATE TABLE metricas_cumplimiento (
  origen TEXT NOT NULL, pedido_id BIGINT NOT NULL, escenario INTEGER NOT NULL,
  fecha DATE NOT NULL, tipo_servicio TEXT NOT NULL, servicio_nombre TEXT,
  movil INTEGER, zona_nro INTEGER, empresa_fletera_id INTEGER, chofer TEXT,
  fch_hora_asignado TIMESTAMPTZ, fch_hora_finalizacion TIMESTAMPTZ NOT NULL,
  fch_hora_para TIMESTAMPTZ, fch_hora_max_ent_comp TIMESTAMPTZ,
  demora_mins NUMERIC NOT NULL, demora_efectiva_mins NUMERIC NOT NULL,
  atraso_vs_para_mins NUMERIC, atraso_vs_compromiso_mins NUMERIC,
  reloj_inicio TEXT NOT NULL DEFAULT 'ASIGNADO', asignado_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (origen, pedido_id, escenario)
);
```

- [ ] **Step 2: Crear el runner**

`scripts/sql-harness/run.sh`:

```bash
#!/usr/bin/env bash
# Valida migraciones SQL contra un Postgres 15 descartable.
# Uso: scripts/sql-harness/run.sh migracion1.sql [migracion2.sql ...] --assert assert.sql
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C=pgharness

MIGS=(); ASSERTS=(); MODE=mig
for a in "$@"; do
  if [ "$a" = "--assert" ]; then MODE=assert; continue; fi
  if [ "$MODE" = mig ]; then MIGS+=("$a"); else ASSERTS+=("$a"); fi
done

docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -e POSTGRES_PASSWORD=test postgres:15 >/dev/null
for _ in $(seq 1 30); do docker exec $C pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done

echo "── stubs"
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < "$HERE/00-stubs.sql"

for m in "${MIGS[@]}"; do
  echo "── migracion: $m"
  docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < "$m"
done

FAIL=0
for t in "${ASSERTS[@]:-}"; do
  [ -z "$t" ] && continue
  echo "── assert: $t"
  docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 < "$t" || FAIL=1
done

docker rm -f $C >/dev/null 2>&1 || true
exit $FAIL
```

- [ ] **Step 3: Verificar que el harness arranca**

Run: `bash scripts/sql-harness/run.sh`
Expected: imprime `── stubs` y termina con exit 0, sin errores.

- [ ] **Step 4: Commit**

```bash
git add scripts/sql-harness
git commit -m "chore(sql): harness de validacion de migraciones en Postgres local

Los cuerpos plpgsql no se validan al crearlos: los errores solo saltan al
invocar la funcion. Este harness levanta un Postgres 15 descartable con
tablas stub, aplica las migraciones en una transaccion (igual que el SQL
Editor de Supabase) y corre asserts que EJECUTAN las funciones."
```

---

### Task 2: Función `demoras_acabado` — clamp, suavizado y redondeo

La unidad más importante y la más fácil de equivocar. Se aísla para poder
testearla exhaustivamente sin datos de negocio.

**Files:**
- Create: `docs/sqls/2026-07-29-demoras-acabado.sql`
- Create: `scripts/sql-harness/assert-acabado.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `demoras_acabado(p_crudo numeric, p_prev numeric, p_min int, p_max int, p_subida int, p_bajada int, p_escalon int)` → `TABLE(suavizada numeric, informada integer, clampeado text, suavizado_aplicado boolean)`.
  `p_prev` NULL = primera corrida del día (no suaviza).

- [ ] **Step 1: Escribir el assert que falla**

`scripts/sql-harness/assert-acabado.sql`:

```sql
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION chk(desc_ text, got anyelement, want anyelement) RETURNS void AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALLO %: obtuvo % esperaba %', desc_, got, want;
  END IF;
  RAISE NOTICE 'ok %', desc_;
END $$ LANGUAGE plpgsql;

-- clamp inferior
SELECT chk('clamp min', (SELECT informada FROM demoras_acabado(5, NULL, 30,120,30,15,15)), 30);
SELECT chk('clamp min marca', (SELECT clampeado FROM demoras_acabado(5, NULL, 30,120,30,15,15)), 'MIN'::text);
-- clamp superior
SELECT chk('clamp max', (SELECT informada FROM demoras_acabado(999, NULL, 30,120,30,15,15)), 120);
-- redondeo hacia arriba
SELECT chk('31 -> 45', (SELECT informada FROM demoras_acabado(31, 31, 30,120,30,15,15)), 45);
SELECT chk('45 exacto queda 45', (SELECT informada FROM demoras_acabado(45, 45, 30,120,30,15,15)), 45);
-- sin previo, no suaviza
SELECT chk('sin previo', (SELECT suavizada FROM demoras_acabado(100, NULL, 30,120,30,15,15)), 100::numeric);
SELECT chk('sin previo no marca', (SELECT suavizado_aplicado FROM demoras_acabado(100, NULL, 30,120,30,15,15)), false);
-- suavizado: sube como maximo +30
SELECT chk('sube tope 30', (SELECT suavizada FROM demoras_acabado(120, 30, 30,120,30,15,15)), 60::numeric);
-- suavizado: baja como maximo -15
SELECT chk('baja tope 15', (SELECT suavizada FROM demoras_acabado(30, 120, 30,120,30,15,15)), 105::numeric);
-- movimiento menor al tope pasa entero
SELECT chk('sube 10 pasa', (SELECT suavizada FROM demoras_acabado(40, 30, 30,120,30,15,15)), 40::numeric);

-- Secuencia PICO FALSO de la spec: crudo 30,120,60,60,45 -> informa 30,60,60,60,45
DO $$
DECLARE prev numeric := NULL; crudos numeric[] := ARRAY[30,120,60,60,45];
        esperado int[] := ARRAY[30,60,60,60,45]; r record; i int;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM demoras_acabado(crudos[i], prev, 30,120,30,15,15);
    IF r.informada <> esperado[i] THEN
      RAISE EXCEPTION 'pico falso paso %: obtuvo % esperaba %', i, r.informada, esperado[i];
    END IF;
    prev := r.suavizada;
  END LOOP;
  RAISE NOTICE 'ok secuencia pico falso';
END $$;

-- Secuencia CONGESTION REAL: crudo 30,120,120,120,120 -> informa 30,60,90,120,120
DO $$
DECLARE prev numeric := NULL; crudos numeric[] := ARRAY[30,120,120,120,120];
        esperado int[] := ARRAY[30,60,90,120,120]; r record; i int;
BEGIN
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM demoras_acabado(crudos[i], prev, 30,120,30,15,15);
    IF r.informada <> esperado[i] THEN
      RAISE EXCEPTION 'congestion paso %: obtuvo % esperaba %', i, r.informada, esperado[i];
    END IF;
    prev := r.suavizada;
  END LOOP;
  RAISE NOTICE 'ok secuencia congestion real';
END $$;
```

- [ ] **Step 2: Correr el assert para verificar que falla**

Run: `bash scripts/sql-harness/run.sh --assert scripts/sql-harness/assert-acabado.sql`
Expected: FALLA con `function demoras_acabado(...) does not exist`.

- [ ] **Step 3: Escribir la función**

`docs/sqls/2026-07-29-demoras-acabado.sql`:

```sql
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
  -- la config es editable en caliente (demora_min_minutos, demora_max_minutos),
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
```

- [ ] **Step 4: Correr el assert para verificar que pasa**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-acabado.sql --assert scripts/sql-harness/assert-acabado.sql`
Expected: todos los `ok ...` y exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-29-demoras-acabado.sql scripts/sql-harness/assert-acabado.sql
git commit -m "feat(demoras): funcion de acabado (clamp + suavizado asimetrico + redondeo)

Devuelve dos numeros: la suavizada continua, que es el estado que arrastra
a la proxima corrida, y la informada redondeada, que es la salida. Sin esa
separacion el redondeo se come los incrementos chicos y la serie se atasca.

Validada en Postgres local con las dos secuencias de la spec: el pico falso
nunca informa el 120, y la congestion real llega a la verdad en 30 minutos."
```

**Fix round 1 (2026-07-28):** Hallazgo Important: el redondeo no tenia piso, solo techo. La config es editable en caliente (demora_min_minutos), asi que si p_prev queda por debajo del piso, la informada se cuele tambien. Arreglado: `greatest(p_min, least(p_max, ...))`. Aprobado por usuario.

---

### Task 3: Función `demoras_capacidad` — prorrateo de móviles activos

**Files:**
- Create: `docs/sqls/2026-07-29-demoras-capacidad.sql`
- Create: `scripts/sql-harness/assert-capacidad.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `demoras_capacidad(p_escenario int, p_fecha date)` → `TABLE(zona_id int, tipo_servicio text, capacidad_efectiva numeric, moviles_activos int, moviles_prioridad int, moviles_transito int, alpha_usado numeric)`.

- [ ] **Step 1: Escribir el assert que falla**

`scripts/sql-harness/assert-capacidad.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia;

-- Movil 10: activo, 1 zona prioridad (100) + 3 de transito (101,102,103), URGENTE.
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('10', 100, 1000, 'URGENTE', 1),
  ('10', 101, 1000, 'URGENTE', 2),
  ('10', 102, 1000, 'URGENTE', 2),
  ('10', 103, 1000, 'URGENTE', 2),
-- Movil 20: INACTIVO, tambien en zona 100. No debe aportar nada.
  ('20', 100, 1000, 'URGENTE', 1);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 10, DATE '2026-07-29', true),
  (1000, 20, DATE '2026-07-29', false);

-- alpha=0.3 -> W = 1 + 0.3*3 = 1.9 ; zona 100 recibe 1/1.9 = 0.5263
DO $$
DECLARE v numeric;
BEGIN
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF round(v,4) <> 0.5263 THEN RAISE EXCEPTION 'zona prioridad: obtuvo % esperaba 0.5263', round(v,4); END IF;
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=101 AND tipo_servicio='URGENTE';
  IF round(v,4) <> 0.1579 THEN RAISE EXCEPTION 'zona transito: obtuvo % esperaba 0.1579', round(v,4); END IF;
  RAISE NOTICE 'ok prorrateo';
END $$;

-- El total de las 4 zonas suma ~1 movil (tolerancia por residuo de redondeo).
-- Suma de fracciones redondeadas independientemente no da exacto. Residuo típico ~1e-4.
DO $$
DECLARE v numeric;
BEGIN
  SELECT sum(capacidad_efectiva) INTO v FROM demoras_capacidad(1000, DATE '2026-07-29');
  IF abs(v - 1.0) >= 0.001 THEN RAISE EXCEPTION 'suma total: obtuvo % (fuera de tolerancia)', v; END IF;
  RAISE NOTICE 'ok suma ~ 1 movil';
END $$;

-- El movil inactivo no cuenta.
DO $$
DECLARE v int;
BEGIN
  SELECT moviles_activos INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF v <> 1 THEN RAISE EXCEPTION 'moviles activos: obtuvo % esperaba 1', v; END IF;
  RAISE NOTICE 'ok ignora inactivos';
END $$;

-- alpha=0 anula el transito.
UPDATE escenario_settings SET peso_transito_alpha = 0 WHERE escenario_id = 1000;
DO $$
DECLARE v numeric;
BEGIN
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=101 AND tipo_servicio='URGENTE';
  IF round(v,6) <> 0 THEN RAISE EXCEPTION 'alpha=0: obtuvo % esperaba 0', v; END IF;
  SELECT capacidad_efectiva INTO v FROM demoras_capacidad(1000, DATE '2026-07-29')
   WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF round(v,6) <> 1 THEN RAISE EXCEPTION 'alpha=0 prioridad: obtuvo % esperaba 1', v; END IF;
  RAISE NOTICE 'ok alpha=0';
END $$;

-- Edge case: alpha=0.33 con mas zonas de transito (1 prioridad + 5 transito).
-- W = 1 + 0.33*5 = 2.65; suma redondeada ~ 0.9999 (fuera de 1.0 pero dentro de tolerancia).
TRUNCATE moviles_zonas, moviles_dia;
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito) VALUES
  ('30', 200, 1000, 'URGENTE', 1),
  ('30', 201, 1000, 'URGENTE', 2),
  ('30', 202, 1000, 'URGENTE', 2),
  ('30', 203, 1000, 'URGENTE', 2),
  ('30', 204, 1000, 'URGENTE', 2),
  ('30', 205, 1000, 'URGENTE', 2);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo) VALUES
  (1000, 30, DATE '2026-07-29', true);
UPDATE escenario_settings SET peso_transito_alpha = 0.33 WHERE escenario_id = 1000;
DO $$
DECLARE v numeric;
BEGIN
  SELECT sum(capacidad_efectiva) INTO v FROM demoras_capacidad(1000, DATE '2026-07-29');
  IF abs(v - 1.0) >= 0.001 THEN RAISE EXCEPTION 'alpha=0.33 suma: obtuvo % (fuera de tolerancia)', v; END IF;
  RAISE NOTICE 'ok alpha=0.33 6zonas suma dentro de tolerancia';
END $$;

-- Restaurar alpha a default
UPDATE escenario_settings SET peso_transito_alpha = 0.3 WHERE escenario_id = 1000;
```

- [ ] **Step 2: Correr el assert para verificar que falla**

Run: `bash scripts/sql-harness/run.sh --assert scripts/sql-harness/assert-capacidad.sql`
Expected: FALLA con `function demoras_capacidad(...) does not exist`.

- [ ] **Step 3: Escribir la función**

`docs/sqls/2026-07-29-demoras-capacidad.sql`:

```sql
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
```

- [ ] **Step 4: Correr el assert para verificar que pasa**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-capacidad.sql --assert scripts/sql-harness/assert-capacidad.sql`
Expected: todos los `ok ...` y exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-29-demoras-capacidad.sql scripts/sql-harness/assert-capacidad.sql
git commit -m "feat(demoras): capacidad efectiva por zona con prorrateo de transito

Un movil no vale uno: su presencia se reparte entre sus zonas con peso 1 si
es de prioridad y alpha si es de transito, normalizado por tipo de servicio.
Solo cuentan los moviles con moviles_dia.activo (hoy 99 de 352).

Validado: un movil en 1 zona de prioridad + 3 de transito aporta 0.5263 y
0.1579, y las cuatro suman exactamente 1.0."
```

---

### Task 4: Función `demoras_ritmo` — las cuatro estadísticas con cascada

**Files:**
- Create: `docs/sqls/2026-07-29-demoras-ritmo.sql`
- Create: `scripts/sql-harness/assert-ritmo.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `demoras_ritmo(p_escenario int, p_hasta date, p_dias int DEFAULT 7, p_min_muestras int DEFAULT 5)` → `TABLE(zona_id int, tipo_servicio text, ritmo_media numeric, ritmo_mediana numeric, ritmo_p75 numeric, ritmo_p90 numeric, ritmo_origen text, ritmo_muestras int)`.
  `ritmo_origen` ∈ `ZONA | GLOBAL`.

> **⚠ ALCANCE DE ESTA TASK: solo `zona → global`.** La cascada completa de
> cuatro niveles (`chofer → móvil → zona → global`), con el orden
> **configurable** desde Preferencias Globales, la implementa la **Task 10**.
>
> El corte es deliberado y de secuencia, no de alcance final: el nivel chofer
> exige resolver en cada corrida quién maneja cada móvil hoy — dato que
> `moviles_dia` no trae —, y conviene tener el motor entero funcionando de punta
> a punta antes de agregar esa consulta. La Task 10 lo completa sobre esta misma
> función.
>
> `ritmo_origen` ya acepta `CHOFER` y `MOVIL` en su CHECK, así que la Task 10 no
> necesita migración de esquema: solo reescribe esta función.

- [ ] **Step 1: Escribir el assert que falla**

`scripts/sql-harness/assert-ritmo.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE moviles_zonas;
TRUNCATE metricas_cumplimiento;

-- Poblamos el universo de moviles_zonas: zonas 100, 200, 300 con tipos URGENTE, NOCTURNO, SERVICE.
INSERT INTO moviles_zonas (escenario_id, zona_id, tipo_de_servicio, activa)
VALUES
  (1000, 100, 'URGENTE', true),
  (1000, 100, 'NOCTURNO', true),
  (1000, 100, 'SERVICE', true),
  (1000, 200, 'URGENTE', true),
  (1000, 200, 'NOCTURNO', true),
  (1000, 200, 'SERVICE', true),
  (1000, 300, 'URGENTE', true),
  (1000, 300, 'NOCTURNO', true),
  (1000, 300, 'SERVICE', true);

-- Zona 100 URGENTE: 5 hechos -> alcanza el minimo, origen ZONA.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', g, 1000, DATE '2026-07-28', 'URGENTE', 10, 100, 'ANA',
       now(), v, v, 'CAMPO'
FROM (VALUES (1,10.0),(2,20.0),(3,30.0),(4,40.0),(5,100.0)) AS t(g,v);

-- Zona 200 URGENTE: 2 hechos -> NO alcanza, debe caer a GLOBAL.
INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', g, 1000, DATE '2026-07-28', 'URGENTE', 11, 200, 'BETO',
       now(), v, v, 'CAMPO'
FROM (VALUES (101,500.0),(102,600.0)) AS t(g,v);

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'ZONA' THEN RAISE EXCEPTION 'zona 100 origen: % (esperaba ZONA)', r.ritmo_origen; END IF;
  IF r.ritmo_muestras IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'zona 100 muestras: %', r.ritmo_muestras; END IF;
  IF round(r.ritmo_mediana,2) IS DISTINCT FROM 30.00 THEN RAISE EXCEPTION 'mediana: % (esperaba 30)', r.ritmo_mediana; END IF;
  IF round(r.ritmo_media,2) IS DISTINCT FROM 40.00 THEN RAISE EXCEPTION 'media: % (esperaba 40)', r.ritmo_media; END IF;
  IF r.ritmo_p90 IS DISTINCT FROM NULL AND r.ritmo_p90 <= r.ritmo_mediana THEN RAISE EXCEPTION 'p90 debe superar la mediana'; END IF;
  RAISE NOTICE 'ok zona con muestras suficientes';
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'GLOBAL' THEN RAISE EXCEPTION 'zona 200 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  -- Cuando cae al global, ritmo_muestras es el count del global (7 = 5 de zona 100 + 2 de zona 200)
  IF r.ritmo_muestras IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'zona 200 muestras: % (esperaba 7 del global)', r.ritmo_muestras; END IF;
  RAISE NOTICE 'ok fallback a global por pocas muestras';
END $$;

-- Zona 300 URGENTE: en universo pero sin hechos -> fallback a GLOBAL.
-- Valores deben coincidir con el global de URGENTE.
DO $$
DECLARE r record; r_global record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=300 AND tipo_servicio='URGENTE';
  -- Obtener el global de URGENTE desde zona 200 que tiene origen='GLOBAL'
  SELECT * INTO r_global FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS DISTINCT FROM 'GLOBAL' THEN RAISE EXCEPTION 'zona 300 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  -- Zona 300 sin hechos debe tener los mismos valores que el global (sacado del global del tipo URGENTE)
  IF r.ritmo_media IS DISTINCT FROM r_global.ritmo_media THEN RAISE EXCEPTION 'zona 300 media: % (esperaba %)', r.ritmo_media, r_global.ritmo_media; END IF;
  IF r.ritmo_mediana IS DISTINCT FROM r_global.ritmo_mediana THEN RAISE EXCEPTION 'zona 300 mediana: % (esperaba %)', r.ritmo_mediana, r_global.ritmo_mediana; END IF;
  RAISE NOTICE 'ok zona en universo sin hechos: devuelve fila, origen GLOBAL, valores del global';
END $$;

-- Tipo NOCTURNO: sin hechos en toda la ventana -> estadisticas NULL, muestras=0.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='NOCTURNO';
  IF r.ritmo_origen IS DISTINCT FROM 'GLOBAL' THEN RAISE EXCEPTION 'zona 100 NOCTURNO origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  IF r.ritmo_media IS NOT NULL OR r.ritmo_mediana IS NOT NULL OR r.ritmo_p75 IS NOT NULL OR r.ritmo_p90 IS NOT NULL THEN
    RAISE EXCEPTION 'zona 100 NOCTURNO: estadisticas deben ser NULL (sin datos globales)';
  END IF;
  IF r.ritmo_muestras IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'zona 100 NOCTURNO: muestras debe ser 0, es %', r.ritmo_muestras; END IF;
  RAISE NOTICE 'ok tipo sin hechos globales: estadisticas=NULL, muestras=0';
END $$;
```

- [ ] **Step 2: Correr el assert para verificar que falla**

Run: `bash scripts/sql-harness/run.sh --assert scripts/sql-harness/assert-ritmo.sql`
Expected: FALLA con `function demoras_ritmo(...) does not exist`.

- [ ] **Step 3: Escribir la función**

`docs/sqls/2026-07-29-demoras-ritmo.sql`:

```sql
-- =====================================================================
-- demoras_ritmo — cuanto tarda un pedido, por (zona, tipo)
-- Fecha: 2026-07-29 | Idempotente
--
-- Se calculan y devuelven LAS CUATRO estadisticas sobre
-- demora_efectiva_mins de los ultimos p_dias. Cual alimenta el calculo lo
-- decide la config (demora_estadistico); guardar las cuatro permite
-- reprocesar el historico con otra sin recalcular nada.
--
-- Si la zona no llega a p_min_muestras hechos, cae al global del tipo.
-- Universo: pares (zona, tipo) en moviles_zonas; incluso zonas sin hechos
-- deben devolver fila, con valores del global.
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
  'Las cuatro estadisticas (media/mediana/p75/p90) de demora_efectiva_mins por (zona, tipo) sobre los ultimos p_dias. Cae al global del tipo si la zona no llega a p_min_muestras. Devuelve filas de todas las (zona, tipo) en moviles_zonas, incluso sin hechos (estadisticas NULL, muestras=0). ESPECIAL y OTROS se excluyen del motor.';
```

- [ ] **Step 4: Correr el assert para verificar que pasa**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-ritmo.sql --assert scripts/sql-harness/assert-ritmo.sql`
Expected: todos los `ok ...` y exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-29-demoras-ritmo.sql scripts/sql-harness/assert-ritmo.sql docs/superpowers/plans/2026-07-28-motor-demora-informada.md
git commit -m "feat(demoras): ritmo por zona con las cuatro estadisticas + fix round 1

Calcula media, mediana, p75 y p90 de demora_efectiva_mins de los ultimos 7
dias, y guarda las cuatro. Cual manda lo decide la config: tener todas
permite reprocesar el historico con otra sin recalcular.

Cae al global del tipo cuando la zona no llega a 5 muestras. ESPECIAL y
OTROS se excluyen del motor porque no tienen oferta propia en moviles_zonas.

Fix round 1: bug critical hallado en revisión (zona sin hechos no devolvía
fila). Solución: invertir conducción de la query: partir del universo de
pares (zona,tipo) en moviles_zonas, hacer LEFT JOIN contra hechos. Ahora
zonas sin hechos devuelven fila con valores del global. Agregados 2 nuevos
asserts para cubrir edge cases."
```

---

### Task 5: Tabla, configuración y orquestador `demoras_calcular_run`

**Files:**
- Create: `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`
- Create: `docs/sqls/2026-07-29-demoras-calcular-run.sql`
- Create: `scripts/sql-harness/assert-run.sql`
- Modify: `scripts/sql-harness/00-stubs.sql` — la tabla `escenario_settings` del
  stub no tiene `pedidos_sa_minutos_antes`, que la función necesita para la
  ventana SA. Agregar la columna con el mismo tipo y default que producción:
  `pedidos_sa_minutos_antes INTEGER` (nullable, sin default; hoy vale 60 en el
  escenario 1000), y sembrarla en 60 en el INSERT del escenario 1000.
  `demoras_config` NO va al stub: la crea la propia migración de esta task.
  **Fix round 1:** el stub declaraba `pedidos.fch_para TEXT`, pero en
  producción es `DATE` (`docs/sqls/supabase-full-migration.sql:126`) — el
  stub divergía justo en la columna que ya tumbó `moviles_dia` una vez (ver
  `docs/sqls/2026-05-28-moviles-dia-functions-fix-fchpara-date.sql`). Se
  corrige a `fch_para DATE`; `services` la hereda vía `LIKE pedidos INCLUDING
  ALL`.

**Interfaces:**
- Consumes: `demoras_acabado`, `demoras_capacidad`, `demoras_ritmo`.
- Produces: tabla `demoras_calculadas` (columnas según spec §4.1) y
  `demoras_calcular_run(p_corrida_at timestamptz DEFAULT now())` → `bigint`
  (filas escritas; 0 si está fuera de ventana o el motor está apagado).

- [ ] **Step 1: Escribir la migración de tabla y config**

`docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`:

```sql
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
```

- [ ] **Step 2: Escribir el assert que falla**

`scripts/sql-harness/assert-run.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE moviles_zonas, moviles_dia, pedidos, services, demoras, demoras_calculadas, metricas_cumplimiento;

-- Zona 100 ACTIVA con 1 movil activo dedicado; zona 900 INACTIVA.
INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
VALUES (1000, 100, 'Distribucion', 'URGENTE', 35, true),
       (1000, 900, 'Distribucion', 'URGENTE', 60, false);

INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('10', 100, 1000, 'URGENTE', 1),
       ('11', 900, 1000, 'URGENTE', 1);
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 10, date '2026-07-29', true),
       (1000, 11, date '2026-07-29', true);

-- 10 pedidos pendientes en zona 100 -> con ritmo global de 20 min y
-- capacidad 1.0, el crudo da 200 -> clampea a 120.
-- fch_para es DATE en produccion (no TEXT): literal directo, sin to_char.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT g, 1000, 'URGENTE', 10, 100, 1, date '2026-07-29'
FROM generate_series(1,10) g;

INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 1000+g, 1000, date '2026-07-29' - 1,
       'URGENTE', 10, 100, 'ANA', now(), 20, 20, 'CAMPO'
FROM generate_series(1,10) g;

-- Fuerza ventana abierta para que el assert no dependa de la hora real.
UPDATE demoras_config SET hora_inicio='00:00', hora_fin='23:59' WHERE escenario_id=1000;

DO $$
DECLARE n bigint; r record;
BEGIN
  n := demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  IF n < 1 THEN RAISE EXCEPTION 'no escribio filas'; END IF;

  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 15:00:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 100'; END IF;
  IF r.demora_informada IS DISTINCT FROM 120 THEN RAISE EXCEPTION 'informada: % (esperaba 120)', r.demora_informada; END IF;
  IF r.clampeado IS DISTINCT FROM 'MAX' THEN RAISE EXCEPTION 'clampeado: % (esperaba MAX)', r.clampeado; END IF;
  IF r.demora_as400 IS DISTINCT FROM 35 THEN RAISE EXCEPTION 'snapshot as400: % (esperaba 35)', r.demora_as400; END IF;
  IF r.pendientes_asignados IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'pendientes: %', r.pendientes_asignados; END IF;
  RAISE NOTICE 'ok calculo y snapshot';

  -- La zona INACTIVA no debe emitir fila.
  PERFORM 1 FROM demoras_calculadas WHERE zona_id=900;
  IF FOUND THEN RAISE EXCEPTION 'la zona inactiva no debe emitir fila'; END IF;
  RAISE NOTICE 'ok ignora zonas inactivas';
END $$;

-- Ventana SA: un pedido SIN movil que arranca mas alla de la ventana no debe
-- contar como demanda; uno CON movil cuenta siempre aunque arranque tarde.
DO $$
DECLARE r_antes record; r_desp record;
BEGIN
  SELECT pendientes_sin_asignar, pendientes_asignados INTO r_antes
    FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:00:00-03';

  -- Uno SA que arranca en 4 horas (fuera de la ventana de 60 min) y uno CON
  -- movil que tambien arranca en 4 horas.
  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
  VALUES (5001, 1000, 'URGENTE', NULL, 100, 1,
          date '2026-07-29',
          timestamptz '2026-07-29 19:00:00-03'),
         (5002, 1000, 'URGENTE', 10, 100, 1,
          date '2026-07-29',
          timestamptz '2026-07-29 19:00:00-03');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:05:00-03');
  SELECT pendientes_sin_asignar, pendientes_asignados INTO r_desp
    FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:05:00-03';

  IF r_desp.pendientes_sin_asignar IS DISTINCT FROM r_antes.pendientes_sin_asignar THEN
    RAISE EXCEPTION 'el SA fuera de ventana no debe contar: % -> %',
      r_antes.pendientes_sin_asignar, r_desp.pendientes_sin_asignar;
  END IF;
  IF r_desp.pendientes_asignados IS DISTINCT FROM r_antes.pendientes_asignados + 1 THEN
    RAISE EXCEPTION 'el asignado fuera de ventana SI debe contar: % -> %',
      r_antes.pendientes_asignados, r_desp.pendientes_asignados;
  END IF;
  RAISE NOTICE 'ok ventana SA (SA fuera de ventana excluido, asignado incluido)';

  DELETE FROM pedidos WHERE id IN (5001,5002);
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:05:00-03';
END $$;

-- ESPECIAL y OTROS no deben contar como demanda de ningun tipo.
DO $$
DECLARE r_antes int; r_desp int;
BEGIN
  SELECT pendientes_asignados INTO r_antes FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:00:00-03';

  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
  VALUES (5101, 1000, 'ESPECIAL SIN FLETE', 10, 100, 1, date '2026-07-29'),
         (5102, 1000, 'LO QUE SEA', 10, 100, 1, date '2026-07-29');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:10:00-03');
  SELECT pendientes_asignados INTO r_desp FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:10:00-03';

  IF r_desp IS DISTINCT FROM r_antes THEN
    RAISE EXCEPTION 'ESPECIAL/OTROS no deben contar como demanda: % -> %', r_antes, r_desp;
  END IF;
  RAISE NOTICE 'ok ESPECIAL y OTROS excluidos';

  DELETE FROM pedidos WHERE id IN (5101,5102);
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:10:00-03';
END $$;

-- fch_para llega NULL desde la ingesta en ~4% de los pedidos pendientes
-- reales (medido contra produccion), aunque fch_hora_para si trae el valor
-- correcto. Mismo gap que 2026-06-01-fix-pedidos-fch-para-null.sql: un
-- pendiente con fch_para NULL debe contar via COALESCE con fch_hora_para,
-- no desaparecer de la demanda.
DO $$
DECLARE r_antes int; r_desp int;
BEGIN
  SELECT pendientes_asignados INTO r_antes FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:00:00-03';

  INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para, fch_hora_para)
  VALUES (5201, 1000, 'URGENTE', 10, 100, 1, NULL, timestamptz '2026-07-29 10:00:00-03');

  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:20:00-03');
  SELECT pendientes_asignados INTO r_desp FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE'
     AND corrida_at = timestamptz '2026-07-29 15:20:00-03';

  IF r_desp IS DISTINCT FROM r_antes + 1 THEN
    RAISE EXCEPTION 'pedido con fch_para NULL no conto via fch_hora_para: % -> %', r_antes, r_desp;
  END IF;
  RAISE NOTICE 'ok fch_para NULL cuenta via COALESCE con fch_hora_para';

  DELETE FROM pedidos WHERE id = 5201;
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:20:00-03';
END $$;

-- Idempotencia: la misma corrida_at dos veces no duplica ni cambia.
DO $$
DECLARE a bigint; b bigint;
BEGIN
  SELECT count(*) INTO a FROM demoras_calculadas;
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  SELECT count(*) INTO b FROM demoras_calculadas;
  IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'no es idempotente: % -> %', a, b; END IF;
  RAISE NOTICE 'ok idempotente';
END $$;

-- Interruptor de emergencia (global: apaga los 3 tipos a la vez).
UPDATE demoras_config SET motor_activo=false WHERE escenario_id=1000;
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 16:00:00-03') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'el interruptor no apago el motor';
  END IF;
  RAISE NOTICE 'ok interruptor';
END $$;
UPDATE demoras_config SET motor_activo=true WHERE escenario_id=1000;

-- Fuera de ventana (global: cierra los 3 tipos a la vez).
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='08:00' WHERE escenario_id=1000;
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'corrio fuera de ventana';
  END IF;
  RAISE NOTICE 'ok ventana horaria';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Aislamiento POR TIPO: la restriccion central de esta task es que el
-- interruptor y la ventana horaria se evaluan por (escenario, tipo), no
-- globalmente (NOCTURNO tiene su propia ventana 18:00-23:30). Los bloques
-- de arriba solo pisan las 3 filas de demoras_config a la vez y prueban
-- comportamiento GLOBAL; nunca demuestran el aislamiento. Hace falta
-- sembrar NOCTURNO y SERVICE (hasta aca no habia ni una fila) y probar
-- que apagar/cerrar UN tipo no afecta a los otros.
-- ═══════════════════════════════════════════════════════════════════════
UPDATE demoras_config SET motor_activo=true, hora_inicio='00:00', hora_fin='23:59' WHERE escenario_id=1000;

INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('10', 100, 1000, 'NOCTURNO', 1),
       ('10', 100, 1000, 'SERVICE', 1);

INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (6001, 1000, 'NOCTURNO', 10, 100, 1, date '2026-07-29');
INSERT INTO services (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
VALUES (7001, 1000, 'SERVICE', 10, 100, 1, date '2026-07-29');

-- Control positivo: con el motor prendido y la ventana abierta para los 3
-- tipos, NOCTURNO y SERVICE tienen que calcular igual que URGENTE. Esto
-- prueba que el seed nuevo es valido ANTES de usarlo para probar
-- aislamiento (si esto fallara, las ausencias de abajo serian falsos
-- positivos por falta de datos, no por el interruptor/ventana).
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:00:00-03');

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 20:00:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOCTURNO debio calcular (control positivo)'; END IF;

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='SERVICE' AND corrida_at = timestamptz '2026-07-29 20:00:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE debio calcular (control positivo)'; END IF;

  RAISE NOTICE 'ok NOCTURNO y SERVICE calculan con datos propios (control positivo)';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 20:00:00-03';
END $$;

-- Interruptor POR TIPO: apagar solo NOCTURNO no debe afectar a URGENTE.
UPDATE demoras_config SET motor_activo=false WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:05:00-03');

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 20:05:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'URGENTE debio seguir calculando con NOCTURNO apagado'; END IF;

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 20:05:00-03';
  IF FOUND THEN RAISE EXCEPTION 'NOCTURNO no debio calcular: el interruptor es por tipo, no global'; END IF;

  RAISE NOTICE 'ok interruptor por tipo (apagar NOCTURNO no apaga URGENTE)';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 20:05:00-03';
END $$;
UPDATE demoras_config SET motor_activo=true WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';

-- Ventana POR TIPO: URGENTE 07:00-23:30, NOCTURNO 18:00-23:30 (ventanas
-- reales del seed). A las 15:30 -dentro de la de URGENTE, fuera de la de
-- NOCTURNO- debe emitir URGENTE y NO NOCTURNO.
UPDATE demoras_config SET hora_inicio='07:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
UPDATE demoras_config SET hora_inicio='18:00', hora_fin='23:30' WHERE escenario_id=1000 AND tipo_servicio='NOCTURNO';
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:30:00-03');

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 15:30:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'URGENTE debio calcular a las 15:30 (dentro de su ventana)'; END IF;

  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 15:30:00-03';
  IF FOUND THEN RAISE EXCEPTION 'NOCTURNO no debio calcular a las 15:30 (fuera de su ventana 18:00-23:30)'; END IF;

  RAISE NOTICE 'ok ventana horaria por tipo (15:30: URGENTE calcula, NOCTURNO no)';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 15:30:00-03';
END $$;

-- Y a las 19:00, ya dentro de la ventana de NOCTURNO, NOCTURNO SI calcula:
-- prueba que la ausencia de arriba es por la ventana y no por falta de
-- datos o algun otro bloqueo silencioso.
DO $$
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 19:00:00-03');
  PERFORM 1 FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='NOCTURNO' AND corrida_at = timestamptz '2026-07-29 19:00:00-03';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOCTURNO debio calcular a las 19:00 (dentro de su ventana)'; END IF;
  RAISE NOTICE 'ok NOCTURNO calcula dentro de su propia ventana';
  DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 19:00:00-03';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Precedencia capacidad > demanda: la falta de capacidad manda sobre la
-- falta de demanda. Zona 200 nueva, dedicada, con movil ASIGNADO (para
-- entrar al universo) pero sin pedidos ni services (demanda cero en las
-- dos pruebas). Primero SIN activar el movil hoy (sin capacidad): la
-- respuesta honesta no es el piso, nadie atiende. Despues, mismo movil ya
-- activado (con capacidad) y demanda sigue en cero: ahi si es el caso
-- bueno. Sin el segundo control, el primero podria pasar por el motivo
-- equivocado (p.ej. si el CASE quedara mal armado de otra forma).
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO demoras (escenario_id, zona_id, zona_tipo, descripcion, minutos, activa)
VALUES (1000, 200, 'Distribucion', 'URGENTE', 45, true);
INSERT INTO moviles_zonas (movil_id, zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito)
VALUES ('20', 200, 1000, 'URGENTE', 1);
-- Sin fila en moviles_dia para el movil 20 todavia: no cuenta como activo.

DO $$
DECLARE r record;
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:10:00-03');
  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=200 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 20:10:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 200 (sin capacidad, sin demanda)'; END IF;
  IF r.demora_informada IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'sin capacidad y sin demanda: informada % (esperaba 120 = max_minutos)', r.demora_informada;
  END IF;
  IF r.sin_capacidad IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'sin capacidad y sin demanda: sin_capacidad=% (esperaba true)', r.sin_capacidad;
  END IF;
  RAISE NOTICE 'ok sin capacidad y sin demanda -> informa el techo, sin_capacidad=true';
END $$;

-- Limpio la corrida anterior para que la proxima sea "primera corrida del
-- dia" para la zona 200 y el suavizado no arrastre el 120 de recien.
DELETE FROM demoras_calculadas WHERE corrida_at = timestamptz '2026-07-29 20:10:00-03';

-- Ahora activo el movil 20 (capacidad>0); la demanda sigue en cero.
INSERT INTO moviles_dia (escenario_id, movil_id, fecha, activo)
VALUES (1000, 20, date '2026-07-29', true);

DO $$
DECLARE r record;
BEGIN
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 20:15:00-03');
  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=200 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 20:15:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 200 (con capacidad, sin demanda)'; END IF;
  IF r.demora_informada IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'con capacidad y sin demanda: informada % (esperaba 30 = min_minutos)', r.demora_informada;
  END IF;
  IF r.sin_capacidad IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'con capacidad y sin demanda: sin_capacidad=% (esperaba false)', r.sin_capacidad;
  END IF;
  RAISE NOTICE 'ok con capacidad y sin demanda -> informa el piso, sin_capacidad=false';
END $$;
```

- [ ] **Step 3: Correr el assert para verificar que falla**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-acabado.sql docs/sqls/2026-07-29-demoras-capacidad.sql docs/sqls/2026-07-29-demoras-ritmo.sql docs/sqls/2026-07-29-demoras-calculadas-tabla.sql --assert scripts/sql-harness/assert-run.sql`
Expected: FALLA con `function demoras_calcular_run(...) does not exist`.

- [ ] **Step 4: Escribir el orquestador**

`docs/sqls/2026-07-29-demoras-calcular-run.sql`:

```sql
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
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora informada. Universo = zonas activas con moviles ASIGNADOS en moviles_zonas (no requiere moviles ACTIVOS hoy: una zona sin ningun movil activo escribe fila igual, con capacidad=0 y sin_capacidad=true, para poder auditar el peor caso operativo). La falta de capacidad manda sobre la falta de demanda: sin capacidad informa el techo (max_minutos) aunque no haya demanda, porque un pedido que entre ahora no tiene quien lo atienda; el piso (min_minutos) solo aplica con capacidad y cola vacia. La config vive en demoras_config por (escenario, tipo): el interruptor y la ventana horaria se evaluan POR TIPO, asi que NOCTURNO puede tener su propio horario. Un tipo sin fila de config no se calcula. fch_para tolera NULL via COALESCE con fch_hora_para. ritmo_usado persiste el valor efectivamente usado, con fallback a demoras_config.ritmo_default_minutos etiquetado como ritmo_origen=DEFECTO (no GLOBAL: no hubo calculo global). demora_as400 es deterministico (ORDER BY updated_at, demora_id). Devuelve filas escritas.';
```

- [ ] **Step 5: Correr el assert para verificar que pasa**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-acabado.sql docs/sqls/2026-07-29-demoras-capacidad.sql docs/sqls/2026-07-29-demoras-ritmo.sql docs/sqls/2026-07-29-demoras-calculadas-tabla.sql docs/sqls/2026-07-29-demoras-calcular-run.sql --assert scripts/sql-harness/assert-run.sql`
Expected: todos los `ok ...` y exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/sqls/2026-07-29-demoras-calculadas-tabla.sql docs/sqls/2026-07-29-demoras-calcular-run.sql scripts/sql-harness/assert-run.sql
git commit -m "feat(demoras): tabla de hechos, configuracion y orquestador del motor

demoras_calculadas guarda el resultado Y los insumos: sin eso no se puede
contestar 'por que esta zona informo 90' y nadie confia en el numero.
demora_as400 es un snapshot porque el import del AS400 pisa su tabla en
cada corrida.

La ventana horaria se evalua dentro de la funcion, no en el cron: pg_cron
corre en UTC y 07:00-23:30 de Montevideo cruza la medianoche UTC.

Validado en Postgres local: calculo, snapshot del AS400, zonas inactivas
ignoradas, idempotencia, interruptor de emergencia y ventana horaria."
```

**Fix round 1 (2026-07-28), sobre review con 2 Critical + 5 Important:**
- Critical 1: `fch_para` es `DATE` en producción, no `TEXT` — comparar con
  `to_char(...)` hace abortar la función en CADA corrida (mismo bug que ya
  tumbó `moviles_dia`, ver `2026-05-28-moviles-dia-functions-fix-fchpara-
  date.sql`). Se compara `date = date`. El stub tenía `fch_para TEXT`
  (divergía de producción) y no lo detectaba; se corrige a `DATE`.
- Addendum al Critical 1: `fch_para` llega NULL desde la ingesta en ~4% de
  los pedidos pendientes reales aunque `fch_hora_para` sí trae el valor.
  Mismo patrón que `2026-06-01-fix-pedidos-fch-para-null.sql`: se tolera
  con `COALESCE(fch_para, (fch_hora_para AT TIME ZONE 'America/Montevideo')::date)`
  en las dos ramas de la demanda (pedidos y services).
- Critical 2: el universo salía de `demoras_capacidad()`, que solo agrega
  móviles ACTIVOS hoy — una zona con pedidos pendientes y CERO móviles
  activos (el peor caso operativo; 72% de la flota está inactiva en un
  momento dado) desaparecía sin dejar fila que auditar. El universo ahora
  sale de `moviles_zonas` (mismo universo que `demoras_ritmo`), y `cap` se
  LEFT JOINea: sin capacidad, `capacidad=0` y `sin_capacidad=true`, pero la
  fila se escribe.
- Important 3: el `ON CONFLICT DO UPDATE` solo actualizaba 4 de 22 columnas
  no-PK, dejando filas internamente inconsistentes en una re-corrida con
  insumos distintos. Ahora actualiza las 22.
- Important 4: el subselect de `demora_as400` tenía `LIMIT 1` sin
  `ORDER BY` — no determinístico, dado que la clave natural de `demoras`
  permite varias filas por `(escenario, zona, descripcion)`. Se agrega
  `ORDER BY updated_at DESC, demora_id DESC`.
- Important 5: el `30` de `coalesce(ritmo_usado, 30)` era mágico y no se
  persistía (la fila quedaba con `ritmo_usado=NULL`). Se agrega
  `demoras_config.ritmo_default_minutos` (parámetro del modelo, editable) y
  se persiste el valor efectivamente usado.
- Important 6: los asserts previos pisaban las 3 filas de `demoras_config`
  a la vez y solo probaban comportamiento GLOBAL, sin cubrir la restricción
  central de la task (interruptor y ventana POR TIPO). Se siembran
  NOCTURNO y SERVICE (antes sin ninguna fila) y se agregan asserts de
  aislamiento por tipo, con controles positivos para no confundir ausencia
  por bloqueo con ausencia por falta de datos.
- Important 7: el CTE `prev` no era sargable (único predicado usable
  `corrida_at < p_corrida_at`, ~4,5M filas en régimen). Se agrega cota
  inferior sargable `corrida_at >= (v_fecha::timestamp AT TIME ZONE
  'America/Montevideo')`.

Verificado: el harness con el stub corregido (`fch_para DATE`) y la función
revertida a `to_char(...)` FALLA con `operator does not exist: date =
text` — confirma que el stub ya no enmascara el Critical 1. Con todo
corregido, el harness completo pasa con exit 0 (11 `NOTICE ok`, incluyendo
los nuevos de fch_para NULL y aislamiento por tipo).

**Fix round 2 (2026-07-28), sobre 2 Important + 2 Minor del fix round 1:**
- Important: la migración de tabla dejó de ser idempotente —
  `ritmo_default_minutos` se agregó solo dentro del `CREATE TABLE IF NOT
  EXISTS demoras_config`, así que sobre una base donde la tabla ya existía
  (creada por una versión anterior de esta misma migración) el `CREATE`
  se salteaba entero, la columna nunca se agregaba, y el `COMMENT ON
  COLUMN` siguiente explotaba con `column "ritmo_default_minutos" ...
  does not exist` — con `--single-transaction`, rollback completo. Se
  agrega `ALTER TABLE demoras_config ADD COLUMN IF NOT EXISTS
  ritmo_default_minutos ...` después del `CREATE TABLE`, mismo patrón que
  las 48 ocurrencias ya existentes en 21 migraciones del repo.
- Important: el `CASE` del crudo evaluaba "sin demanda" ANTES que "sin
  capacidad" — una zona con móviles asignados pero CERO activos hoy y sin
  pedidos pendientes informaba el piso (30 min) en vez del techo, y
  `sin_capacidad` salía `false` porque exigía además `pendientes_total >
  0`. La respuesta honesta a "cuánto demora" cuando no hay nadie
  trabajando no es "poco": un pedido que entre ahora no tiene quién lo
  atienda. Se invierte el orden del `CASE` (capacidad manda sobre
  demanda) y se ensancha `sin_capacidad` a `capacidad <= 0` solo,
  quitando la condición de demanda: la bandera describe el estado de la
  OFERTA, no la coincidencia entre oferta y demanda. Se agregan 2 asserts
  con una zona dedicada (200): (a) sin capacidad y sin demanda → informa
  el techo con `sin_capacidad=true`; (b) mismo movil ya activado, sin
  demanda → informa el piso con `sin_capacidad=false` (control positivo,
  para que (a) no pase por el motivo equivocado).
- Minor: las 11 comparaciones `<>` de `assert-run.sql` pasan a `IS
  DISTINCT FROM`, completando el ruling de la Task 4 ("todos los
  asserts").
- Minor: se agrega `'DEFECTO'` al `CHECK` de `ritmo_origen` (en la
  migración de tabla) y se usa cuando `ritmo_usado` sale de
  `ritmo_default_minutos` en vez de una estadística real — antes esas
  filas quedaban etiquetadas `'GLOBAL'` sin que hubiera existido ningún
  cálculo global.

Verificado: aplicar la migración de tabla dos veces seguidas en el harness
no aborta (segunda pasada solo emite `NOTICE ... already exists,
skipping`, exit 0). Harness completo con todo corregido: exit 0, con los
asserts viejos y los 2 nuevos de precedencia capacidad/demanda.

---

### Task 6: pg_cron y retención

**Files:**
- Create: `docs/sqls/2026-07-29-demoras-cron.sql`

**Interfaces:**
- Consumes: `demoras_calcular_run`.
- Produces: jobs `demoras-calcular` (cada 10 min) y `demoras-purga` (diario).

- [ ] **Step 1: Escribir la migración**

`docs/sqls/2026-07-29-demoras-cron.sql`:

```sql
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
SELECT cron.schedule('demoras-purga', '40 4 * * *',
  $cron$ DELETE FROM demoras_calculadas WHERE corrida_at < now() - interval '180 days'; $cron$);

-- ─── Verificacion ────────────────────────────────────────────────────
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
-- SELECT count(*), min(corrida_at), max(corrida_at) FROM demoras_calculadas;
```

- [ ] **Step 2: Verificar que el archivo no rompe el harness**

El harness no tiene `pg_cron`, así que esta migración **no** se valida ahí.
Verificar a ojo que las dos expresiones cron son válidas y que los nombres de
job no chocan con los existentes:

Run: `grep -rn "cron.schedule" docs/sqls/ | grep -v demoras`
Expected: los jobs existentes (`metricas-cumplimiento-run`, limpieza de GPS) tienen nombres distintos.

- [ ] **Step 3: Commit**

```bash
git add docs/sqls/2026-07-29-demoras-cron.sql
git commit -m "feat(demoras): cron cada 10 minutos y retencion de 30 dias

El cron dispara las 24 horas a proposito; la ventana 07:00-23:30 la evalua
la funcion internamente porque pg_cron corre en UTC y esa ventana cruza la
medianoche UTC."
```

---

### Task 7: Endpoint de lectura de la comparativa

**Files:**
- Create: `app/api/demoras/comparativa/route.ts`
- Create: `app/api/demoras/comparativa/route.test.ts`
- Create: `types/demoras-comparativa.ts`

**Interfaces:**
- Consumes: tabla `demoras_calculadas`.
- Produces: `GET /api/demoras/comparativa?escenario=&fecha=&tipo=&zona=` →
  `{ success: true, data: ComparativaData }` con
  `ComparativaData = { serie: PuntoComparativa[]; zonas: ZonaBrecha[] }`,
  `PuntoComparativa = { corrida_at: string; calculada: number; as400: number | null }`,
  `ZonaBrecha = { zona_id: number; zona_nombre: string; prom_calculada: number; prom_as400: number | null; brecha: number | null }`.

- [ ] **Step 1: Escribir los tipos**

`types/demoras-comparativa.ts`:

```typescript
/** Tipos de GET /api/demoras/comparativa. */
export type TipoDemora = 'URGENTE' | 'NOCTURNO' | 'SERVICE';
export const TIPOS_DEMORA: TipoDemora[] = ['URGENTE', 'NOCTURNO', 'SERVICE'];

export interface PuntoComparativa {
  corrida_at: string;
  calculada: number;
  /** null cuando el AS400 no informa ese tipo (solo informa URGENTE). */
  as400: number | null;
}

export interface ZonaBrecha {
  zona_id: number;
  zona_nombre: string;
  prom_calculada: number;
  prom_as400: number | null;
  /** calculada − as400. null si no hay contraparte. */
  brecha: number | null;
}

export interface ComparativaData {
  serie: PuntoComparativa[];
  zonas: ZonaBrecha[];
}
```

- [ ] **Step 2: Escribir el test que falla**

`app/api/demoras/comparativa/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockDb = vi.mocked(getServerSupabaseClient);

const FILAS = [
  { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 45, demora_as400: 35 },
  { corrida_at: '2026-07-29T10:10:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 60, demora_as400: 40 },
  { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 200, tipo_servicio: 'URGENTE', demora_informada: 30, demora_as400: null },
];

function makeDb(rows: unknown[] = FILAS) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order']) {
    q[m] = vi.fn(() => q);
  }
  q.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
  return { from: vi.fn(() => q) };
}

function req(qs: string) {
  return new NextRequest(`http://localhost/api/demoras/comparativa?${qs}`, { method: 'GET' });
}

describe('GET /api/demoras/comparativa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ session: {}, user: { id: 'u1' } } as never);
    mockDb.mockReturnValue(makeDb() as never);
  });

  it('401 sin sesion, sin tocar la base', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const res = await GET(req('escenario=1000'));
    expect(res.status).toBe(401);
    expect(mockDb).not.toHaveBeenCalled();
  });

  it('400 cuando falta escenario', async () => {
    const res = await GET(req('fecha=2026-07-29'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_ESCENARIO');
  });

  it('400 con tipo invalido', async () => {
    const res = await GET(req('escenario=1000&tipo=FRUTA'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TIPO');
  });

  it('calcula la brecha por zona y ordena de mayor a menor', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    const body = await res.json();
    expect(res.status).toBe(200);
    const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
    expect(z100.prom_calculada).toBe(52.5);
    expect(z100.prom_as400).toBe(37.5);
    expect(z100.brecha).toBe(15);
  });

  it('brecha null cuando el AS400 no informa ese tipo', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    const body = await res.json();
    const z200 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 200);
    expect(z200.prom_as400).toBeNull();
    expect(z200.brecha).toBeNull();
  });

  it('la serie de una zona sale ordenada por corrida', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE&zona=100'));
    const body = await res.json();
    expect(body.data.serie).toHaveLength(2);
    expect(body.data.serie[0].calculada).toBe(45);
    expect(body.data.serie[1].calculada).toBe(60);
  });
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `npx vitest run app/api/demoras/comparativa/route.test.ts`
Expected: FALLA — el módulo `./route` no existe.

- [ ] **Step 4: Escribir el endpoint**

`app/api/demoras/comparativa/route.ts`:

```typescript
/**
 * GET /api/demoras/comparativa
 *
 * Serie del día y brecha por zona entre la demora que calcula TrackMovil y
 * la que informa el AS400. Lee `demoras_calculadas`, que guarda el snapshot
 * del AS400 en cada corrida — el import del AS400 pisa su propia tabla, así
 * que sin ese snapshot no habría con qué comparar.
 *
 * Query params:
 *   - escenario (requerido, int)
 *   - fecha     (opcional, YYYY-MM-DD; default hoy en Montevideo)
 *   - tipo      (opcional, URGENTE|NOCTURNO|SERVICE; default URGENTE)
 *   - zona      (opcional, int) — si viene, `serie` es de esa zona
 *
 * OJO: el AS400 solo informa URGENTE. Para NOCTURNO y SERVICE `as400` viene
 * null y la brecha no se puede calcular; la UI lo dice explícitamente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { TIPOS_DEMORA } from '@/types/demoras-comparativa';
import type { TipoDemora, ComparativaData, PuntoComparativa, ZonaBrecha } from '@/types/demoras-comparativa';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Fila {
  corrida_at: string;
  zona_id: number;
  tipo_servicio: string;
  demora_informada: number;
  demora_as400: number | null;
}

function hoyMontevideo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
}

function prom(xs: number[]): number {
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;

  const escenario = Number.parseInt(sp.get('escenario') ?? '', 10);
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  const tipoRaw = sp.get('tipo') ?? 'URGENTE';
  if (!TIPOS_DEMORA.includes(tipoRaw as TipoDemora)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "tipo" inválido: URGENTE | NOCTURNO | SERVICE', code: 'INVALID_TIPO' },
      { status: 400 },
    );
  }
  const tipo = tipoRaw as TipoDemora;

  const fechaRaw = sp.get('fecha');
  if (fechaRaw !== null && !DATE_RE.test(fechaRaw)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "fecha" debe ser YYYY-MM-DD', code: 'INVALID_DATE' },
      { status: 400 },
    );
  }
  const fecha = fechaRaw ?? hoyMontevideo();

  const zonaRaw = sp.get('zona');
  const zonaSel = zonaRaw !== null ? Number.parseInt(zonaRaw, 10) : null;

  const db = getServerSupabaseClient() as unknown as {
    from: (t: string) => Record<string, (...a: unknown[]) => unknown>;
  };

  const { data, error } = (await db
    .from('demoras_calculadas')
    .select('corrida_at, zona_id, tipo_servicio, demora_informada, demora_as400')
    .eq('escenario', escenario)
    .eq('tipo_servicio', tipo)
    .gte('corrida_at', `${fecha}T00:00:00-03:00`)
    .lte('corrida_at', `${fecha}T23:59:59-03:00`)
    .order('corrida_at', { ascending: true })) as unknown as {
    data: Fila[] | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[demoras/comparativa] error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener la comparativa', details: error.message },
      { status: 500 },
    );
  }

  const filas = data ?? [];

  const serie: PuntoComparativa[] = filas
    .filter((f) => zonaSel === null || f.zona_id === zonaSel)
    .map((f) => ({ corrida_at: f.corrida_at, calculada: f.demora_informada, as400: f.demora_as400 }));

  const porZona = new Map<number, { calc: number[]; as400: number[] }>();
  for (const f of filas) {
    const e = porZona.get(f.zona_id) ?? { calc: [], as400: [] };
    e.calc.push(f.demora_informada);
    if (f.demora_as400 !== null) e.as400.push(f.demora_as400);
    porZona.set(f.zona_id, e);
  }

  const zonas: ZonaBrecha[] = [...porZona.entries()]
    .map(([zona_id, e]) => {
      const pc = prom(e.calc);
      const pa = e.as400.length > 0 ? prom(e.as400) : null;
      return {
        zona_id,
        zona_nombre: `Zona ${zona_id}`,
        prom_calculada: pc,
        prom_as400: pa,
        brecha: pa === null ? null : Math.round((pc - pa) * 100) / 100,
      };
    })
    .sort((a, b) => Math.abs(b.brecha ?? -1) - Math.abs(a.brecha ?? -1));

  const payload: ComparativaData = { serie, zonas };
  return NextResponse.json({ success: true, data: payload });
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx vitest run app/api/demoras/comparativa/route.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 6: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; toda la suite verde sin regresiones.

- [ ] **Step 7: Commit**

```bash
git add app/api/demoras/comparativa types/demoras-comparativa.ts
git commit -m "feat(demoras): endpoint de comparativa calculada vs AS400

Serie del dia y brecha por zona, ordenada por brecha absoluta descendente.
Para NOCTURNO y SERVICE la brecha viene null porque el AS400 no informa
esos tipos; la UI lo dice en vez de dibujar un hueco."
```

---

### Task 8: Card de comparativa en el dashboard

**Files:**
- Create: `components/metricas/DemoraComparativa.tsx`
- Modify: `app/dashboard/metricas-cumplimiento/page.tsx`
- Modify: `components/metricas/metricas-theme.ts` (agregar `INFO_TEXTS.demora_comparativa`)

**Interfaces:**
- Consumes: `GET /api/demoras/comparativa`, tipos de `types/demoras-comparativa.ts`,
  `CardShell` y `ExpandModal` de `components/metricas/`.
- Produces: componente `<DemoraComparativa escenario={number} />`.

- [ ] **Step 1: Agregar el texto informativo**

En `components/metricas/metricas-theme.ts`, dentro de `INFO_TEXTS`:

```typescript
  demora_comparativa: {
    title: 'Demora calculada vs. informada',
    text: 'Cada 10 minutos TrackMovil calcula, para cada zona activa, cuánto debería demorar un pedido según la demanda pendiente, los móviles realmente activos y el ritmo real de cumplimiento de la última semana. Esa línea se compara contra la que informa el AS400. La nuestra es escalonada porque redondea a 15 minutos; la del AS400 usa escalones de 5. El AS400 solo informa URGENTE: para NOCTURNO y SERVICE se muestra únicamente nuestra línea. Este número NO se le informa a ningún cliente — es solo para validar el modelo.',
  },
```

- [ ] **Step 2: Escribir el componente**

`components/metricas/DemoraComparativa.tsx`:

```tsx
'use client';

/**
 * Comparativa entre la demora que calcula TrackMovil y la que informa el
 * AS400, por zona y tipo de servicio.
 *
 * El AS400 solo informa URGENTE. Para NOCTURNO y SERVICE se dibuja solo
 * nuestra línea y se dice explícitamente: un hueco sin explicar se lee como
 * un bug.
 */

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TIPOS_DEMORA } from '@/types/demoras-comparativa';
import type { TipoDemora, ComparativaData } from '@/types/demoras-comparativa';
import { formatMin } from './metricas-theme';

const COLOR_CALC = 'var(--color-metricas-serie)';
const COLOR_AS400 = 'var(--color-metricas-nocturno)';

function horaDe(iso: string): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export function DemoraComparativa({ escenario }: { escenario: number | null }) {
  const [tipo, setTipo] = useState<TipoDemora>('URGENTE');
  const [zona, setZona] = useState<number | null>(null);
  const [data, setData] = useState<ComparativaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (escenario == null) return;
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    const sp = new URLSearchParams({ escenario: String(escenario), tipo });
    if (zona != null) sp.set('zona', String(zona));
    fetch(`/api/demoras/comparativa?${sp.toString()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ac.signal.aborted) return;
        if (!j?.success) throw new Error(j?.error ?? 'Error desconocido');
        setData(j.data as ComparativaData);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setCargando(false);
      });
    return () => ac.abort();
  }, [escenario, tipo, zona]);

  const hayAs400 = tipo === 'URGENTE';
  const serie = (data?.serie ?? []).map((p) => ({ ...p, hora: horaDe(p.corrida_at) }));

  if (error) {
    return <p className="py-6 text-center text-sm text-stats-destructive">No se pudo cargar la comparativa: {error}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tipo</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDemora)}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            {TIPOS_DEMORA.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Zona</span>
          <select
            value={zona ?? ''}
            onChange={(e) => setZona(e.target.value === '' ? null : Number(e.target.value))}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            <option value="">Todas las zonas</option>
            {(data?.zonas ?? []).map((z) => (
              <option key={z.zona_id} value={z.zona_id}>{z.zona_nombre}</option>
            ))}
          </select>
        </label>
        {!hayAs400 && (
          <p className="max-w-[34ch] text-[0.78rem] text-stats-muted-fg">
            El AS400 no informa demora para {tipo}: solo se muestra la línea calculada.
          </p>
        )}
      </div>

      {cargando && !data ? (
        <div className="h-[240px] animate-pulse rounded-lg bg-stats-surface-2" />
      ) : serie.length === 0 ? (
        <p className="py-6 text-center text-sm text-stats-muted-fg">
          Todavía no hay corridas del motor para hoy.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={serie} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stats-border)" vertical={false} />
            <XAxis dataKey="hora" tick={{ fontSize: 11 }} stroke="var(--color-stats-muted-fg)" />
            <YAxis unit="'" tick={{ fontSize: 11 }} stroke="var(--color-stats-muted-fg)" />
            <Tooltip formatter={(v: number | null) => (v == null ? '—' : `${formatMin(v)} min`)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="stepAfter" dataKey="calculada" name="Calculada" stroke={COLOR_CALC} strokeWidth={2.4} dot={false} />
            {hayAs400 && (
              <Line type="monotone" dataKey="as400" name="AS400" stroke={COLOR_AS400} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {(data?.zonas.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-left text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Zona</th>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Calculada</th>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">AS400</th>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Brecha</th>
              </tr>
            </thead>
            <tbody>
              {(data?.zonas ?? []).slice(0, 12).map((z) => (
                <tr key={z.zona_id} className="hover:bg-stats-surface-2">
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-stats-foreground">{z.zona_nombre}</td>
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(z.prom_calculada)}</td>
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(z.prom_as400)}</td>
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(z.brecha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Montar la card en la página**

En `app/dashboard/metricas-cumplimiento/page.tsx`:

1. Agregar el import junto a los demás de `components/metricas/`:

```tsx
import { DemoraComparativa } from '@/components/metricas/DemoraComparativa';
```

2. Extender el tipo de sección expandible:

```tsx
type ExpandedSection = 'tendencia' | 'tipo' | 'ranking' | 'tabla' | 'escenarios' | 'demora' | null;
```

3. Dentro del `<div className="mt-3.5 grid grid-cols-12 gap-3.5">`, **después** de la
   card "Comparativa entre escenarios":

```tsx
          {/* ── Demora informada vs. calculada ──
              Última card: mira un dato distinto del resto de la pantalla
              (demora prospectiva, no cumplimiento histórico). */}
          <CardShell
            title="Demora calculada vs. informada"
            hint="cada 10 min · por zona"
            infoTitle={INFO_TEXTS.demora_comparativa.title}
            infoText={INFO_TEXTS.demora_comparativa.text}
            onExpand={() => setExpandedSection('demora')}
            className="col-span-12"
            style={{ animationDelay: '380ms' }}
          >
            <DemoraComparativa escenario={escenarioSel} />
          </CardShell>
```

4. En el `title` del `<ExpandModal>`, agregar la rama antes del fallback:

```tsx
                : expandedSection === 'demora'
                  ? 'Demora calculada vs. informada'
```

5. Antes del cierre del `<ExpandModal>`:

```tsx
        {expandedSection === 'demora' && <DemoraComparativa escenario={escenarioSel} />}
```

- [ ] **Step 4: Verificar tipos, lint y build**

Run: `npx tsc --noEmit && npx eslint app/dashboard/metricas-cumplimiento components/metricas && npx next build`
Expected: tsc exit 0, eslint 0 errores, build `✓ Compiled successfully`.

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: toda la suite verde, sin regresiones.

- [ ] **Step 6: Commit**

```bash
git add components/metricas/DemoraComparativa.tsx components/metricas/metricas-theme.ts app/dashboard/metricas-cumplimiento/page.tsx
git commit -m "feat(demoras): card de comparativa calculada vs AS400 en el dashboard

Serie del dia por zona y tabla de brecha ordenada por diferencia. Nuestra
linea va escalonada (redondeamos a 15) y la del AS400 punteada (usan 5).
Para NOCTURNO y SERVICE se dibuja solo la nuestra y la card explica por que:
el AS400 no informa esos tipos."
```

---

### Task 9: Documentación y guía de aplicación

**Files:**
- Create: `docs/DEMORA_INFORMADA.md`
- Modify: `docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md` (marcar implementado)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: documento operativo con el orden de aplicación y las verificaciones.

- [ ] **Step 1: Escribir la doc operativa**

`docs/DEMORA_INFORMADA.md` debe contener, con este contenido exacto:

- **Orden de aplicación en el SQL Editor de Supabase** (los 5 archivos en este orden):
  1. `docs/sqls/2026-07-29-demoras-acabado.sql`
  2. `docs/sqls/2026-07-29-demoras-capacidad.sql`
  3. `docs/sqls/2026-07-29-demoras-ritmo.sql`
  4. `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`
  5. `docs/sqls/2026-07-29-demoras-calcular-run.sql`
  6. `docs/sqls/2026-07-29-demoras-cron.sql` (requiere `pg_cron` habilitado)
- **Verificación post-apply**:
  ```sql
  -- 1) Una corrida manual fuera del cron
  SELECT demoras_calcular_run(now());
  -- 2) Qué escribió
  SELECT zona_id, tipo_servicio, demora_informada, demora_as400,
         pendientes_asignados + pendientes_sin_asignar AS pendientes,
         capacidad_efectiva, ritmo_usado, ritmo_origen, clampeado
    FROM demoras_calculadas
   WHERE corrida_at = (SELECT max(corrida_at) FROM demoras_calculadas)
   ORDER BY demora_informada DESC LIMIT 20;
  -- 3) Los jobs quedaron programados
  SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
  ```
- **Cómo apagar el motor en caliente**: `UPDATE demoras_config SET motor_activo=false WHERE escenario_id=1000;`
- **Cómo cambiar el estadístico** (por tipo):
  `UPDATE demoras_config SET estadistico='P75' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';`
- **El riesgo R1 copiado íntegro** desde la spec, con el recordatorio de que el
  número no debe informarse a un cliente hasta que la brecha esté calibrada.
- **Tabla de las columnas de `demoras_config`** con sus defaults, aclarando que la config es por (escenario, tipo de servicio) y que un tipo sin fila no se calcula.

- [ ] **Step 2: Marcar la spec como implementada**

En el header de la spec, cambiar la línea de estado:

```markdown
**Estado:** Implementado — ver `docs/DEMORA_INFORMADA.md` para la guía de aplicación
```

- [ ] **Step 3: Commit**

```bash
git add docs/DEMORA_INFORMADA.md docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md
git commit -m "docs(demoras): guia operativa del motor de demora informada

Orden de aplicacion de las 6 migraciones, verificaciones post-apply, como
apagar el motor en caliente y como cambiar el estadistico sin deploy.
Incluye el riesgo R1 integro: el numero no se informa a un cliente hasta
que la brecha contra el AS400 este calibrada."
```

---

## Notas de ejecución

**Lo que NO hace este plan.** No aplica ninguna migración en Supabase — no se
puede desde acá (Postgres firewalleado). Al terminar, las 6 migraciones quedan
listas para pegar en el SQL Editor, en el orden de la Task 9.

**Los campos en Preferencias Globales.** Este plan deja la tabla `demoras_config`
sembrada con los tres tipos del escenario 1000 y editable por SQL. Exponerla en
`components/ui/PreferenciasGlobalesModal.tsx` es un incremento posterior, una
vez que el motor haya corrido unos días y sepamos qué vale la pena tocar. No
tiene sentido construir la pantalla antes de saber eso.

**Orden de dependencias.** Tasks 2, 3 y 4 son independientes entre sí y pueden
hacerse en cualquier orden o en paralelo. La 5 las necesita a las tres. La 6
necesita la 5. La 7 necesita la tabla de la 5. La 8 necesita la 7.

---

### Task 10: Cascada del ritmo completa y con orden configurable

Extiende `demoras_ritmo` de `zona → global` a la cascada de cuatro niveles que
pide la spec, con el **orden configurable** desde Preferencias Globales.
Requisito del usuario (2026-07-28).

**Files:**
- Modify: `docs/sqls/2026-07-29-demoras-ritmo.sql` → nueva migración
  `docs/sqls/2026-07-30-demoras-ritmo-cascada.sql` (`CREATE OR REPLACE`, no se
  edita la migración ya aplicada)
- Modify: `scripts/sql-harness/assert-ritmo.sql`
- Modify: `docs/DEMORA_INFORMADA.md` (documentar la clave nueva)

**Interfaces:**
- Consumes: `demoras_config.ritmo_cascada` por (escenario, tipo) (sembrada en la
  Task 5, default `'CHOFER,MOVIL,ZONA,GLOBAL'`), `metricas_cumplimiento`,
  `moviles_zonas`, `moviles_dia`.
- Produces: misma firma que `demoras_ritmo(p_escenario, p_hasta, p_dias, p_min_muestras)`.
  `ritmo_origen` pasa a poder valer `CHOFER | MOVIL | ZONA | GLOBAL`. La Task 5
  no necesita cambios: ya hace `LEFT JOIN` contra esta función y persiste
  `ritmo_origen` tal cual venga.

**Cómo se resuelve cada nivel.** Para un par (zona, tipo), los niveles CHOFER y
MOVIL no son valores únicos: la zona tiene varios móviles activos, cada uno con
su chofer. El ritmo del nivel es el **promedio ponderado por el aporte de cada
móvil a esa zona** — el mismo aporte que ya calcula `demoras_capacidad`, así que
un móvil de tránsito pesa menos que uno de prioridad, igual que en la capacidad.

- **CHOFER** — para cada móvil activo de la zona, el chofer que lo manejó más
  veces en la ventana (`metricas_cumplimiento.chofer` es nombre-texto, no hay id
  estable); se toma el ritmo de ese chofer y se pondera por el aporte del móvil.
  Cuenta como resuelto si la suma de muestras de los choferes considerados llega
  a `p_min_muestras`.
- **MOVIL** — igual pero agrupando por `movil` en vez de por `chofer`.
- **ZONA** — lo que ya hace hoy.
- **GLOBAL** — lo que ya hace hoy.

**Orden.** Se lee `demoras_config.ritmo_cascada` del tipo en cuestion como CSV, se recorre de izquierda a
derecha y **gana el primer nivel que llegue a `p_min_muestras`**. Niveles
desconocidos se ignoran; si la lista queda vacía o mal formada, se cae al
default `CHOFER,MOVIL,ZONA,GLOBAL`. `GLOBAL` se evalúa siempre último aunque no
esté en la lista, como red final.

- [ ] **Step 1: Escribir los asserts que fallan**

Extender `scripts/sql-harness/assert-ritmo.sql` con:

```sql
-- Cascada por defecto: con datos suficientes de chofer, gana CHOFER.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'CHOFER' THEN RAISE EXCEPTION 'esperaba CHOFER, obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok cascada default gana CHOFER';
END $$;

-- Sacando CHOFER de la lista, el mismo dato debe resolver por MOVIL.
UPDATE demoras_config SET ritmo_cascada='MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'MOVIL' THEN RAISE EXCEPTION 'esperaba MOVIL, obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok orden configurable saltea CHOFER';
END $$;

-- Lista solo con ZONA: debe resolver por ZONA, y caer a GLOBAL si no alcanza.
UPDATE demoras_config SET ritmo_cascada='ZONA' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'GLOBAL' THEN RAISE EXCEPTION 'GLOBAL debe ser la red final, obtuvo %', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok GLOBAL es red final aunque no este en la lista';
END $$;

-- Lista basura: cae al default sin romper.
UPDATE demoras_config SET ritmo_cascada='FRUTA,,XX' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=100 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen IS NULL THEN RAISE EXCEPTION 'lista basura no debe romper'; END IF;
  RAISE NOTICE 'ok lista invalida cae al default';
END $$;
UPDATE demoras_config SET ritmo_cascada='CHOFER,MOVIL,ZONA,GLOBAL' WHERE escenario_id=1000 AND tipo_servicio='URGENTE';
```

Los datos de prueba tienen que poblar `metricas_cumplimiento` con al menos un
chofer con ≥5 hechos en la zona 100, y `moviles_zonas` + `moviles_dia` para que
ese móvil esté activo y asignado a la zona.

- [ ] **Step 2: Correr los asserts y verificar que fallan**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-ritmo.sql --assert scripts/sql-harness/assert-ritmo.sql`
Expected: FALLA — `ritmo_origen` devuelve `ZONA` o `GLOBAL`, nunca `CHOFER`.

- [ ] **Step 3: Escribir la migración**

`docs/sqls/2026-07-30-demoras-ritmo-cascada.sql` con `CREATE OR REPLACE FUNCTION
demoras_ritmo(...)` manteniendo la firma. Estructura sugerida: un CTE por nivel
(`por_chofer`, `por_movil`, `por_zona`, `global`), todos sobre el mismo `base`,
más un `LATERAL` o un `CASE` en cascada que elija el primero que cumpla
`coalesce(n,0) >= p_min_muestras` siguiendo el orden leído de config.

Leer la config con:
```sql
v_cascada text[] := string_to_array(
  upper(coalesce((SELECT dc.ritmo_cascada FROM demoras_config dc
                   WHERE dc.escenario_id = p_escenario
                     AND dc.tipo_servicio = <tipo en curso>),
                 'CHOFER,MOVIL,ZONA,GLOBAL')), ',');
```

- [ ] **Step 4: Correr los asserts y verificar que pasan**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-ritmo.sql docs/sqls/2026-07-30-demoras-ritmo-cascada.sql --assert scripts/sql-harness/assert-ritmo.sql`
Expected: todos los `ok ...`, exit 0. Los asserts viejos de zona/global deben
seguir pasando.

- [ ] **Step 5: Documentar y commitear**

Agregar la columna `ritmo_cascada` a la tabla de configuración de
`docs/DEMORA_INFORMADA.md`, con los niveles válidos y la regla de que GLOBAL es
siempre la red final.

```bash
git add docs/sqls/2026-07-30-demoras-ritmo-cascada.sql scripts/sql-harness/assert-ritmo.sql docs/DEMORA_INFORMADA.md
git commit -m "feat(demoras): cascada del ritmo completa y con orden configurable

Sube de zona->global a chofer->movil->zona->global, con el orden leido de
demoras_config.ritmo_cascada por (escenario, tipo) (default
CHOFER,MOVIL,ZONA,GLOBAL) para poder cambiarlo desde Preferencias Globales
sin deploy y de forma distinta por tipo de servicio.

Los niveles CHOFER y MOVIL no son valores unicos por zona: se resuelven
como promedio ponderado por el aporte de cada movil, el mismo que usa
demoras_capacidad, asi que un movil de transito pesa menos que uno de
prioridad. Gana el primer nivel que llegue al minimo de muestras.

GLOBAL se evalua siempre ultimo aunque no este en la lista: es la red
final. Una lista vacia o mal formada cae al default sin romper."
```
