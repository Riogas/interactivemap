# `moviles_dia` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover el armado de la lista de móviles del dashboard a una tabla denormalizada `moviles_dia` (read model), de modo que el cliente haga 1 lectura + 1 canal realtime en vez de ~5 queries + 4 canales + joins client-side, sin cambiar el comportamiento observable.

**Architecture:** Tabla `moviles_dia` (1 fila por `escenario_id, movil_id, fecha`) mantenida por: triggers SQL para estado/identidad (sobre `moviles`) y posición (sobre la ingesta GPS); recompute a nivel aplicación de pendientes + flags al consumir `/api/pedidos` y `/api/services`; y una función `rebuild` re-ejecutable (utilidad en Preferencias Globales) para backfill/corrección. El cliente lee vía `/api/moviles-dia` + canal realtime `moviles_dia`. Cumplimiento, atrasados y "sin reportar" se siguen calculando on-demand en el cliente (dependen del reloj/prefs). Migración aditiva detrás de feature flag `NEXT_PUBLIC_USE_MOVILES_DIA`; código viejo se borra en la última fase.

**Tech Stack:** Next.js 14 (app router), TypeScript, Supabase (Postgres + Realtime), vitest. SQL versionado en `docs/sqls/` (aplicado manualmente / `scripts/migrate-supabase.js`). Tests en `__tests__/`. Scripts operativos en `scripts/*.mjs`.

**Spec de referencia:** `docs/superpowers/specs/2026-05-27-moviles-dia-projection-design.md` (leerla antes de empezar).

**Regla transversal — sin-asignar:** El comportamiento de pedidos/services SIN móvil no cambia: sigue dependiendo de las funcionalidades (`canVerSinAsignarUnitario`) y del gate `allMovilesSelected`. No tocar esa lógica. Única precaución: `allMovilesSelected` debe seguir calculándose correctamente tras migrar la carga de móviles (Tarea 4.4).

---

## File Structure

**Nuevos (SQL):**
- `docs/sqls/2026-05-27-create-moviles-dia.sql` — tabla + índices.
- `docs/sqls/2026-05-27-moviles-dia-triggers.sql` — triggers de estado (sobre `moviles`) y posición (sobre ingesta GPS).
- `docs/sqls/2026-05-27-moviles-dia-functions.sql` — `fn_moviles_dia_recompute_counts`, `fn_moviles_dia_recompute_counts_bulk`, `fn_moviles_dia_rebuild`.

**Nuevos (app):**
- `app/api/moviles-dia/route.ts` — GET lectura (reemplaza all-positions + moviles-extended).
- `app/api/moviles-dia/rebuild/route.ts` — POST admin para disparar `fn_moviles_dia_rebuild`.
- `lib/hooks/useMovilesDiaRealtime.ts` — hook de suscripción realtime a `moviles_dia`.
- `lib/moviles/moviles-dia-mapper.ts` — mapea fila `moviles_dia` → `MovilData` (1 sola fuente de mapeo, reusada por API y tests).
- `scripts/parity-moviles-dia.mjs` — script de paridad (compara `fn_moviles_dia_rebuild` vs lógica client-side).

**Modificados (app):**
- `app/api/pedidos/route.ts` y `app/api/services/route.ts` — invocar recompute bulk de pendientes.
- `app/dashboard/page.tsx` — `fetchMovilesDia`, suscripción nueva, borrado de derivaciones.
- `components/ui/MovilSelector.tsx` — consumir flags precalculados; orden/selección/título (§4.1).
- `components/map/MapView.tsx` — `getMovilColor`/íconos desde campos de `moviles_dia`; inactivos fuera del mapa.
- `components/map/MovilesZonasLayer.tsx` — filtrar por flag `activo`.
- `components/map/RouteAnimationControl.tsx` / `components/ui/TrackingModal.tsx` — lista desde `moviles_dia`.
- `components/dashboard/DashboardIndicators.tsx`, `components/dashboard/MovilesSinGPS.tsx`, `components/ui/LeaderboardModal.tsx`, `components/ui/ZonaEstadisticasModal.tsx`, `components/ui/PedidosTableModal.tsx`, `components/ui/ServicesTableModal.tsx`, `components/ui/PreferenciasGlobalesModal.tsx`.
- `components/providers/RealtimeProvider.tsx`, `lib/hooks/useRealtimeSubscriptions.ts` — canal nuevo; (Fase 7) retiro de los viejos.
- `types/index.ts` — `MovilDiaRow` y, si aplica, ajustes a `MovilData`.

**Tests:** `__tests__/moviles-dia-mapper.test.ts`, `__tests__/moviles-dia-parity.test.ts` (+ ajustes a los tests existentes en Fase 7).

---

## FASE 1 — Esquema + población de `moviles_dia` (backend puro, front intacto)

Objetivo: la tabla existe, se puebla y queda verificada contra la realidad. El front no se toca. Al terminar, todo sigue funcionando exactamente igual.

> **Pre-lectura obligatoria** (NO escribir SQL sin leer esto, los nombres/tipos reales mandan):
> - `docs/sqls/2026-05-12-add-movil-counters.sql` y `2026-05-12-moviles-counters-updated-at.sql` — columnas `cant_ped`/`cant_serv` ya existentes en `moviles` y cómo se mantienen.
> - `docs/sqls/2026-05-18-gps-latest-empresa-fletera.sql` y el trigger `sync_gps_latest_position` — punto de ingesta GPS al que engancharemos.
> - `docs/sqls/2026-05-13-fn-moviles-con-gps-dia.sql` — función existente de "móviles con GPS en una fecha" (reutilizable en rebuild y en "Ver recorrido").
> - `app/api/all-positions/route.ts` y `app/api/moviles-extended/route.ts` — la lógica de inclusión y los conteos a portar.
> - `lib/moviles/visibility.ts` — semántica exacta de `isMovilActiveForUI`, `getHiddenMovilIds`, `getMovilesConOperacionEnFecha`.

### Task 1.1: Crear la tabla `moviles_dia`

**Files:**
- Create: `docs/sqls/2026-05-27-create-moviles-dia.sql`

- [ ] **Step 1: Escribir el SQL de la tabla**

```sql
-- docs/sqls/2026-05-27-create-moviles-dia.sql
-- Read model denormalizado para la carga de móviles del dashboard.
-- 1 fila por (escenario_id, movil_id, fecha). Cache RECONSTRUIBLE (ver fn_moviles_dia_rebuild).
CREATE TABLE IF NOT EXISTS moviles_dia (
  escenario_id        integer     NOT NULL,
  movil_id            integer     NOT NULL,
  fecha               date        NOT NULL,

  empresa_fletera_id  integer,
  matricula           text,
  descripcion         text,

  estado_nro          integer,
  estado_desc         text,
  tamano_lote         integer,          -- NULL para fechas pasadas (no aplica)

  pedidos_pendientes  integer,          -- NULL para fechas pasadas
  services_pendientes integer,          -- NULL para fechas pasadas

  last_gps_lat        double precision,
  last_gps_lng        double precision,
  last_gps_datetime   timestamptz,

  activo              boolean     NOT NULL DEFAULT false,  -- isMovilActiveForUI(estado_nro)
  oculto_operativo    boolean     NOT NULL DEFAULT false,  -- !activo && tiene operación en fecha
  inactivo_del_dia    boolean     NOT NULL DEFAULT false,  -- inactivo && trabajó en la fecha

  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (escenario_id, movil_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_moviles_dia_lookup ON moviles_dia (escenario_id, fecha, empresa_fletera_id);
CREATE INDEX IF NOT EXISTS idx_moviles_dia_activo ON moviles_dia (escenario_id, fecha, activo);
CREATE INDEX IF NOT EXISTS idx_moviles_dia_gps ON moviles_dia (escenario_id, fecha) WHERE last_gps_datetime IS NOT NULL;
```

