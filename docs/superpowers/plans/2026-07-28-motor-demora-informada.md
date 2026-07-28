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

-- El total de las 4 zonas suma exactamente 1 movil.
DO $$
DECLARE v numeric;
BEGIN
  SELECT sum(capacidad_efectiva) INTO v FROM demoras_capacidad(1000, DATE '2026-07-29');
  IF round(v,6) <> 1.0 THEN RAISE EXCEPTION 'suma total: obtuvo % esperaba 1.0', round(v,6); END IF;
  RAISE NOTICE 'ok suma = 1 movil';
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
    round(sum(CASE WHEN p.w > 0 THEN p.peso / p.w ELSE 0 END), 6) AS capacidad_efectiva,
    count(DISTINCT p.movil)::integer                          AS moviles_activos,
    count(DISTINCT p.movil) FILTER (WHERE p.es_prioridad)::integer     AS moviles_prioridad,
    count(DISTINCT p.movil) FILTER (WHERE NOT p.es_prioridad)::integer AS moviles_transito,
    (SELECT a FROM alpha)                                     AS alpha_usado
  FROM pesos p
  GROUP BY p.zona_id, p.tipo;
$fn$;

COMMENT ON FUNCTION demoras_capacidad(integer, date) IS
  'Capacidad efectiva por (zona, tipo): suma del aporte prorrateado de los moviles ACTIVOS. peso 1 prioridad / alpha transito, normalizado por tipo. Un movil nunca suma mas de 1 en total.';
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

> **⚠ DIVERGENCIA DELIBERADA RESPECTO DE LA SPEC.** La spec (§3.3) describe una
> cascada de cuatro niveles: `chofer → móvil → zona → global`, con el ritmo de la
> zona como promedio ponderado por aporte de los ritmos de sus móviles. Este plan
> implementa **solo `zona → global`**.
>
> Motivo: el nivel chofer exige resolver, en cada corrida y para cada móvil
> activo, quién lo está manejando hoy — dato que `moviles_dia` no trae y que
> habría que inferir de los pedidos ya cumplidos del día. Eso agrega una consulta
> pesada y una heurística nueva a un motor cuyo supuesto central todavía no está
> validado (riesgo R1).
>
> La columna `ritmo_origen` acepta igual `CHOFER` y `MOVIL` en su CHECK, así que
> subir de nivel más adelante no requiere migración de esquema — solo cambiar
> esta función. **Antes de dar el motor por terminado, actualizar §3.3 de la spec
> para que refleje lo implementado, o abrir una task para completar la cascada.**

- [ ] **Step 1: Escribir el assert que falla**

`scripts/sql-harness/assert-ritmo.sql`:

