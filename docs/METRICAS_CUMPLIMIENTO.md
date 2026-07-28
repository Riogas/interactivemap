# Métricas de cumplimiento (asignado → cumplido)

Estructura persistida + job nocturno que mide cuánto demora cada CHOFER, MÓVIL
y ZONA en cumplir pedidos/services, desglosado por fecha y tipo de servicio
(URGENTE / NOCTURNO / ESPECIAL / OTROS / SERVICE), con promedios diario/semanal/mensual.

Este documento cubre solo backend (estructuras + cálculo + persistencia +
scheduling). El panel/UI de visualización es una iteración posterior — fuera
de alcance de este run.

> **⚡ Arquitectura vigente (2026-07-24): función SQL pura.** El chofer ahora
> sale de `pedidos/services.fletero` (mismo dato que daba el endpoint externo
> `getSessionData`), así que el job entero corre adentro de Postgres: la
> función `metricas_cumplimiento_run(desde, hasta)` (ver
> `docs/sqls/2026-07-24-metricas-funcion-sql-pura.sql`), disparada por `pg_cron`
> **sin HTTP**. El backfill es `SELECT metricas_cumplimiento_run('…','…');`,
> instantáneo. El endpoint `POST /api/metricas/cumplimiento/run` y toda la
> lógica TS de `lib/metricas/*` quedan como **legacy** (siguen andando, pero ya
> no los usa el cron; se pueden retirar en una limpieza posterior). Las
> secciones de abajo describen las reglas de cálculo, que la función SQL replica
> 1:1 — salvo el chofer, que en la versión SQL es `fletero` directo (más preciso
> que el heurístico por horario de sesión).

## Modelo de datos

### `pedidos.fch_hora_asignado` / `services.fch_hora_asignado`

Columna nueva (`timestamptz NULL`), mapeada en ambos import routes desde
`FchHoraAsignado` (con fallback `fch_hora_asignado` snake_case). **El sender
actual (GeneXus/Firestore bridge) NO emite este campo todavía** — mientras no
lo agregue, la columna queda siempre `NULL` y toda la demora se calcula con el
fallback DERIVADO (ver abajo). Es responsabilidad del usuario coordinar con el
sender para que empiece a enviarlo.

### Tabla `metricas_cumplimiento`

Hechos **inmutables** (se conservan para siempre, a diferencia de
`pedidos`/`services` que se purgan a ~1 mes). Grano: un pedido/service
cumplido. PK compuesta `(origen, pedido_id, escenario)` — replica la
convención de key compuesta que ya usa el import de `pedidos`/`services`
(`services` tiene PK física solo `id`, pero acá se guarda `escenario` igual
para tener una PK homogénea entre orígenes).

| Columna | Tipo | Notas |
|---|---|---|
| `origen` | `'PEDIDO'\|'SERVICE'` | |
| `pedido_id` | bigint | `id` de `pedidos`/`services` |
| `escenario` | integer | |
| `fecha` | date | Día de **cumplimiento** en `America/Montevideo` (no UTC) |
| `tipo_servicio` | `'URGENTE'\|'NOCTURNO'\|'ESPECIAL'\|'OTROS'\|'SERVICE'` | Ver clasificación abajo |
| `servicio_nombre` | text NULL | Valor crudo de origen |
| `movil` | integer NULL | Puede ser NULL/0 (cumplido sin móvil) |
| `zona_nro` | integer NULL | |
| `empresa_fletera_id` | integer NULL | |
| `chofer` | text NULL | Nombre-texto, sin ID estable (ver limitación abajo) |
| `fch_hora_asignado` | timestamptz NULL | NULL cuando `asignado_source='DERIVADO'` |
| `fch_hora_finalizacion` | timestamptz NOT NULL | |
| `fch_hora_para` | timestamptz NULL | Hora máxima comprometida (origen) |
| `demora_mins` | numeric | Bruta: `fin − asignado`. Siempre `>= 0` (negativos se excluyen, no se persisten) |
| `demora_efectiva_mins` | numeric | **MÉTRICA PRINCIPAL** — ver regla de agendados abajo |
| `fch_hora_max_ent_comp` | timestamptz NULL | Hora máxima de entrega **comprometida** (SLA) del origen |
| `atraso_vs_compromiso_mins` | numeric NULL | **ATRASO OFICIAL**: `fin − max_ent_comp` CON signo (negativo = entregó antes del plazo); NULL sin compromiso |
| `atraso_vs_para_mins` | numeric NULL | `fin − para` = tiempo total desde el **alta** del pedido. ⚠ NO es un atraso — ver abajo |
| `reloj_inicio` | `'ASIGNADO'\|'PARA'` | Desde dónde arrancó el reloj de la efectiva |
| `asignado_source` | `'CAMPO'\|'DERIVADO'` | Ver fallback |
| `created_at` | timestamptz | |