- [ ] **Step 2: Aplicar contra la base de staging/dev**

Run (ajustar al método del repo, p.ej.): `node scripts/migrate-supabase.js docs/sqls/2026-05-27-create-moviles-dia.sql`
Expected: tabla creada sin error.

- [ ] **Step 3: Verificar el schema**

Run (psql/SQL editor): `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='moviles_dia' ORDER BY ordinal_position;`
Expected: 17 columnas con los tipos de arriba.

- [ ] **Step 4: Commit**

```bash
git add docs/sqls/2026-05-27-create-moviles-dia.sql
git commit -m "feat(db): tabla moviles_dia (read model de carga de móviles)"
```

### Task 1.2: Habilitar Realtime y RLS base sobre `moviles_dia`

**Files:**
- Modify: `docs/sqls/2026-05-27-create-moviles-dia.sql` (append)

- [ ] **Step 1: Agregar la tabla a la publicación de realtime + RLS**

```sql
-- Realtime (ajustar al nombre real de la publicación del proyecto, normalmente supabase_realtime)
ALTER PUBLICATION supabase_realtime ADD TABLE moviles_dia;

-- RLS: lectura scopeada. La lectura inicial va por API service-role; el realtime client-side
-- usa anon/auth → política que limita por escenario (y, si el modelo de auth lo permite, por empresa).
ALTER TABLE moviles_dia ENABLE ROW LEVEL SECURITY;

-- Política mínima de lectura (refinar en Fase 3 con el modelo de empresas real).
CREATE POLICY moviles_dia_read ON moviles_dia
  FOR SELECT USING (true);  -- placeholder permisivo; se endurece en Fase 3 (Task 3.3)
```

> Nota: si el proyecto NO usa RLS en el resto de tablas realtime (revisar `gps_latest_positions`), replicar ese mismo modelo en vez de introducir RLS nuevo. El endurecimiento real se hace en Task 3.3.

- [ ] **Step 2: Aplicar y verificar**

Run: `SELECT * FROM pg_publication_tables WHERE tablename='moviles_dia';`
Expected: una fila (tabla en la publicación de realtime).

- [ ] **Step 3: Commit**

```bash
git add docs/sqls/2026-05-27-create-moviles-dia.sql
git commit -m "feat(db): realtime + RLS base para moviles_dia"
```

### Task 1.3: Función de rebuild (carga inicial, corrección y reconstrucción de fechas)

**Files:**
- Create: `docs/sqls/2026-05-27-moviles-dia-functions.sql`

- [ ] **Step 1: Escribir `fn_moviles_dia_recompute_counts` (pendientes + flags de un móvil/fecha)**

```sql
-- docs/sqls/2026-05-27-moviles-dia-functions.sql
-- Recalcula pendientes + flags cruzados para un (escenario, movil, fecha).
-- Port de visibility.ts: oculto_operativo = !activo && tiene operación; inactivo_del_dia = !activo && trabajó.
CREATE OR REPLACE FUNCTION fn_moviles_dia_recompute_counts(
  p_escenario integer, p_movil integer, p_fecha date
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ped_pend  integer;
  v_serv_pend integer;
  v_tiene_op  boolean;
  v_activo    boolean;
BEGIN
  -- ¡AJUSTAR nombres de columnas de pedidos/services al schema real!
  -- 'fch_para' = YYYYMMDD; estado 1 = pendiente.
  SELECT count(*) INTO v_ped_pend
    FROM pedidos
   WHERE escenario = p_escenario AND movil = p_movil
     AND estado_nro = 1 AND fch_para = to_char(p_fecha,'YYYYMMDD');

  SELECT count(*) INTO v_serv_pend
    FROM services
   WHERE movil = p_movil AND estado_nro = 1
     AND (fch_para = to_char(p_fecha,'YYYYMMDD')
          OR fch_hora_para::date = p_fecha);

  v_tiene_op := (v_ped_pend > 0 OR v_serv_pend > 0
                 OR EXISTS (SELECT 1 FROM pedidos WHERE escenario=p_escenario AND movil=p_movil AND fch_para=to_char(p_fecha,'YYYYMMDD'))
                 OR EXISTS (SELECT 1 FROM services WHERE movil=p_movil AND (fch_para=to_char(p_fecha,'YYYYMMDD') OR fch_hora_para::date=p_fecha)));

  SELECT (estado_nro IS NULL OR estado_nro IN (0,1,2,4)) INTO v_activo
    FROM moviles WHERE id = p_movil;  -- ¡AJUSTAR PK real de moviles!

  UPDATE moviles_dia SET
    pedidos_pendientes  = v_ped_pend,
    services_pendientes = v_serv_pend,
    oculto_operativo    = (NOT coalesce(v_activo,true)) AND v_tiene_op,
    inactivo_del_dia    = (NOT coalesce(v_activo,true)) AND v_tiene_op,
    updated_at          = now()
  WHERE escenario_id = p_escenario AND movil_id = p_movil AND fecha = p_fecha;
END $$;
```

> ⚠️ Confirmar contra `app/api/moviles-extended/route.ts` la condición EXACTA de conteo (fechas, estados, filtros). Confirmar nombres de columnas (`movil`, `escenario`, `fch_para`, `fch_hora_para`, `estado_nro`, PK de `moviles`).

- [ ] **Step 2: Escribir la versión bulk (para la API)**

```sql
-- Recompute para un conjunto de móviles de un (escenario, fecha). Usado por /api/pedidos y /api/services.
CREATE OR REPLACE FUNCTION fn_moviles_dia_recompute_counts_bulk(
  p_escenario integer, p_fecha date, p_moviles integer[]
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m integer;
BEGIN
  FOREACH m IN ARRAY p_moviles LOOP
    PERFORM fn_moviles_dia_recompute_counts(p_escenario, m, p_fecha);
  END LOOP;
END $$;
```

- [ ] **Step 3: Escribir `fn_moviles_dia_rebuild` (rango de fechas; hoy=completo, pasado=reducido)**