```sql
\set ON_ERROR_STOP on
TRUNCATE metricas_cumplimiento;

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
  IF r.ritmo_origen <> 'ZONA' THEN RAISE EXCEPTION 'zona 100 origen: % (esperaba ZONA)', r.ritmo_origen; END IF;
  IF r.ritmo_muestras <> 5 THEN RAISE EXCEPTION 'zona 100 muestras: %', r.ritmo_muestras; END IF;
  IF round(r.ritmo_mediana,2) <> 30.00 THEN RAISE EXCEPTION 'mediana: % (esperaba 30)', r.ritmo_mediana; END IF;
  IF round(r.ritmo_media,2) <> 40.00 THEN RAISE EXCEPTION 'media: % (esperaba 40)', r.ritmo_media; END IF;
  IF r.ritmo_p90 <= r.ritmo_mediana THEN RAISE EXCEPTION 'p90 debe superar la mediana'; END IF;
  RAISE NOTICE 'ok zona con muestras suficientes';
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM demoras_ritmo(1000, DATE '2026-07-29') WHERE zona_id=200 AND tipo_servicio='URGENTE';
  IF r.ritmo_origen <> 'GLOBAL' THEN RAISE EXCEPTION 'zona 200 origen: % (esperaba GLOBAL)', r.ritmo_origen; END IF;
  RAISE NOTICE 'ok fallback a global por pocas muestras';
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
  WITH base AS (
    SELECT m.zona_nro,
           m.tipo_servicio AS tipo,
           m.demora_efectiva_mins AS v
    FROM metricas_cumplimiento m
    WHERE m.escenario = p_escenario
      AND m.fecha BETWEEN (p_hasta - p_dias) AND (p_hasta - 1)
      AND m.zona_nro IS NOT NULL
      -- ESPECIAL y OTROS quedan FUERA del motor de demora por decision del
      -- usuario (2026-07-28): no se pliegan a URGENTE ni a ningun otro
      -- balde. Solo se informa demora de los tres tipos que tienen oferta
      -- propia en moviles_zonas.
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
  SELECT z.zona_id,
         z.tipo,
         CASE WHEN z.n >= p_min_muestras THEN z.media   ELSE g.media   END,
         CASE WHEN z.n >= p_min_muestras THEN z.mediana ELSE g.mediana END,
         CASE WHEN z.n >= p_min_muestras THEN z.p75     ELSE g.p75     END,
         CASE WHEN z.n >= p_min_muestras THEN z.p90     ELSE g.p90     END,
         CASE WHEN z.n >= p_min_muestras THEN 'ZONA'    ELSE 'GLOBAL'  END,
         CASE WHEN z.n >= p_min_muestras THEN z.n       ELSE g.n       END
  FROM por_zona z
  LEFT JOIN global g ON g.tipo = z.tipo;
$fn$;

COMMENT ON FUNCTION demoras_ritmo(integer, date, integer, integer) IS
  'Las cuatro estadisticas (media/mediana/p75/p90) de demora_efectiva_mins por (zona, tipo) sobre los ultimos p_dias. Cae al global del tipo si la zona no llega a p_min_muestras. ESPECIAL y OTROS se pliegan a URGENTE.';
```

- [ ] **Step 4: Correr el assert para verificar que pasa**

Run: `bash scripts/sql-harness/run.sh docs/sqls/2026-07-29-demoras-ritmo.sql --assert scripts/sql-harness/assert-ritmo.sql`
Expected: todos los `ok ...` y exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-07-29-demoras-ritmo.sql scripts/sql-harness/assert-ritmo.sql
git commit -m "feat(demoras): ritmo por zona con las cuatro estadisticas

Calcula media, mediana, p75 y p90 de demora_efectiva_mins de los ultimos 7
dias, y guarda las cuatro. Cual manda lo decide la config: tener todas
permite reprocesar el historico con otra sin recalcular.