Índices: `(fecha)`, `(fecha, movil)`, `(fecha, zona_nro)`, `(fecha, chofer)`.

Sin RLS: el acceso de escritura es exclusivamente vía `getServerSupabaseClient()`
(service_role) desde el endpoint del run.

### `fch_hora_para` NO es el compromiso (2026-07-28)

Hallazgo al ver los primeros números reales de la RPC: `on_time_pct` daba
**0,14%**. El motivo es que el atraso se medía contra `fch_hora_para`
asumiendo que era la hora comprometida. No lo es. Evidencia sobre la base:

- El 59% de los valores de `fch_hora_para` terminan en `:59` segundos.
- Está sistemáticamente **antes** de `fch_hora_asignado` — incluso en los
  NOCTURNO, que serían los candidatos a estar agendados.
- En `services` la relación es exacta: `fch_hora_max_ent_comp = fch_hora_para + 4h`.
  O sea `para` = alta del pedido (para cuándo lo quiere ≈ ahora) y
  `max_ent_comp` = el SLA.

Nada puede terminar antes de haber entrado al sistema, así que ese 0,14% era
un artefacto. Medido sobre 1000 pedidos cumplidos:

| Campo usado como compromiso | % a tiempo | Atraso mediano |
|---|---|---|
| `fch_hora_para` | 0,2% | +28,2 min |
| **`fch_hora_max_ent_comp`** | **77,6%** | **−15,8 min** |

Corregido en `docs/sqls/2026-07-28b-metricas-compromiso-real.sql`, **aditiva**:
se agregan `fch_hora_max_ent_comp` y `atraso_vs_compromiso_mins`, y el atraso
oficial (vistas + RPC) pasa a salir de ahí. **No se renombró ni se pisó
`atraso_vs_para_mins`**: lo escribe el path legacy `lib/metricas/build-fact.ts`
y un rename lo rompería en runtime; además `fin − alta` es una métrica válida
por sí sola (cuánto esperó el cliente desde que pidió).

El backfill se hizo con `UPDATE ... FROM`, **no** con `metricas_cumplimiento_run()`:
ese hace DELETE + INSERT desde `pedidos`/`services`, y si la fuente no cubriera
todo el rango borraría hechos históricos irrecuperables.

> **`fch_hora_para` sigue siendo correcto para la regla de agendados** — ahí
> significa "para cuándo lo quiere", que es su sentido real. Que la regla
> dispare poco (26 de 168.315) no es un bug: casi todos los pedidos son
> inmediatos, así que `para ≈ ahora` y no hay espera planificada que descontar.

### El escenario es la clave principal (2026-07-28)

Un mismo **chofer, móvil o zona puede repetirse en escenarios distintos**, y
sus tiempos no significan nada si se suman entre ellos. Por eso `escenario`
encabeza toda la cadena:

| Capa | Cómo lo respeta |
|---|---|
| Tabla de hechos | columna `NOT NULL`, **parte de la PK** `(origen, pedido_id, escenario)` |
| Índices | todos liderados por `escenario` (`(escenario, fecha)`, `(escenario, fecha, empresa_fletera_id)`, + los 3 por dimensión) |
| Vistas | `escenario` es la **1ª columna del `SELECT` y del `GROUP BY`** |
| `metricas_cumplimiento_run` | 3er parámetro `p_escenario` acota purga e inserción |
| RPC `metricas_dashboard` | `escenario` requerido; filtra todo; devuelve `escenario_sel`, `escenarios` y `comparativa` |
| API + UI | `escenario` requerido (400 si falta); selector visible en el dashboard |

Migración: `docs/sqls/2026-07-28-metricas-escenario-primero.sql` (aditiva — no
recomputa ni borra hechos, el escenario ya estaba en cada fila).