```sql
-- Reconstruye moviles_dia para un rango. Idempotente. Carga inicial + corrección + reconstrucción histórica.
CREATE OR REPLACE FUNCTION fn_moviles_dia_rebuild(
  p_desde date, p_hasta date, p_escenario integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_fecha date;
  v_rows  integer := 0;
BEGIN
  v_fecha := p_desde;
  WHILE v_fecha <= p_hasta LOOP
    IF v_fecha = current_date THEN
      -- DÍA EN CURSO: fila completa. Universo = móviles visibles (mostrar_en_mapa)
      -- UNION móviles con operación/GPS del día. (AJUSTAR a la lógica real de all-positions.)
      INSERT INTO moviles_dia AS d
        (escenario_id, movil_id, fecha, empresa_fletera_id, matricula, descripcion,
         estado_nro, estado_desc, tamano_lote, last_gps_lat, last_gps_lng, last_gps_datetime,
         activo, updated_at)
      SELECT m.escenario_id, m.id, v_fecha, m.empresa_fletera_id, m.matricula, m.descripcion,
             m.estado_nro, m.estado_desc, m.tamano_lote,
             g.lat, g.lng, g.fecha_ins_log,
             (m.estado_nro IS NULL OR m.estado_nro IN (0,1,2,4)), now()
        FROM moviles m
        LEFT JOIN gps_latest_positions g ON g.movil_id = m.id
       WHERE (p_escenario IS NULL OR m.escenario_id = p_escenario)
         AND m.mostrar_en_mapa = true
      ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
        empresa_fletera_id = EXCLUDED.empresa_fletera_id, matricula = EXCLUDED.matricula,
        descripcion = EXCLUDED.descripcion, estado_nro = EXCLUDED.estado_nro,
        estado_desc = EXCLUDED.estado_desc, tamano_lote = EXCLUDED.tamano_lote,
        last_gps_lat = EXCLUDED.last_gps_lat, last_gps_lng = EXCLUDED.last_gps_lng,
        last_gps_datetime = EXCLUDED.last_gps_datetime, activo = EXCLUDED.activo, updated_at = now();
      -- Recompute pendientes+flags para los móviles del día
      PERFORM fn_moviles_dia_recompute_counts(escenario_id, movil_id, v_fecha)
        FROM moviles_dia WHERE fecha = v_fecha AND (p_escenario IS NULL OR escenario_id = p_escenario);
    ELSE
      -- FECHA PASADA: reducida. Universo = móviles referenciados en pedidos/services o con GPS esa fecha.
      -- Todos inactivos; sin pendientes ni tamano_lote.
      INSERT INTO moviles_dia AS d
        (escenario_id, movil_id, fecha, empresa_fletera_id, matricula, descripcion,
         estado_nro, estado_desc, tamano_lote, pedidos_pendientes, services_pendientes,
         last_gps_lat, last_gps_lng, last_gps_datetime, activo, oculto_operativo, inactivo_del_dia, updated_at)
      SELECT m.escenario_id, m.id, v_fecha, m.empresa_fletera_id, m.matricula, m.descripcion,
             m.estado_nro, m.estado_desc, NULL, NULL, NULL,
             lp.lat, lp.lng, lp.ts, false, false, true, now()
        FROM (
          SELECT DISTINCT movil_id FROM (
            SELECT movil::int AS movil_id FROM pedidos WHERE fch_para = to_char(v_fecha,'YYYYMMDD') AND movil IS NOT NULL AND movil <> 0
            UNION SELECT movil::int FROM services WHERE (fch_para = to_char(v_fecha,'YYYYMMDD') OR fch_hora_para::date = v_fecha) AND movil IS NOT NULL AND movil <> 0
            UNION SELECT movil_id FROM gps_tracking_history WHERE fecha_ins_log::date = v_fecha
          ) u
        ) ref
        JOIN moviles m ON m.id = ref.movil_id
        LEFT JOIN LATERAL (
          SELECT lat, lng, fecha_ins_log AS ts FROM gps_tracking_history
           WHERE movil_id = ref.movil_id AND fecha_ins_log::date = v_fecha
           ORDER BY fecha_ins_log DESC LIMIT 1
        ) lp ON true
       WHERE (p_escenario IS NULL OR m.escenario_id = p_escenario)
      ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
        empresa_fletera_id = EXCLUDED.empresa_fletera_id, matricula = EXCLUDED.matricula,
        descripcion = EXCLUDED.descripcion, last_gps_lat = EXCLUDED.last_gps_lat,
        last_gps_lng = EXCLUDED.last_gps_lng, last_gps_datetime = EXCLUDED.last_gps_datetime,
        activo = false, oculto_operativo = false, inactivo_del_dia = true,
        tamano_lote = NULL, pedidos_pendientes = NULL, services_pendientes = NULL, updated_at = now();
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_fecha := v_fecha + 1;
  END LOOP;
  RETURN v_rows;
END $$;
```

> ⚠️ Los nombres de columnas (`gps_latest_positions.lat/lng/fecha_ins_log`, `gps_tracking_history.movil_id/lat/lng/fecha_ins_log`, `moviles.mostrar_en_mapa/escenario_id/empresa_fletera_id/estado_desc/tamano_lote`, `pedidos.movil/fch_para`) son tentativos: AJUSTAR al schema real verificado en la pre-lectura.

- [ ] **Step 4: Aplicar y smoke-test del rebuild para hoy**

Run: `SELECT fn_moviles_dia_rebuild(current_date, current_date);` luego `SELECT count(*), count(*) FILTER (WHERE activo) FROM moviles_dia WHERE fecha=current_date;`
Expected: cantidad de filas > 0 y coherente con la cantidad de móviles visibles hoy.

- [ ] **Step 5: Commit**

```bash
git add docs/sqls/2026-05-27-moviles-dia-functions.sql
git commit -m "feat(db): funciones recompute + rebuild de moviles_dia"
```

### Task 1.4: Triggers de estado (moviles) y posición (GPS)

**Files:**
- Create: `docs/sqls/2026-05-27-moviles-dia-triggers.sql`

- [ ] **Step 1: Trigger sobre `moviles` → upsert estado/identidad en la fila de hoy**

```sql
-- docs/sqls/2026-05-27-moviles-dia-triggers.sql
CREATE OR REPLACE FUNCTION trg_moviles_to_dia_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO moviles_dia AS d
    (escenario_id, movil_id, fecha, empresa_fletera_id, matricula, descripcion,
     estado_nro, estado_desc, tamano_lote, activo, updated_at)
  VALUES
    (NEW.escenario_id, NEW.id, current_date, NEW.empresa_fletera_id, NEW.matricula, NEW.descripcion,
     NEW.estado_nro, NEW.estado_desc, NEW.tamano_lote,
     (NEW.estado_nro IS NULL OR NEW.estado_nro IN (0,1,2,4)), now())
  ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
    empresa_fletera_id = EXCLUDED.empresa_fletera_id, matricula = EXCLUDED.matricula,
    descripcion = EXCLUDED.descripcion, estado_nro = EXCLUDED.estado_nro,
    estado_desc = EXCLUDED.estado_desc, tamano_lote = EXCLUDED.tamano_lote,
    activo = EXCLUDED.activo, updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_moviles_to_dia ON moviles;
CREATE TRIGGER trg_moviles_to_dia AFTER INSERT OR UPDATE ON moviles
  FOR EACH ROW EXECUTE FUNCTION trg_moviles_to_dia_fn();
```

- [ ] **Step 2: Trigger de posición sobre la ingesta GPS → upsert `last_gps_*` en la fila de hoy**

```sql
-- Engancha en el MISMO punto que mantiene gps_latest_positions (revisar sync_gps_latest_position).
-- Si la ingesta es INSERT en gps_tracking_history, este trigger refleja la última posición.
CREATE OR REPLACE FUNCTION trg_gps_to_dia_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE moviles_dia SET
    last_gps_lat = NEW.lat, last_gps_lng = NEW.lng, last_gps_datetime = NEW.fecha_ins_log, updated_at = now()
  WHERE movil_id = NEW.movil_id AND fecha = current_date;
  -- Si no existe fila aún (móvil que reporta GPS sin estar en moviles_dia), crearla mínima:
  IF NOT FOUND THEN
    INSERT INTO moviles_dia (escenario_id, movil_id, fecha, last_gps_lat, last_gps_lng, last_gps_datetime, activo)
    SELECT m.escenario_id, NEW.movil_id, current_date, NEW.lat, NEW.lng, NEW.fecha_ins_log,
           (m.estado_nro IS NULL OR m.estado_nro IN (0,1,2,4))
      FROM moviles m WHERE m.id = NEW.movil_id
    ON CONFLICT (escenario_id, movil_id, fecha) DO UPDATE SET
      last_gps_lat = EXCLUDED.last_gps_lat, last_gps_lng = EXCLUDED.last_gps_lng,
      last_gps_datetime = EXCLUDED.last_gps_datetime, updated_at = now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gps_to_dia ON gps_tracking_history;
CREATE TRIGGER trg_gps_to_dia AFTER INSERT ON gps_tracking_history
  FOR EACH ROW EXECUTE FUNCTION trg_gps_to_dia_fn();
```