Cae al global del tipo cuando la zona no llega a 5 muestras. ESPECIAL y
OTROS se pliegan a URGENTE porque no tienen moviles propios."
```

---

### Task 5: Tabla, configuración y orquestador `demoras_calcular_run`

**Files:**
- Create: `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`
- Create: `docs/sqls/2026-07-29-demoras-calcular-run.sql`
- Create: `scripts/sql-harness/assert-run.sql`

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

-- ─── Configuracion (app_config es key-value TEXT) ────────────────────
INSERT INTO app_config (key, value, description) VALUES
  ('demora_min_minutos',        '30',      'Motor de demora: piso en minutos'),
  ('demora_max_minutos',        '120',     'Motor de demora: techo en minutos'),
  ('demora_escalon_minutos',    '15',      'Motor de demora: redondeo hacia arriba'),
  ('demora_subida_max',         '30',      'Motor de demora: cuanto puede subir por corrida'),
  ('demora_bajada_max',         '15',      'Motor de demora: cuanto puede bajar por corrida'),
  ('demora_estadistico',        'MEDIANA', 'Motor de demora: MEDIA|MEDIANA|P75|P90'),
  ('demora_hora_inicio',        '07:00',   'Motor de demora: inicio de ventana (Montevideo)'),
  ('demora_hora_fin',           '23:30',   'Motor de demora: fin de ventana (Montevideo)'),
  ('demora_factor_calibracion', '1.0',     'Motor de demora: multiplicador global (ver riesgo R1)'),
  ('demora_motor_activo',       'true',    'Motor de demora: interruptor de emergencia')
ON CONFLICT (key) DO NOTHING;
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
VALUES (1000, 10, (now() AT TIME ZONE 'America/Montevideo')::date, true),
       (1000, 11, (now() AT TIME ZONE 'America/Montevideo')::date, true);

-- 10 pedidos pendientes en zona 100 -> con ritmo global de 20 min y
-- capacidad 1.0, el crudo da 200 -> clampea a 120.
INSERT INTO pedidos (id, escenario, servicio_nombre, movil, zona_nro, estado_nro, fch_para)
SELECT g, 1000, 'URGENTE', 10, 100, 1,
       to_char((now() AT TIME ZONE 'America/Montevideo')::date, 'YYYYMMDD')
FROM generate_series(1,10) g;

INSERT INTO metricas_cumplimiento
  (origen, pedido_id, escenario, fecha, tipo_servicio, movil, zona_nro, chofer,
   fch_hora_finalizacion, demora_mins, demora_efectiva_mins, asignado_source)
SELECT 'PEDIDO', 1000+g, 1000, (now() AT TIME ZONE 'America/Montevideo')::date - 1,
       'URGENTE', 10, 100, 'ANA', now(), 20, 20, 'CAMPO'
FROM generate_series(1,10) g;

-- Fuerza ventana abierta para que el assert no dependa de la hora real.
UPDATE app_config SET value='00:00' WHERE key='demora_hora_inicio';
UPDATE app_config SET value='23:59' WHERE key='demora_hora_fin';

DO $$
DECLARE n bigint; r record;
BEGIN
  n := demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  IF n < 1 THEN RAISE EXCEPTION 'no escribio filas'; END IF;

  SELECT * INTO r FROM demoras_calculadas
   WHERE zona_id=100 AND tipo_servicio='URGENTE' AND corrida_at = timestamptz '2026-07-29 15:00:00-03';
  IF r IS NULL THEN RAISE EXCEPTION 'falta la fila de la zona 100'; END IF;
  IF r.demora_informada <> 120 THEN RAISE EXCEPTION 'informada: % (esperaba 120)', r.demora_informada; END IF;
  IF r.clampeado <> 'MAX' THEN RAISE EXCEPTION 'clampeado: % (esperaba MAX)', r.clampeado; END IF;
  IF r.demora_as400 <> 35 THEN RAISE EXCEPTION 'snapshot as400: % (esperaba 35)', r.demora_as400; END IF;
  IF r.pendientes_asignados <> 10 THEN RAISE EXCEPTION 'pendientes: %', r.pendientes_asignados; END IF;
  RAISE NOTICE 'ok calculo y snapshot';

  -- La zona INACTIVA no debe emitir fila.
  PERFORM 1 FROM demoras_calculadas WHERE zona_id=900;
  IF FOUND THEN RAISE EXCEPTION 'la zona inactiva no debe emitir fila'; END IF;
  RAISE NOTICE 'ok ignora zonas inactivas';
END $$;

-- Idempotencia: la misma corrida_at dos veces no duplica ni cambia.
DO $$
DECLARE a bigint; b bigint;
BEGIN
  SELECT count(*) INTO a FROM demoras_calculadas;
  PERFORM demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03');
  SELECT count(*) INTO b FROM demoras_calculadas;
  IF a <> b THEN RAISE EXCEPTION 'no es idempotente: % -> %', a, b; END IF;
  RAISE NOTICE 'ok idempotente';
END $$;

-- Interruptor de emergencia.
UPDATE app_config SET value='false' WHERE key='demora_motor_activo';
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 16:00:00-03') <> 0 THEN
    RAISE EXCEPTION 'el interruptor no apago el motor';
  END IF;
  RAISE NOTICE 'ok interruptor';
END $$;
UPDATE app_config SET value='true' WHERE key='demora_motor_activo';

-- Fuera de ventana.
UPDATE app_config SET value='07:00' WHERE key='demora_hora_inicio';
UPDATE app_config SET value='08:00' WHERE key='demora_hora_fin';
DO $$
BEGIN
  IF demoras_calcular_run(timestamptz '2026-07-29 15:00:00-03') <> 0 THEN
    RAISE EXCEPTION 'corrio fuera de ventana';
  END IF;
  RAISE NOTICE 'ok ventana horaria';
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
-- =====================================================================
CREATE OR REPLACE FUNCTION demoras_calcular_run(p_corrida_at timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_esc        integer := 1000;
  v_local      timestamp;
  v_fecha      date;
  v_hora       time;
  v_ini        time;
  v_fin        time;
  v_activo     boolean;
  v_min        integer;  v_max     integer;  v_escalon integer;
  v_subida     integer;  v_bajada  integer;
  v_estad      text;     v_factor  numeric;
  v_escritas   bigint;
  cfg          jsonb;
BEGIN
  SELECT jsonb_object_agg(key, value) INTO cfg FROM app_config WHERE key LIKE 'demora\_%';

  v_activo := coalesce((cfg->>'demora_motor_activo')::boolean, true);
  IF NOT v_activo THEN RETURN 0; END IF;

  v_local := p_corrida_at AT TIME ZONE 'America/Montevideo';
  v_fecha := v_local::date;
  v_hora  := v_local::time;
  v_ini   := coalesce((cfg->>'demora_hora_inicio')::time, time '07:00');
  v_fin   := coalesce((cfg->>'demora_hora_fin')::time,    time '23:30');
  IF v_hora < v_ini OR v_hora > v_fin THEN RETURN 0; END IF;

  v_min     := coalesce((cfg->>'demora_min_minutos')::integer, 30);
  v_max     := coalesce((cfg->>'demora_max_minutos')::integer, 120);
  v_escalon := coalesce((cfg->>'demora_escalon_minutos')::integer, 15);
  v_subida  := coalesce((cfg->>'demora_subida_max')::integer, 30);
  v_bajada  := coalesce((cfg->>'demora_bajada_max')::integer, 15);
  v_estad   := coalesce(cfg->>'demora_estadistico', 'MEDIANA');
  v_factor  := coalesce((cfg->>'demora_factor_calibracion')::numeric, 1.0);

  WITH
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
      SELECT zona_nro, movil,
             CASE upper(trim(coalesce(servicio_nombre,'')))
               WHEN 'NOCTURNO' THEN 'NOCTURNO'
               WHEN 'URGENTE'  THEN 'URGENTE'
               ELSE NULL
             END AS tipo
      FROM pedidos
      WHERE escenario = v_esc AND estado_nro = 1
        AND fch_para = to_char(v_fecha, 'YYYYMMDD') AND zona_nro IS NOT NULL
      UNION ALL
      SELECT zona_nro, movil, 'SERVICE'
      FROM services
      WHERE escenario = v_esc AND estado_nro = 1
        AND fch_para = to_char(v_fecha, 'YYYYMMDD') AND zona_nro IS NOT NULL
    ) p
    WHERE p.tipo IS NOT NULL
    GROUP BY zona_nro, tipo
  ),
  -- Universo: todo par (zona activa, tipo) que tenga moviles asignados.
  universo AS (
    SELECT c.zona_id, c.tipo_servicio
    FROM cap c JOIN zonas_activas za ON za.zona_id = c.zona_id
  ),
  prev AS (
    SELECT DISTINCT ON (zona_id, tipo_servicio) zona_id, tipo_servicio, demora_suavizada
    FROM demoras_calculadas
    WHERE escenario = v_esc
      AND corrida_at < p_corrida_at
      AND (corrida_at AT TIME ZONE 'America/Montevideo')::date = v_fecha
    ORDER BY zona_id, tipo_servicio, corrida_at DESC
  ),
  arm AS (
    SELECT
      u.zona_id, u.tipo_servicio,
      coalesce(d.asignados,0) AS asignados,
      coalesce(d.sin_asignar,0) AS sin_asignar,
      coalesce(d.atrapados,0) AS atrapados,
      coalesce(c.capacidad_efectiva,0) AS capacidad,
      coalesce(c.moviles_activos,0) AS mov_act,
      coalesce(c.moviles_prioridad,0) AS mov_pri,
      coalesce(c.moviles_transito,0) AS mov_tra,
      coalesce(c.alpha_usado,0.3) AS alpha,
      r.ritmo_media, r.ritmo_mediana, r.ritmo_p75, r.ritmo_p90,
      r.ritmo_origen, r.ritmo_muestras,
      CASE v_estad WHEN 'MEDIA' THEN r.ritmo_media
                   WHEN 'P75'   THEN r.ritmo_p75
                   WHEN 'P90'   THEN r.ritmo_p90
                   ELSE r.ritmo_mediana END AS ritmo_usado,
      p.demora_suavizada AS prev_suav,
      (SELECT dd.minutos FROM demoras dd
        WHERE dd.escenario_id = v_esc AND dd.zona_id = u.zona_id
          AND dd.descripcion = u.tipo_servicio LIMIT 1) AS as400
    FROM universo u
    LEFT JOIN cap  c ON c.zona_id = u.zona_id AND c.tipo_servicio = u.tipo_servicio
    LEFT JOIN dem  d ON d.zona_id = u.zona_id AND d.tipo         = u.tipo_servicio
    LEFT JOIN rit  r ON r.zona_id = u.zona_id AND r.tipo_servicio = u.tipo_servicio
    LEFT JOIN prev p ON p.zona_id = u.zona_id AND p.tipo_servicio = u.tipo_servicio
  ),
  crudo AS (
    SELECT a.*,
           (a.asignados + a.sin_asignar) AS pendientes_total,
           CASE
             WHEN (a.asignados + a.sin_asignar) = 0 THEN v_min::numeric
             WHEN a.capacidad <= 0                  THEN v_max::numeric
             ELSE ((a.asignados + a.sin_asignar)::numeric / a.capacidad)
                  * coalesce(a.ritmo_usado, 30) * v_factor
           END AS demora_cruda
    FROM arm a
  ),
  final AS (
    SELECT c.*, f.suavizada, f.informada, f.clampeado, f.suavizado_aplicado
    FROM crudo c
    CROSS JOIN LATERAL demoras_acabado(
      c.demora_cruda, c.prev_suav, v_min, v_max, v_subida, v_bajada, v_escalon
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
      f.ritmo_usado, coalesce(f.ritmo_origen,'GLOBAL'), f.ritmo_muestras,
      (f.capacidad <= 0 AND f.pendientes_total > 0), f.clampeado, f.suavizado_aplicado
    FROM final f
    ON CONFLICT (corrida_at, escenario, zona_id, tipo_servicio) DO UPDATE SET
      demora_informada = EXCLUDED.demora_informada,
      demora_suavizada = EXCLUDED.demora_suavizada,
      demora_cruda     = EXCLUDED.demora_cruda,
      demora_as400     = EXCLUDED.demora_as400
    RETURNING 1
  )
  SELECT count(*) INTO v_escritas FROM ins;

  RETURN v_escritas;
END;
$fn$;

COMMENT ON FUNCTION demoras_calcular_run(timestamptz) IS
  'Motor de demora informada. Corre sobre zonas activas con moviles asignados, usando solo moviles activos. Evalua la ventana horaria internamente (pg_cron corre en UTC y la ventana cruza medianoche UTC). Devuelve filas escritas; 0 si esta apagado o fuera de ventana.';
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

-- Retencion: 30 dias de detalle. ~25.000 filas/dia -> ~750k en regimen.
SELECT cron.unschedule('demoras-purga')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demoras-purga');
SELECT cron.schedule('demoras-purga', '40 4 * * *',
  $cron$ DELETE FROM demoras_calculadas WHERE corrida_at < now() - interval '30 days'; $cron$);

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
- **Cómo apagar el motor en caliente**: `UPDATE app_config SET value='false' WHERE key='demora_motor_activo';`
- **Cómo cambiar el estadístico**: `UPDATE app_config SET value='P75' WHERE key='demora_estadistico';`
- **El riesgo R1 copiado íntegro** desde la spec, con el recordatorio de que el
  número no debe informarse a un cliente hasta que la brecha esté calibrada.
- **Tabla de las 10 claves de configuración** con sus defaults.

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

**Los campos en Preferencias Globales.** Este plan deja las 10 claves sembradas
en `app_config` y editables por SQL. Exponerlas en
`components/ui/PreferenciasGlobalesModal.tsx` es un incremento posterior, una
vez que el motor haya corrido unos días y sepamos qué vale la pena tocar. No
tiene sentido construir la pantalla antes de saber eso.

**Orden de dependencias.** Tasks 2, 3 y 4 son independientes entre sí y pueden
hacerse en cualquier orden o en paralelo. La 5 las necesita a las tres. La 6
necesita la 5. La 7 necesita la tabla de la 5. La 8 necesita la 7.