> **Historial:** hasta esa migración las 3 vistas agrupaban SIN `escenario`, así
> que dos escenarios caían en la misma fila sumados. No causó datos malos
> porque ningún código las consumía (el dashboard va directo a los hechos vía
> RPC) y porque la base tenía un solo escenario (el 1000), pero era una bomba
> de tiempo. Los índices también lideraban con `fecha` en vez de `escenario`.

### Vistas de agregación

`vw_metricas_cumplimiento_diario` / `_semanal` (ISO, lunes–domingo) / `_mensual`
(mes calendario). Cada una es un `UNION ALL` de 3 bloques por dimensión
(`CHOFER` / `MOVIL` / `ZONA`) × `tipo_servicio` × `empresa_fletera_id`, con
columnas homogéneas: **`escenario`** (1ª, clave de agrupación), `dimension`,
`dimension_valor`, `periodo`, `tipo_servicio`, `empresa_fletera_id`,
`cantidad`, `promedio_mins`, `mediana_mins` (`percentile_cont(0.5)`),
`p90_mins` (`percentile_cont(0.9)`), `min_mins`, `max_mins`,
`promedio_atraso_mins`.

Además `vw_metricas_cumplimiento_escenarios`: comparativa cross-escenario al
grano `(escenario, escenario_nombre, fecha, tipo_servicio, empresa_fletera_id)`.
El "% a tiempo" viaja como dos **conteos** (`cantidad_a_tiempo` /
`cantidad_con_compromiso`) a propósito, para que el consumidor sume numerador y
denominador — promediar porcentajes da mal.

Los nombres legibles de escenario salen de `escenario_settings.nombre`
(opcional; sin valor, los consumidores muestran `Escenario <id>`).

Todas las columnas de agregación (`promedio/mediana/p90/min/max`) se calculan
sobre **`demora_efectiva_mins`** (la métrica principal). `promedio_atraso_mins`
promedia `atraso_vs_para_mins` con signo (AVG ignora los NULL). La demora bruta
queda disponible en la tabla de hechos para consultas ad-hoc.

### Regla de agendados (demora efectiva)

Acordada 2026-07-22. Un pedido agendado (ej. nocturno pedido "para las 13")
no debe medir demora desde que se asignó temprano al móvil:

- Si `fch_hora_asignado + 60 min < fch_hora_para` → el pedido es **AGENDADO**:
  el reloj arranca en la `para` (`reloj_inicio='PARA'`) y
  `demora_efectiva_mins = max(0, fin − para)` (entregar antes del compromiso
  cuenta como 0, no como crédito negativo; la anticipación queda visible en
  `atraso_vs_para_mins`, que sí es negativo).
- Si no (pedido inmediato, o `para` inexistente/ inválida) → el reloj arranca
  en el asignado y `demora_efectiva_mins = demora_mins` (la bruta).
- En `DERIVADO` el asignado implícito se reconstruye como
  `fin − demora_movil_desde_asignacion_mins` y se aplica la misma regla.
- El umbral vive en `UMBRAL_AGENDADO_MINS` (`lib/metricas/demora.ts`).

Ejemplo canónico: asignado 10:00, para 13:00, entregado 13:30 → bruta 210 min,
**efectiva 30 min**, atraso +30. Entregado 12:40 → efectiva 0, atraso −20.

Como los hechos persisten para siempre, los agregados son **vistas** (no
tablas materializadas): siempre exactos al momento de la consulta, sin drift.
`percentile_cont` devuelve `double precision`; con `N=1` en un grupo,
`p90=mediana=min=max=promedio=` el único valor.

## Clasificación `tipo_servicio`

Fuente única: `lib/metricas/tipo-servicio.ts`.

- **SERVICE** → siempre `'SERVICE'` (no se subdivide por `servicio_nombre`).
- **PEDIDO** → `clasificarTipoServicioPedido(servicio_nombre)`:
  - `servicio_nombre` (trim + uppercase) `=== 'URGENTE'` → `'URGENTE'`.
  - `=== 'NOCTURNO'` → `'NOCTURNO'`.
  - empieza con `'ESPECIAL'` (ej. `ESPECIAL SIN FLETE`) → `'ESPECIAL'`.
  - cualquier otro valor, **incluido `null`** → `'OTROS'`.