> ⚠️ Confirmar el nombre real de la tabla/columnas de ingesta GPS y si conviene enganchar acá o extender el trigger `sync_gps_latest_position` existente (preferible si ya hace el trabajo, para no duplicar escrituras).

- [ ] **Step 3: Aplicar y probar manualmente**

Run: actualizar un `estado_nro` de un móvil en `moviles` y verificar `SELECT estado_nro, activo, updated_at FROM moviles_dia WHERE movil_id=<X> AND fecha=current_date;` refleja el cambio.
Expected: la fila de hoy se actualizó al instante.

- [ ] **Step 4: Commit**

```bash
git add docs/sqls/2026-05-27-moviles-dia-triggers.sql
git commit -m "feat(db): triggers de estado y posición para moviles_dia"
```

### Task 1.5: Job de rollover de día

**Files:**
- Modify: `docs/sqls/2026-05-27-moviles-dia-functions.sql` (append) o `scripts/` (según cómo se corran cron jobs en el proyecto)

- [ ] **Step 1: Definir el rollover**

La fila del día anterior queda "congelada" automáticamente (los triggers solo escriben `current_date`). Al primer evento del día nuevo se crea la fila nueva. Para garantizar que el día nuevo arranque con TODOS los móviles visibles (no solo los que tuvieron evento), agendar `SELECT fn_moviles_dia_rebuild(current_date, current_date);` a las 00:0X.

```sql
-- Si el proyecto usa pg_cron:
-- SELECT cron.schedule('moviles_dia_rollover', '5 0 * * *', $$SELECT fn_moviles_dia_rebuild(current_date, current_date)$$);
```

> Si NO hay pg_cron, agregar la llamada al cron del server (revisar `pm2.config.js` / crontab) o a un endpoint disparado por un scheduler externo. Documentar la decisión acá.

- [ ] **Step 2: Verificar** que tras correr el rollover la fecha de hoy tiene todos los móviles visibles.

Run: `SELECT count(*) FROM moviles_dia WHERE fecha=current_date;` vs `SELECT count(*) FROM moviles WHERE mostrar_en_mapa;`
Expected: coinciden (más los inactivos con operación/GPS del día).

- [ ] **Step 3: Commit**

```bash
git add docs/sqls/2026-05-27-moviles-dia-functions.sql
git commit -m "feat(db): rollover diario de moviles_dia"
```

### Task 1.6: Mapper compartido `moviles_dia` → `MovilData`

**Files:**
- Create: `lib/moviles/moviles-dia-mapper.ts`
- Test: `__tests__/moviles-dia-mapper.test.ts`
- Modify: `types/index.ts` (agregar `MovilDiaRow`)

- [ ] **Step 1: Escribir el test del mapper**

```ts
// __tests__/moviles-dia-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapMovilDiaRowToMovilData, type MovilDiaRow } from '@/lib/moviles/moviles-dia-mapper';

const baseRow: MovilDiaRow = {
  escenario_id: 1000, movil_id: 47, fecha: '2026-05-27', empresa_fletera_id: 3,
  matricula: 'ABC1234', descripcion: 'Móvil 47', estado_nro: 1, estado_desc: 'ACTIVO',
  tamano_lote: 6, pedidos_pendientes: 2, services_pendientes: 1,
  last_gps_lat: -34.9, last_gps_lng: -56.1, last_gps_datetime: '2026-05-27T12:00:00Z',
  activo: true, oculto_operativo: false, inactivo_del_dia: false,
};

describe('mapMovilDiaRowToMovilData', () => {
  it('mapea identidad, estado y contadores', () => {
    const m = mapMovilDiaRowToMovilData(baseRow);
    expect(m.id).toBe(47);
    expect(m.estadoNro).toBe(1);
    expect(m.tamanoLote).toBe(6);
    expect(m.cant_ped).toBe(2);
    expect(m.cant_serv).toBe(1);
    expect(m.currentPosition).toEqual(expect.objectContaining({ coordX: -34.9, coordY: -56.1 }));
  });

  it('sin GPS → currentPosition undefined', () => {
    const m = mapMovilDiaRowToMovilData({ ...baseRow, last_gps_lat: null, last_gps_lng: null, last_gps_datetime: null });
    expect(m.currentPosition).toBeUndefined();
  });

  it('fecha pasada (pendientes/lote null) → 0/undefined sin romper', () => {
    const m = mapMovilDiaRowToMovilData({ ...baseRow, tamano_lote: null, pedidos_pendientes: null, services_pendientes: null, activo: false });
    expect(m.cant_ped).toBe(0);
    expect(m.tamanoLote ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run __tests__/moviles-dia-mapper.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el mapper** (alinear los nombres de campo con el `MovilData` real de `types/index.ts` — leerlo primero)

```ts
// lib/moviles/moviles-dia-mapper.ts
import type { MovilData } from '@/types';

export interface MovilDiaRow {
  escenario_id: number; movil_id: number; fecha: string;
  empresa_fletera_id: number | null; matricula: string | null; descripcion: string | null;
  estado_nro: number | null; estado_desc: string | null; tamano_lote: number | null;
  pedidos_pendientes: number | null; services_pendientes: number | null;
  last_gps_lat: number | null; last_gps_lng: number | null; last_gps_datetime: string | null;
  activo: boolean; oculto_operativo: boolean; inactivo_del_dia: boolean;
}

export function mapMovilDiaRowToMovilData(row: MovilDiaRow): MovilData {
  const hasGps = row.last_gps_lat != null && row.last_gps_lng != null;
  return {
    id: row.movil_id,
    name: row.descripcion ?? String(row.movil_id),
    matricula: row.matricula ?? undefined,
    empresaFleteraId: row.empresa_fletera_id ?? undefined,
    estadoNro: row.estado_nro ?? undefined,
    estadoDesc: row.estado_desc ?? undefined,
    tamanoLote: row.tamano_lote ?? undefined,
    pedidosAsignados: row.pedidos_pendientes ?? 0,
    cant_ped: row.pedidos_pendientes ?? 0,
    cant_serv: row.services_pendientes ?? 0,
    currentPosition: hasGps
      ? { coordX: row.last_gps_lat as number, coordY: row.last_gps_lng as number, fechaInsLog: row.last_gps_datetime ?? undefined }
      : undefined,
    // flags expuestos para el front (agregar a MovilData si no existen):
    activo: row.activo,
    ocultoOperativo: row.oculto_operativo,
    inactivoDelDia: row.inactivo_del_dia,
  } as MovilData;
}
```

> ⚠️ Leer `types/index.ts` y respetar los nombres EXACTOS de `MovilData` (`currentPosition` shape, `tamanoLote`, etc.). Si faltan `activo`/`ocultoOperativo`/`inactivoDelDia`, agregarlos como opcionales en `MovilData`.

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run __tests__/moviles-dia-mapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/moviles/moviles-dia-mapper.ts __tests__/moviles-dia-mapper.test.ts types/index.ts
git commit -m "feat: mapper moviles_dia → MovilData + tipos"
```

### Task 1.7: Test de PARIDAD (gate de seguridad)

**Files:**
- Create: `scripts/parity-moviles-dia.mjs`

- [ ] **Step 1: Escribir el script de paridad**

Compara, para una `(escenario, fecha)`, la salida de `fn_moviles_dia_rebuild` contra la lógica client-side actual sobre la MISMA data de origen.

```js
// scripts/parity-moviles-dia.mjs
// Uso: node scripts/parity-moviles-dia.mjs <escenario> <fecha YYYY-MM-DD>
import { createClient } from '@supabase/supabase-js';
import { getHiddenMovilIds, getMovilesConOperacionEnFecha, isMovilActiveForUI } from '../lib/moviles/visibility.ts';

const [escenario, fecha] = process.argv.slice(2);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 1) Reconstruir y leer moviles_dia
await sb.rpc('fn_moviles_dia_rebuild', { p_desde: fecha, p_hasta: fecha, p_escenario: Number(escenario) });
const { data: dia } = await sb.from('moviles_dia').select('*').eq('escenario_id', escenario).eq('fecha', fecha);

// 2) Recalcular client-side desde las MISMAS fuentes (moviles + pedidos + services del día)
const { data: moviles } = await sb.from('moviles').select('id, estado_nro').eq('escenario_id', escenario);
const ymd = fecha.replaceAll('-', '');
const { data: pedidos } = await sb.from('pedidos').select('movil, estado_nro').eq('escenario', escenario).eq('fch_para', ymd);
const { data: services } = await sb.from('services').select('movil, estado_nro');  // ajustar filtro de fecha

const hidden = getHiddenMovilIds(moviles.map(m => ({ id: m.id, estadoNro: m.estado_nro })), pedidos, services);
const conOp  = getMovilesConOperacionEnFecha([], pedidos, services);

// 3) Comparar flags por móvil
let mismatches = 0;
for (const r of dia) {
  const expActivo = isMovilActiveForUI(r.estado_nro);
  const expOculto = hidden.has(r.movil_id);
  if (r.activo !== expActivo || r.oculto_operativo !== expOculto) {
    mismatches++;
    console.error(`MISMATCH movil ${r.movil_id}: dia(activo=${r.activo},oculto=${r.oculto_operativo}) vs client(activo=${expActivo},oculto=${expOculto})`);
  }
}
console.log(mismatches === 0 ? 'PARIDAD OK' : `PARIDAD FALLÓ: ${mismatches} mismatches`);
process.exit(mismatches === 0 ? 0 : 1);
```

> ⚠️ Ajustar imports (.ts vía tsx/loader o portar las funciones), filtros de fecha de services, y el set de empresas. El objetivo: que el SQL y `visibility.ts` den el MISMO resultado.

- [ ] **Step 2: Correr la paridad para hoy y para 3 fechas pasadas**

Run: `node --import tsx scripts/parity-moviles-dia.mjs 1000 2026-05-27` (y repetir con fechas pasadas)
Expected: `PARIDAD OK` en todas.

- [ ] **Step 3: Si hay mismatches, corregir la función SQL y re-correr** (no avanzar de fase hasta que dé OK).

- [ ] **Step 4: Commit**

```bash
git add scripts/parity-moviles-dia.mjs
git commit -m "test(db): script de paridad moviles_dia vs lógica client-side"
```

**✔ Criterio de aceptación Fase 1:** `moviles_dia` refleja exactamente lo que hoy calcula el cliente (paridad OK hoy + fechas pasadas). Triggers actualizan estado/posición al instante. Front sin cambios.

---

## FASE 2 — Endpoint `/api/moviles-dia` + utilidad de reconstrucción (detrás de feature flag)

### Task 2.1: `GET /api/moviles-dia`

**Files:**
- Create: `app/api/moviles-dia/route.ts`

> Pre-lectura: `app/api/pedidos/route.ts` (para copiar EXACTO el patrón de scope fail-closed por `allowedEmpresas` y el header `x-track-isroot`).

- [ ] **Step 1: Implementar el endpoint**

```ts
// app/api/moviles-dia/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';          // ajustar al helper real
import { mapMovilDiaRowToMovilData } from '@/lib/moviles/moviles-dia-mapper';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const escenario = Number(searchParams.get('escenario'));
  const fecha = searchParams.get('fecha');                      // YYYY-MM-DD
  const empresasParam = searchParams.get('empresas');           // "1,2,3"
  const isRoot = req.headers.get('x-track-isroot') === 'S';
  if (!escenario || !fecha) return NextResponse.json({ error: 'escenario y fecha requeridos' }, { status: 400 });

  const empresas = empresasParam ? empresasParam.split(',').map(Number).filter(Boolean) : [];
  // Fail-closed: no-root sin empresas → []
  if (!isRoot && empresas.length === 0) return NextResponse.json({ data: [] });

  const sb = createServiceClient();
  let q = sb.from('moviles_dia').select('*').eq('escenario_id', escenario).eq('fecha', fecha);
  if (empresas.length > 0) q = q.in('empresa_fletera_id', empresas);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: (data ?? []).map(mapMovilDiaRowToMovilData) });
}
```

> ⚠️ Replicar EXACTO el modelo de scope/seguridad de `/api/pedidos`. Confirmar el helper de cliente Supabase service-role del repo.

- [ ] **Step 2: Smoke test manual**

Run: `curl "http://localhost:3000/api/moviles-dia?escenario=1000&fecha=2026-05-27" -H "x-track-isroot: S"`
Expected: `{ data: [ {id, estadoNro, cant_ped, ...} ] }` con la lista del día.

- [ ] **Step 3: Test de contrato vs pipeline viejo**

Crear `__tests__/moviles-dia-contract.test.ts` que compare keys del objeto `MovilData` producido por el mapper contra las que consume el dashboard (snapshot de claves). Correr `npx vitest run __tests__/moviles-dia-contract.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/api/moviles-dia/route.ts __tests__/moviles-dia-contract.test.ts
git commit -m "feat(api): GET /api/moviles-dia (lectura desde el read model)"
```

### Task 2.2: Feature flag

**Files:**
- Modify: `.env.example`, `.env.local`

- [ ] **Step 1:** Agregar `NEXT_PUBLIC_USE_MOVILES_DIA=false` a `.env.example` y `.env.local`.
- [ ] **Step 2:** Documentar en el README/spec que con `false` el dashboard usa el camino viejo.
- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: feature flag NEXT_PUBLIC_USE_MOVILES_DIA"
```

### Task 2.3: `POST /api/moviles-dia/rebuild` + recompute en pedidos/services

**Files:**
- Create: `app/api/moviles-dia/rebuild/route.ts`
- Modify: `app/api/pedidos/route.ts`, `app/api/services/route.ts`

- [ ] **Step 1: Endpoint de rebuild (admin)**

```ts
// app/api/moviles-dia/rebuild/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const MAX_DIAS = 180;