Esta regla es la MISMA que usa `app/api/zonas/capacidad-snapshot/route.ts` en
su rama `OTROS` (bucket sin URGENTE/NOCTURNO) — se extrajo a
`buildComunOrFilter()` y `capacidad-snapshot` la reusa (sin duplicar el string
`.or(...)` hardcodeado que tenía antes). **Naming**: el bucket "resto" se llama
`'OTROS'` en ambas capas (métricas y capacidad-snapshot), unificado. El helper
conserva el nombre histórico `buildComunOrFilter()` por compatibilidad de import.

## Cálculo de demora + fallback

Fuente: `lib/metricas/demora.ts` (`computeDemora`).

1. Si `fch_hora_asignado` existe → `demora_mins = fch_hora_finalizacion - fch_hora_asignado`
   (en minutos), `asignado_source = 'CAMPO'`.
2. Si no, pero `demora_movil_desde_asignacion_mins` (AS400) tiene valor →
   `demora_mins = demora_movil_desde_asignacion_mins`, `asignado_source = 'DERIVADO'`,
   `fch_hora_asignado` queda `NULL` en el hecho.
3. Si ninguno da un valor calculable → se excluye el registro (motivo
   `sin_asignado_calculable`, contado en el resumen del run).
4. Si el resultado de 1 o 2 es negativo (anticipación: asignado posterior a la
   finalización, o el campo AS400 viene negativo) → se excluye (motivo
   `demora_negativa`). **No se clampea a 0 ni se registra tal cual** — ambas
   alternativas sesgarían mediana/p90.

**Mientras el sender no emita `FchHoraAsignado`, TODA la demora se calcula
como DERIVADO** (fuente: `demora_movil_desde_asignacion_mins`, dato AS400
preexistente). `asignado_source` es la señal para filtrar/distinguir en
consultas futuras.

## "Cumplido" y exclusiones

Un pedido/service cuenta como **cumplido genuino** si `estado_nro = 2` **Y**
`sub_estado_nro = 3` **Y** `fch_hora_finalizacion IS NOT NULL`. El
`sub_estado_nro = 3` es clave: los demás sub_estados pueden ser "fruta" (cierres
en lote, marcas automáticas) que llegan con timestamps constantes y ensucian los
tiempos. El run excluye, con contador por motivo en el resumen:

- `cancelado` — `orden_cancelacion = 'S'`.
- `no_cumplido` — `estado_nro != 2`, `sub_estado_nro != 3`, o `fch_hora_finalizacion` NULL.
- `sin_escenario` — `escenario` NULL (la PK lo exige; en la práctica no debería
  ocurrir, ambos orígenes lo tienen poblado).
- `sin_asignado_calculable` / `demora_negativa` — ver sección de demora.

Cumplidos con `movil` NULL/0 **se registran igual** (con `chofer = NULL`, sin
llamar al endpoint de sesión); se cuentan aparte en `cumplidos_sin_movil` del
resumen (no en `moviles_sin_chofer`, que mide fallos de atribución con móvil
presente).

## Atribución de chofer

Fuente: `lib/metricas/chofer-atribucion.ts` (`atribuirChofer`) +
`lib/metricas/movil-session-fetch.ts` (`fetchSessionHistorial`).

Por cada combinación `(móvil, fecha)` presente en el batch (cacheada en
memoria del run — **la key es `movil+fecha`, no solo `movil`**, porque el
historial de sesión es por día), se llama una vez a
`POST {API_BASE_URL}/tracking/getSessionData` con
`{ EscenarioId: 1000, Movil, Fecha }` (mismo payload que usa
`app/api/movil-session/[id]/route.ts`, con el mismo `https.Agent({rejectUnauthorized:false})`
para certificados internos). Del historial devuelto se elige el chofer cuyo
`inicio` es el mayor `<= fch_hora_finalizacion` del hecho (el que estaba en el
móvil al momento del cumplimiento).

**El run llama DIRECTO al endpoint externo, no a `/api/movil-session/[id]`**:
ese endpoint interno exige `requireAuth` (sesión de usuario Supabase) y el run
se autentica con `METRICAS_CRON_TOKEN` (server-to-server) — no tiene sesión de
usuario para pasar ese gate.

Si el fetch falla (timeout, error SSL, respuesta no-ok) o no hay chofer
atribuible (historial vacío, o `fch_hora_finalizacion` anterior a todo
`inicio` del historial) → `chofer = NULL`, **NO es fatal**, el hecho se
registra igual y se incrementa `moviles_sin_chofer` en el resumen. Un valor
alto de `moviles_sin_chofer` es la señal de alarma de que la atribución está
fallando sistemáticamente (revisar conectividad al endpoint externo).