export async function POST(req: NextRequest) {
  // TODO: verificar permiso admin/root igual que otros endpoints admin del repo.
  const { desde, hasta, escenario } = await req.json();
  const d0 = new Date(desde), d1 = new Date(hasta);
  const dias = Math.round((+d1 - +d0) / 86400000);
  if (isNaN(dias) || dias < 0) return NextResponse.json({ error: 'rango inválido' }, { status: 400 });
  if (dias > MAX_DIAS) return NextResponse.json({ error: `máximo ${MAX_DIAS} días` }, { status: 400 });

  const sb = createServiceClient();
  const { error } = await sb.rpc('fn_moviles_dia_rebuild', { p_desde: desde, p_hasta: hasta, p_escenario: escenario ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, dias: dias + 1 });
}
```

- [ ] **Step 2: Recompute en `/api/pedidos`** — tras obtener los pedidos, juntar móviles referenciados y disparar el recompute bulk (no bloqueante para la respuesta).

```ts
// dentro de app/api/pedidos/route.ts, después de obtener `pedidos` y conocer escenario+fecha:
const movilesRef = [...new Set(pedidos.map(p => Number(p.movil)).filter(n => n > 0))];
if (movilesRef.length > 0) {
  // fire-and-forget; no demora la respuesta
  sb.rpc('fn_moviles_dia_recompute_counts_bulk', {
    p_escenario: escenario, p_fecha: fecha, p_moviles: movilesRef,
  }).then(({ error }) => { if (error) console.error('recompute moviles_dia (pedidos):', error.message); });
}
```

- [ ] **Step 3: Recompute en `/api/services`** — idéntico patrón con los services.

- [ ] **Step 4: Verificar** que tras llamar `/api/pedidos` los `pedidos_pendientes` de `moviles_dia` quedan al día.

Run: comparar `SELECT movil_id, pedidos_pendientes FROM moviles_dia WHERE fecha=current_date` contra un `count(*)` directo sobre `pedidos`.
Expected: coinciden.

- [ ] **Step 5: Commit**

```bash
git add app/api/moviles-dia/rebuild/route.ts app/api/pedidos/route.ts app/api/services/route.ts
git commit -m "feat(api): rebuild admin + recompute de pendientes en pedidos/services"
```

### Task 2.4: Utilidad de reconstrucción en Preferencias Globales

**Files:**
- Modify: `components/ui/PreferenciasGlobalesModal.tsx`

- [ ] **Step 1:** Agregar una sección "Reconstruir lista de móviles" con dos date pickers (desde/hasta, default = hoy/hoy) y un botón "Reconstruir".
- [ ] **Step 2:** Al confirmar, `POST /api/moviles-dia/rebuild` con el rango (validar ≤180 días en el front también) y mostrar toast de resultado.
- [ ] **Step 3: Verificar** desde la UI que reconstruir hoy y un rango pasado funciona y refleja en `moviles_dia`.
- [ ] **Step 4: Commit**

```bash
git add components/ui/PreferenciasGlobalesModal.tsx
git commit -m "feat(ui): utilidad de reconstrucción de moviles_dia en Preferencias Globales"
```

**✔ Criterio de aceptación Fase 2:** `/api/moviles-dia` devuelve datos idénticos al pipeline viejo; recompute mantiene pendientes frescos; la utilidad reconstruye por fecha/rango (≤180 días). Dashboard sigue en el camino viejo (flag off).

---

## FASE 3 — Canal realtime sobre `moviles_dia`

### Task 3.1: Hook `useMovilesDiaRealtime`

**Files:**
- Create: `lib/hooks/useMovilesDiaRealtime.ts`

> Pre-lectura: `lib/hooks/useRealtimeSubscriptions.ts` (copiar el patrón de canal, debounce y reconexión existente).

- [ ] **Step 1: Implementar el hook** (suscribe a `moviles_dia` filtrado por `escenario_id`; en fecha histórica NO se suscribe).

```ts
// lib/hooks/useMovilesDiaRealtime.ts
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';            // ajustar al cliente browser real
import { mapMovilDiaRowToMovilData, type MovilDiaRow } from '@/lib/moviles/moviles-dia-mapper';
import type { MovilData } from '@/types';