### Limitación conocida: identidad de chofer

El endpoint externo devuelve `ChoferHistorico` como **texto** (nombre), sin ID
estable. Las métricas "por chofer" agrupan por ese string → homónimos,
renombres, y diferencias de acentos/codificación (origen Latin-1) pueden
fragmentar o colisionar chofer. Esta iteración acepta esa limitación
(explícitamente fuera de alcance del pedido original). Deduplicación /
normalización / ID estable de chofer queda como deuda para una iteración
futura si se vuelve un problema real.

## Timezone

Fuente: `lib/date-utils.ts` (`montevideoDateOf`, `montevideoRangeToUtc`).

- `fecha` del hecho = `montevideoDateOf(fch_hora_finalizacion)` — el día
  calendario en `America/Montevideo`, NO en UTC. Un cumplimiento a las 23:30 UY
  (= 02:30 UTC del día siguiente) cae en la `fecha` UY del día anterior.
- El rango `[desde, hasta]` (días `YYYY-MM-DD` en Montevideo) se convierte a
  bounds UTC con `montevideoRangeToUtc()` para filtrar `fch_hora_finalizacion`
  (`timestamptz`): `gte` = inicio del día `desde`, `ltExclusive` = inicio del
  día siguiente a `hasta` (offset fijo `-03:00`, Uruguay no tiene DST desde
  2015).

## El endpoint: `POST /api/metricas/cumplimiento/run`

Auth: header `x-metricas-token` comparado con `safeCompare` (timing-safe)
contra la env `METRICAS_CRON_TOKEN`. Es el **primer paso** del handler — sin
token válido, ninguna consulta toca la base de datos. Sin la env configurada
en el servidor → `500 SERVER_MISCONFIGURED`.

### Rango

- Sin `?desde=&hasta=`: procesa el rango default (`defaultRunRange()` en
  `lib/metricas/build-fact.ts`) = `[hoy-3 .. hoy-1]` (Montevideo) — es decir,
  el día cerrado anterior + reprocesa los 2 días previos (ventana total de 3
  días, para tolerar llegadas tardías).
- Con `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`: backfill manual. Ambos params son
  obligatorios juntos; se valida formato y que `hasta >= desde`. Clamp de
  seguridad: rango máximo ~35 días (los datos de origen se retienen solo
  ~1 mes; pedir más no falla, simplemente el rango sin datos queda vacío para
  esas fechas — aunque el endpoint igual rechaza con 400 si el rango pedido
  excede el máximo, para evitar runs accidentalmente gigantes).

### Flujo

1. Token gate (early return).
2. Resolver rango + convertir a bounds UTC.
3. Leer `pedidos` y `services` cumplidos en el rango, **paginado** (`.range()`
   en bloques de 1000 — el límite implícito de Supabase; sin paginar, un día
   con muchos cumplidos se trunca en silencio).
4. Por fila: `buildFact()` valida calificación (excluye cancelados/no-cumplidos/
   sin-demora/negativos con contador), clasifica `tipo_servicio`, calcula
   `demora_mins`/`asignado_source`, deriva `fecha`.
5. Atribución de chofer por `(movil, fecha)` cacheada en memoria del run.
6. `dedupByPk()` — una fila por PK en el batch.
7. Purga (best-effort, no aborta el run si falla): hechos previos del rango
   `[desde, hasta]` cuya PK ya no califica se eliminan (comparación PKs
   existentes vs. PKs que califican en este run). La lectura de PKs existentes
   también está **paginada** (mismo motivo/patrón que el paso 3: sin paginar,
   un rango con más de 1000 hechos ya persistidos se trunca en silencio y la
   purga queda incompleta). El `DELETE` se hace en chunks de 500 (mismo
   `UPSERT_CHUNK` que el paso 8) para no pegar contra límites de longitud de
   query string con muchas `staleKeys`.
8. Upsert en chunks de 500, `onConflict: 'origen,pedido_id,escenario'` —
   tolerante a carreras (cron nocturno + backfill manual concurrentes).
9. Responde JSON:
   ```json
   {
     "ok": true,
     "rango": { "desde": "2026-07-19", "hasta": "2026-07-21" },
     "procesados": 1234,
     "excluidos": { "cancelado": 12, "no_cumplido": 5, "sin_asignado_calculable": 3, "demora_negativa": 1 },
     "moviles_sin_chofer": 2,
     "cumplidos_sin_movil": 0
   }
   ```

### Trade-off de seguridad: comparación del token

Se usa `safeCompare()` (ya existente en `lib/auth-middleware.ts`, basado en
`crypto.timingSafeEqual`) — es una reutilización directa, no un trade-off: el
helper ya está probado y se usa para `INTERNAL_API_KEY` en los endpoints de
import. No se justificaba una comparación simple `===` cuando el helper
timing-safe ya estaba disponible en el repo.

## Cómo habilitar pg_cron / pg_net

En el Dashboard de Supabase → Database → Extensions, habilitar `pg_cron` y
`pg_net`. **`pg_net` no tiene precedente en este repo** — todos los crons
existentes (`cron-cleanup-gps-history.sql`, etc.) invocan funciones SQL
locales, no hacen HTTP saliente. Antes de confiar en el cron, probar el
disparo manual (`curl` con el token) y verificar la respuesta con
`SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;`.

Si Supabase (self-hosted o cloud) no puede alcanzar la URL pública de la app
(red interna, sin exposición), usar el fallback documentado en el propio SQL
del cron: un `crontab` en el VPS de la app con `curl -X POST -H "x-metricas-token: ..." <url>/api/metricas/cumplimiento/run`.

## Cómo aplicar las migraciones

En orden, en el SQL Editor de Supabase:

1. `docs/sqls/2026-07-22-add-fch-hora-asignado.sql`
2. `docs/sqls/2026-07-22-metricas-cumplimiento-tabla.sql`
3. `docs/sqls/2026-07-22-metricas-cumplimiento-vistas.sql`
4. `docs/sqls/2026-07-22-metricas-cumplimiento-cron.sql` — **reemplazar
   `<APP_BASE_URL>` y `<METRICAS_CRON_TOKEN>` por los valores reales antes de
   ejecutar**; el archivo versionado en git lleva placeholders (NO commitear
   el token real). Requiere haber habilitado `pg_cron`/`pg_net` primero.

5. `docs/sqls/2026-07-23-metricas-otros-y-subestado.sql`
6. `docs/sqls/2026-07-24-metricas-funcion-sql-pura.sql` — el job pasa a SQL
   puro y el cron deja de usar `net.http_post`.
7. **`docs/sqls/2026-07-28-metricas-escenario-primero.sql`** — escenario como
   clave principal (índices + vistas + `p_escenario` en el run) **y la RPC del
   dashboard**. Es self-contained: aplicando este quedan la RPC y todo lo demás
   al día.
8. **`docs/sqls/2026-07-28b-metricas-compromiso-real.sql`** — el atraso se mide
   contra `fch_hora_max_ent_comp` (el SLA) en vez de `fch_hora_para` (que es el
   alta). Aditiva; incluye el backfill por `UPDATE`. Aplicar **después** del
   paso 7.

⚠ **`docs/sqls/2026-07-24-metricas-dashboard-rpc.sql` quedó OBSOLETO — no
aplicar.** Nunca llegó a correrse en la base (verificado 2026-07-28: la RPC no
existía) y hoy pisaría la versión escenario-aware del paso 7.

Todas son idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`, `DROP VIEW IF EXISTS` + `CREATE VIEW`) — se pueden
re-correr sin efectos destructivos sobre los datos. Cada archivo trae su bloque
de verificación al final.

También hace falta:
- Env `METRICAS_CRON_TOKEN` en el `.env` del servidor de la app (generar con
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  igual que `INTERNAL_API_KEY`).
- `APP_BASE_URL` ya existe como env de la app (usado para llamadas
  server-to-server); es el mismo valor que va en el SQL del cron.

## Cómo correr el backfill

El backfill NO se ejecuta como parte de este run (requiere acceso a prod).
Manualmente, contra el endpoint desplegado:

```bash
curl -X POST \
  -H "x-metricas-token: <METRICAS_CRON_TOKEN>" \
  "https://<host>/api/metricas/cumplimiento/run?desde=2026-06-25&hasta=2026-07-21"