export function useMovilesDiaRealtime(escenarioId: number, fecha: string, isToday: boolean) {
  const [updates, setUpdates] = useState<Map<number, MovilData>>(new Map());
  const bufferRef = useRef<Map<number, MovilData>>(new Map());

  useEffect(() => {
    if (!isToday || !escenarioId) return;                      // histórico: sin realtime
    const ch = supabase
      .channel(`moviles-dia-${escenarioId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'moviles_dia', filter: `escenario_id=eq.${escenarioId}` },
        (payload) => {
          const row = payload.new as MovilDiaRow;
          if (!row || row.fecha !== fecha) return;
          bufferRef.current.set(row.movil_id, mapMovilDiaRowToMovilData(row));
        })
      .subscribe();
    const flush = setInterval(() => {
      if (bufferRef.current.size === 0) return;
      setUpdates(new Map(bufferRef.current));
      bufferRef.current = new Map();
    }, 250);                                                   // mismo debounce que GPS hoy
    return () => { clearInterval(flush); supabase.removeChannel(ch); };
  }, [escenarioId, fecha, isToday]);

  return updates;
}
```

- [ ] **Step 2: Verificar** en dev: con el flag on (Fase 4) un cambio de estado/posición/pendiente en `moviles_dia` llega al hook. (Por ahora, test manual con un `UPDATE` SQL.)
- [ ] **Step 3: Commit**

```bash
git add lib/hooks/useMovilesDiaRealtime.ts
git commit -m "feat: hook useMovilesDiaRealtime"
```

### Task 3.2: Posición en vivo por el canal nuevo (Opción A) + perf knob

- [ ] **Step 1:** Confirmar que el `UPDATE` de `last_gps_*` (trigger Task 1.4) dispara el canal y mueve el marcador (se valida end-to-end en Fase 5).
- [ ] **Step 2 (perf knob):** Si la flota+frecuencia es alta, agregar throttle en el trigger de GPS (escribir `last_gps_*` como máximo cada N segundos por móvil). Default: sin throttle. Decidir con los números reales (punto abierto de la spec).
- [ ] **Step 3: Commit** (si se aplicó throttle).

### Task 3.3: Endurecer RLS por empresa

**Files:**
- Modify: `docs/sqls/2026-05-27-create-moviles-dia.sql` (o nuevo `2026-05-27-moviles-dia-rls.sql`)

- [ ] **Step 1:** Reemplazar la política placeholder por una que limite por escenario y, según el modelo de auth del proyecto (revisar cómo lo hacen `gps_latest_positions`/`pedidos` en realtime), por empresa.
- [ ] **Step 2: Verificar** que un usuario no-root no recibe filas de empresas ajenas vía realtime.
- [ ] **Step 3: Commit**

```bash
git add docs/sqls/2026-05-27-moviles-dia-rls.sql
git commit -m "feat(db): RLS por empresa para moviles_dia (realtime)"
```

**✔ Criterio de aceptación Fase 3:** con el flag on, estado/capacidad/pendientes/posición se actualizan en vivo por `moviles_dia`; histórico sin canal; sin fugas de scope.

---

## FASE 4 — Colapsable izquierdo + orquestación del dashboard

> Pre-lectura: `app/dashboard/page.tsx` completo (zonas de `fetchPositions`, `enrichMovilesWithExtendedData`, `hiddenMovilIds`, `inactivosDelDia`, `movilesConOperacion`, `pedidosAsignadosClientMap`, `movilesFilteredMarked`, `allMovilesSelected`, polling, effects de merge) y `components/ui/MovilSelector.tsx`.

### Task 4.1: `fetchMovilesDia` detrás del flag

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1:** Agregar `fetchMovilesDia()` que llama `/api/moviles-dia?escenario&fecha&empresas` y hace `setMoviles(result.data)`. Sin reconciliación add/remove (la tabla es la fuente de verdad).
- [ ] **Step 2:** Bajo `if (USE_MOVILES_DIA)` usar `fetchMovilesDia` en el load inicial; si no, el `fetchPositions` viejo. (Ambos caminos coexisten hasta Fase 7.)
- [ ] **Step 3: Verificar** con flag on: el colapsable carga la lista desde `moviles_dia`.
- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): fetchMovilesDia detrás del feature flag"
```

### Task 4.2: Suscripción realtime nueva + simplificar effects de merge

- [ ] **Step 1:** Bajo el flag, usar `useMovilesDiaRealtime` y mergear sus updates en `moviles` (reemplaza por completo el merge de GPS y de `moviles` viejos para ese camino).
- [ ] **Step 2: Verificar** que estado/posición/pendientes se mueven en vivo.
- [ ] **Step 3: Commit.**

### Task 4.3: Derivar de flags (borrar derivaciones client-side)

- [ ] **Step 1:** Bajo el flag: `hiddenMovilIds` = set de `movil_id` con `oculto_operativo` (de la fila); `inactivosDelDia` = filas con `inactivo_del_dia`; contadores desde `cant_ped`/`cant_serv` del mapper. Eliminar (para el camino nuevo) las llamadas a `getHiddenMovilIds`/`getMovilesConOperacionEnFecha`/`pedidosAsignadosClientMap`.
- [ ] **Step 2: Verificar** que activos/ocultos/inactivos del día coinciden con el camino viejo (comparar con flag off vs on en la misma data).
- [ ] **Step 3: Commit.**

### Task 4.4: `allMovilesSelected` y gates de sin-asignar (NO romper)

- [ ] **Step 1:** Recalcular `allMovilesSelected` desde la lista de `moviles_dia` + `selectedMoviles`, **sin** referencia a `hiddenMovilIds` viejo (usar `oculto_operativo`). Confirmar que el gate de sin-asignar (`canVerSinAsignarUnitario`, `scope`) se comporta IGUAL.
- [ ] **Step 2: Verificar** explícitamente los casos de sin-asignar (badge "Ninguno", "Todos", scope distribuidor) con flag on vs off.
- [ ] **Step 3: Commit.**

### Task 4.5: Polling adaptado (re-query de snapshot)

- [ ] **Step 1:** En los 3 loops (reconciliación 180s, silence-detection, visibility-refetch), bajo el flag, reemplazar `fetchPositions()` por `fetchMovilesDia()`. Mantener el re-fetch de `pedidos`/`services` (que de paso recomputa pendientes). Borrar (para el camino nuevo) el cache `outOfScopeMovilIds` y el diff add/remove.
- [ ] **Step 2: Verificar** que tras una caída de realtime, el re-query recupera el estado.
- [ ] **Step 3: Commit.**

### Task 4.6: `MovilSelector` — orden, selección inicial, título, inactivos inertes (§4.1)

**Files:**
- Modify: `components/ui/MovilSelector.tsx`, `app/dashboard/page.tsx`

- [ ] **Step 1:** Activos ordenados por ID arriba; subtítulo "Inactivos"; inactivos por ID debajo (usar flag `activo`).
- [ ] **Step 2:** Selección inicial = TODOS (activos + inactivos) con "seleccionar todos" tildado; auto-seleccionar móviles nuevos que entren por `moviles_dia`. (Cambio confirmado vs default actual.)
- [ ] **Step 3:** Título de la barra lateral muestra cantidad de activos y de inactivos.
- [ ] **Step 4:** Inactivos inertes: click no dispara acción (sin focus/sin toggle de mapa).
- [ ] **Step 5:** Fecha anterior: realtime off, todos inactivos, sin info de lote/capacidad, todos seleccionados por defecto.
- [ ] **Step 6: Verificar** el comportamiento §4.1 para hoy y fecha pasada manualmente.
- [ ] **Step 7: Commit**

```bash
git add components/ui/MovilSelector.tsx app/dashboard/page.tsx
git commit -m "feat(colapsable): orden/selección/título por fecha (§4.1) desde moviles_dia"
```

**✔ Criterio de aceptación Fase 4:** el colapsable cumple §4.1 (hoy y fecha anterior), alimentado por `moviles_dia`; sin-asignar sin cambios; comportamiento idéntico al viejo con flag on vs off.

---

## FASE 5 — Mapa + capas + "Ver recorrido"

> Pre-lectura: `components/map/MapView.tsx` (`getMovilColor` líneas ~1669-1702, creación de íconos, `CulledMovilesLayer`), `components/map/MovilesZonasLayer.tsx`, `components/map/RouteAnimationControl.tsx`, `components/ui/TrackingModal.tsx`, `components/map/MovilInfoPopup.tsx`.

### Task 5.1: `getMovilColor` e íconos desde `moviles_dia`

**Files:**
- Modify: `components/map/MapView.tsx`

- [ ] **Step 1:** `getMovilColor` lee `estadoNro`, `tamanoLote`, `pedidos_pendientes` (= `pedidosAsignados` del mapper). Mismo cálculo/salida.
- [ ] **Step 2:** Íconos (`createCustomIcon/Compact/Mini`) usan `estadoNro` + inactividad desde el mapper.
- [ ] **Step 3: Verificar** (paridad visual) que los colores/íconos son idénticos con flag on vs off para la misma data.
- [ ] **Step 4: Commit.**

### Task 5.2: Inactivos fuera del mapa + fecha anterior sin marcadores

- [ ] **Step 1:** `CulledMovilesLayer`/`movilesForMap` excluyen inactivos (`!activo`). En fecha anterior, no se dibuja ningún marcador de móvil y no se muestra info de lote/capacidad.
- [ ] **Step 2: Verificar** hoy (inactivos no aparecen) y fecha pasada (ningún móvil en el mapa).
- [ ] **Step 3: Commit.**

### Task 5.3: `MovilesZonasLayer` por flag `activo`

- [ ] **Step 1:** Filtrar por `activo` de `moviles_dia` en vez del join `movilEstados` + `isMovilActiveForUI`.
- [ ] **Step 2: Verificar** conteos de zona idénticos.
- [ ] **Step 3: Commit.**

### Task 5.4: "Ver recorrido" lista desde `moviles_dia`

**Files:**
- Modify: `components/map/RouteAnimationControl.tsx`, `components/ui/TrackingModal.tsx`

- [ ] **Step 1:** La lista de móviles del recorrido sale de `moviles_dia` (filas de la fecha con `last_gps_datetime` no nulo) en vez de `/api/moviles-with-activity`. Estado al lado si es hoy; "inactivo" en todos si es fecha anterior.
- [ ] **Step 2:** El DIBUJO del recorrido sigue desde `gps_tracking_history` — NO tocar.
- [ ] **Step 3: Verificar** la lista hoy y fecha pasada; el recorrido se dibuja igual.
- [ ] **Step 4: Commit.**

**✔ Criterio de aceptación Fase 5:** colores/íconos/popups/zonas idénticos; inactivos no en mapa; fecha anterior sin marcadores; "Ver recorrido" lista desde `moviles_dia` y dibuja igual.

---

## FASE 6 — Vista extendida + contadores + estadísticas

> Recordatorio: cumplimiento/entregados/atrasados se siguen calculando ON-DEMAND desde `pedidos`/`services`. `moviles_dia` solo provee lista/estado/flags/pendientes. Sin-asignar: sin cambios.

### Task 6.1: `DashboardIndicators` + `MovilesSinGPS`

- [ ] **Step 1:** `movilesSinReportar` se deriva en cliente: `last_gps_datetime < (ahora − X)` con X de prefs. `sin-asignar` sigue dependiendo de la ventana SA (cliente). Entregados/cumplimiento on-demand (sin cambios).
- [ ] **Step 2:** `MovilesSinGPS` filtra por `currentPosition == null` (de `last_gps_*`).
- [ ] **Step 3: Verificar** que los números coinciden con hoy.
- [ ] **Step 4: Commit.**

### Task 6.2: `LeaderboardModal`

- [ ] **Step 1:** Lista + `cant_ped`/`cant_serv` + flags desde `moviles_dia`; exclusión de ocultos vía `oculto_operativo`. Cumplimiento/entregados/atrasados se siguen calculando on-demand desde pedidos/services.
- [ ] **Step 2: Verificar** ranking idéntico.
- [ ] **Step 3: Commit.**

### Task 6.3: `ZonaEstadisticasModal`

- [ ] **Step 1:** Usa `moviles_dia` para lista/estado/flags y pendientes; las stats de cumplimiento por zona siguen on-demand.
- [ ] **Step 2: Verificar** stats idénticas.
- [ ] **Step 3: Commit.**

### Task 6.4: Combo de móviles de la tabla extendida (§4.3)

**Files:**
- Modify: `components/ui/PedidosTableModal.tsx`, `components/ui/ServicesTableModal.tsx`

- [ ] **Step 1:** El combo se arma desde `moviles_dia` (reemplaza `getMovilesConPedidosMatching`/`getMovilesConFinalizadosEnFecha`) y se muestra igual que la barra lateral: activos arriba, inactivos abajo (por ID).
- [ ] **Step 2:** Conserva la selección con la que se entró desde el colapsable (por defecto, todos).
- [ ] **Step 3: Verificar** orden + selección heredada.
- [ ] **Step 4: Commit.**

**✔ Criterio de aceptación Fase 6:** lista/estado/flags/pendientes desde `moviles_dia`; cumplimiento on-demand con los mismos números que hoy; combo extendido = §4.3. Sin-asignar intacto.

---

## FASE 7 — Limpieza, código muerto y tests

### Task 7.1: Quitar el feature flag (camino nuevo por defecto)

- [ ] **Step 1:** Eliminar las ramas `if (USE_MOVILES_DIA)` dejando solo el camino nuevo en `app/dashboard/page.tsx`.
- [ ] **Step 2: Verificar** que el dashboard funciona sin el flag.
- [ ] **Step 3: Commit.**

### Task 7.2: Borrar endpoints y derivaciones viejas

**Files:**
- Delete: `app/api/all-positions/route.ts`, `app/api/moviles-extended/route.ts`
- Modify: `app/dashboard/page.tsx`, `lib/moviles/visibility.ts`

- [ ] **Step 1:** Borrar `/api/all-positions` y `/api/moviles-extended` (verificar que nadie más los consume con Grep).
- [ ] **Step 2:** Borrar de `page.tsx`: `enrichMovilesWithExtendedData`, `hiddenMovilIds`/`allHiddenMovilIds` viejos, `inactivosDelDia` (memo), `movilesConOperacion`, `pedidosAsignadosClientMap`, `movilesFilteredMarked`, diff add/remove + `outOfScopeMovilIds`, debounce de eventos de móvil.
- [ ] **Step 3:** En `visibility.ts`: borrar `getHiddenMovilIds`, `getHiddenMovilIdsFromEstadosMap`, `getMovilesConOperacionEnFecha`, y `getMovilesConPedidosMatching`/`getMovilesConFinalizadosEnFecha` si ya no se usan (Grep). **Mantener** `isMovilActiveForUI`.
- [ ] **Step 4: Verificar** `npx tsc --noEmit` sin errores.
- [ ] **Step 5: Commit.**

### Task 7.3: Retirar canales realtime viejos

**Files:**
- Modify: `components/providers/RealtimeProvider.tsx`, `lib/hooks/useRealtimeSubscriptions.ts`

- [ ] **Step 1:** Quitar los canales `gps` y `moviles` (y `useGPSTracking`/`useMoviles` si quedan sin uso). Mantener `pedidos`/`services`.
- [ ] **Step 2: Verificar** que el realtime sigue funcionando (moviles_dia + pedidos + services).
- [ ] **Step 3: Commit.**

### Task 7.4: Reescribir/ajustar tests

**Files:**
- Modify: `__tests__/movil-filter-fix.test.ts`, `combo-moviles-extendida.test.ts`, `distribuidor-scope-ui.test.ts`, `movil-event-refetch.test.ts`, `dashboard-lifecycle.test.ts` (si existen), `all-positions-gps-seed.test.ts`

- [ ] **Step 1:** `distribuidor-scope-ui.test.ts`: borrar tests de `getHiddenMovilIds`; verificar scope server-side + RLS.
- [ ] **Step 2:** `movil-filter-fix.test.ts`: AC de `hiddenMovilIds` → `oculto_operativo`; mantener AC de color/capacidad (ahora `tamano_lote` + `pedidos_pendientes`).
- [ ] **Step 3:** `combo-moviles-extendida.test.ts`: combo desde `moviles_dia` (o mantener funciones puras si se conservan).
- [ ] **Step 4:** `movil-event-refetch.test.ts`: canal `moviles_dia`, refetch dirigido.
- [ ] **Step 5:** `all-positions-gps-seed.test.ts`: migrar a `/api/moviles-dia`; quitar casos de reconciliación. **Conservar** `import-moviles-autocreate-gps.test.ts` y `estadoPedido.test.ts`.
- [ ] **Step 6:** Run: `npx vitest run` → todo verde.
- [ ] **Step 7: Commit.**

**✔ Criterio de aceptación Fase 7:** sin código muerto, sin flag, `npx tsc --noEmit` y `npx vitest run` verdes, comportamiento idéntico al inicial.

---

## Despliegue a producción

1. Aplicar los 3 SQL (`create`, `functions`, `triggers`) + RLS.
2. Ejecutar la utilidad de reconstrucción (Preferencias Globales) o `SELECT fn_moviles_dia_rebuild(current_date - 180, current_date);` para la población inicial (hoy completo + histórico reducido).
3. Correr el script de paridad (Task 1.7) contra prod para hoy y muestras pasadas → debe dar `PARIDAD OK`.
4. Activar `NEXT_PUBLIC_USE_MOVILES_DIA=true` (o mergear Fase 7 que lo vuelve default).
5. Programar el rollover diario (Task 1.5).

---

## Self-Review (cobertura de la spec)

- §3 esquema → Task 1.1. Flags/semántica → 1.3 + paridad 1.7. Reconstruibilidad → 1.3 + 2.3/2.4. GPS Opción A → 1.4 + 3.2.
- §4 carga → Fase 2 + 4. §4.1 colapsable hoy/pasado → Task 4.6. §4.2 recorrido → 5.4. §4.3 combo extendido → 6.4.
- Mantenimiento (triggers + recompute app-level) → 1.4 + 2.3. Cumplimiento on-demand → 6.1/6.2/6.3. Sin-asignar sin cambios → 4.4.
- Polling adaptado → 4.5. Realtime → 3.1/3.3. Limpieza + tests → Fase 7. Retención 180d → 2.3 (validación) + despliegue.
- Puntos abiertos remanentes (no bloquean): nombres/tipos reales de columnas (resueltos en pre-lectura de cada fase); throttle GPS (Task 3.2).