```

Recomendado: correr en tramos de pocos días si el volumen es alto (cada
llamada procesa todo el rango en un solo request; no hay límite de tamaño de
respuesta, pero rangos muy grandes con muchos móviles distintos aumentan la
cantidad de llamadas a `/tracking/getSessionData`, una por combinación
móvil+fecha nueva). Rango máximo aceptado por el endpoint: 35 días.

## Lado del sender: ✅ RESUELTO (verificado 2026-07-28)

El sender (Firestore bridge / GeneXus) **ya emite `FchHoraAsignado`**. Medido
contra la base de prod el 2026-07-28:

- Primer hecho con `asignado_source='CAMPO'`: **2026-07-23**.
- Último día completo (2026-07-27): **2111 de 2111 hechos son `CAMPO`** (100%).
- Acumulado histórico: 10 489 `CAMPO` sobre 168 315 hechos — el resto son
  días previos al 23/07, que quedaron `DERIVADO` por backfill.

O sea: las demoras ya se calculan con la hora de asignación real, no
reconstruida. Si se quisiera mejorar el histórico previo al 23/07 no hay nada
que hacer: ese dato nunca existió en origen.

## Dashboard `/dashboard/metricas-cumplimiento` (2026-07-24)

Ruta cliente premium (Recharts, tema claro/oscuro, animado) que visualiza los
datos de este documento. Ruta protegida, **accesible solo por URL** (no
linkeada en ningún menú a propósito). Ver
`.claude/runs/20260724-141300-2wy/{spec,plan}.md` para el diseño completo.

### Capa de datos: RPC `metricas_dashboard(p jsonb)`

Migración vigente: **`docs/sqls/2026-07-28-metricas-escenario-primero.sql`**
(la versión escenario-aware; supersede a `2026-07-24-metricas-dashboard-rpc.sql`,
que quedó obsoleto y **no debe aplicarse**). Además de lo de abajo devuelve
`escenario_sel`, `escenarios` (para el selector, acotado por empresa) y
`comparativa` (todos los escenarios sobre el mismo período). Calcula KPIs con
percentiles **exactos** (`percentile_cont`) directo
sobre `metricas_cumplimiento` — nunca sobre `vw_metricas_cumplimiento_*`
(promediar promedios ya agregados da resultados incorrectos). Acceso exclusivo
`service_role` (`SECURITY INVOKER` + `REVOKE`/`GRANT` explícitos — la tabla no
tiene RLS, así que el gate real es que solo `getServerSupabaseClient()` la
invoca). Aplicar en el SQL Editor de Supabase, después de las migraciones
listadas en "Cómo aplicar las migraciones" arriba (requiere que
`metricas_cumplimiento` ya exista). El archivo trae su propio bloque de
verificación (smoke queries + fail-closed + check de grants) al final.

### Cómo dar de alta la funcionalidad `Estadisticas Cumplimiento`

El guard de `/dashboard/metricas-cumplimiento` (`app/dashboard/metricas-cumplimiento/layout.tsx`)
exige `isRoot(user) || hasFuncionalidad(user?.roles, 'Estadisticas Cumplimiento')`.
Esa funcionalidad **no existe todavía** — se da de alta en SecuritySuite (tarea
de admin, fuera de alcance de este run, igual que `ModoKiosko` en su momento):
crear la funcionalidad con nombre EXACTO `Estadisticas Cumplimiento` y
asignarla a los roles que deban ver el dashboard (análogo a cómo
`Estadistica Global RiogasTracking` habilita `/dashboard/stats`). Mientras no
se dé de alta, solo los usuarios `root` pueden entrar.

### Selector de escenario (2026-07-28)

El dashboard **arranca** en el `escenarioId` de la sesión (el que el usuario
eligió al loguearse) y a partir de ahí manda su selección explícita en el
selector, que va primero en la barra de filtros y destacado — es la clave
principal, no un filtro más. El escenario activo también aparece como chip en
el título, para que nunca haya duda de qué se está mirando, y encabeza el CSV
exportado (nombre de archivo incluido).

Si el escenario elegido no tiene datos, la página ya no queda en un empty
state ciego: la RPC devuelve igual la lista de escenarios **que sí tienen**
(dentro del scope de empresa del usuario) y el banner los ofrece como botones
para saltar. Esto reemplaza la vieja advertencia de "verificá con qué escenario
se corrió el backfill" — ahora la propia pantalla lo responde.

La card **Comparativa entre escenarios** aplica los mismos filtros (período,
tipo, empresa) a todos los escenarios a la vez, con percentiles exactos por
escenario. Con un solo escenario lo dice explícitamente en vez de fingir un
ranking de una fila.

> `escenario` **no es un límite de autorización** y nunca lo fue: el usuario ya
> lo elegía tipeándolo en el login y la API acepta cualquier entero. El scope
> real es la allowlist por email + el filtro de empresa fletera — que también
> acota qué escenarios se listan, así que un usuario de fletera solo ve
> escenarios donde su empresa operó.

### Riesgo de seguridad conocido y aceptado

El scope de autorización de `GET /api/metricas/dashboard` (qué empresas/qué
choferes puede ver el caller) se resuelve a partir de los headers
`x-track-isroot` / `x-track-empresas-ids`, que el propio browser setea en cada
request desde `contexts/AuthContext.tsx` — **no hay validación server-side
contra la sesión/DB de esos claims**. Esto es un modelo de confianza
**heredado del resto del repo**: el mismo patrón ya lo usan ~15-20 endpoints
en producción (`app/api/zonas/capacidad-snapshot`, `app/api/moviles-dia`,
`app/api/pedidos`, etc.), documentado como decisión consciente en el propio
`lib/api-auth-gates.ts`.

Lo que sí es nuevo con este endpoint: es **el primero que expone PII nominal
de chofer** (nombre en `ranking`/`detalle`) cruzando el límite de empresa bajo
ese modelo — cualquier usuario autenticado que forje `x-track-isroot: S` en
una request directa (curl/Postman con su propia cookie de sesión) puede ver
KPIs y nombres de chofer de todas las empresas fleteras, no solo la suya.

Detalle completo, evidencia y las 3 opciones de mitigación planteadas
((a) resolver `isRoot`/`allowedEmpresas` server-side desde `session.user.id`
contra la tabla de roles/permisos, (b) firmar esos claims como custom claims
en el JWT de sesión de Supabase, o (c) aceptar el riesgo explícitamente para
este dataset) en `.claude/runs/20260724-141300-2wy/security.md`, hallazgo
🟠 Alto #1.

#### Mitigación aplicada (2026-07-24): allowlist server-side por email

Se agregó una **defensa concreta y contenida a este endpoint**, sin tocar el
modelo de los otros ~20: `GET /api/metricas/dashboard` ahora pasa por
`requireAllowlistedEmail(session.user.email, METRICAS_DASHBOARD_ALLOWED_EMAILS)`
(`lib/api-auth-gates.ts`) **antes** de confiar en cualquier header. El email lo
da `requireAuth` (validado contra Supabase Auth, **no** spoofeable), así que
aunque alguien forje `x-track-isroot: S` o `x-track-funcs`, si su email
autenticado no está en la env allowlist recibe `403 NOT_ALLOWLISTED` y la RPC ni
se ejecuta.

- **Configuración**: `METRICAS_DASHBOARD_ALLOWED_EMAILS` = CSV de emails
  (case-insensitive) de los usuarios internos autorizados. Setearla en el `.env`
  de prod **antes** de aplicar la migración RPC / exponer el dashboard.
- **Sin la env seteada**: el gate no bloquea (para no romper dev) pero loguea un
  warning — el endpoint queda dependiendo solo del gate por headers. Por eso, en
  prod, **setear la allowlist es obligatorio** para que la mitigación tenga
  efecto.
- **Qué cierra**: el hueco de mayor impacto — que *cualquier* usuario logueado
  forje headers y baje KPIs + nombres de chofer de todas las empresas. Con la
  allowlist, solo los emails internos listados acceden.
- **Qué NO cierra (residual)**: un usuario interno allowlisted es de confianza,
  pero el scope por-empresa sigue viniendo del header. El fix completo para
  exponerlo a usuarios de **fletera** (que solo deben ver su empresa) es la
  opción (a): authz server-side con el scope real resuelto desde SecuritySuite.
  Mientras eso no exista, **asignar `Estadisticas Cumplimiento` + allowlist solo
  a usuarios internos de RioGas**, no a fleteras.

Antes de exponer este dashboard a usuarios de fletera (más allá de admins
internos), el equipo debe implementar la opción (a) o aceptar el riesgo residual
por escrito.
