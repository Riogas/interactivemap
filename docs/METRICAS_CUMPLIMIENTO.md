# Métricas de cumplimiento (asignado → cumplido)

Estructura persistida + job nocturno que mide cuánto demora cada CHOFER, MÓVIL
y ZONA en cumplir pedidos/services, desglosado por fecha y tipo de servicio
(URGENTE / NOCTURNO / ESPECIAL / OTROS / SERVICE), con promedios diario/semanal/mensual.

Este documento cubre solo backend (estructuras + cálculo + persistencia +
scheduling). El panel/UI de visualización es una iteración posterior — fuera
de alcance de este run.

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
| `atraso_vs_para_mins` | numeric NULL | `fin − para` CON signo (negativo = entregó antes); NULL sin para |
| `reloj_inicio` | `'ASIGNADO'\|'PARA'` | Desde dónde arrancó el reloj de la efectiva |
| `asignado_source` | `'CAMPO'\|'DERIVADO'` | Ver fallback |
| `created_at` | timestamptz | |

Índices: `(fecha)`, `(fecha, movil)`, `(fecha, zona_nro)`, `(fecha, chofer)`.

Sin RLS: el acceso de escritura es exclusivamente vía `getServerSupabaseClient()`
(service_role) desde el endpoint del run.

### Vistas de agregación

`vw_metricas_cumplimiento_diario` / `_semanal` (ISO, lunes–domingo) / `_mensual`
(mes calendario). Cada una es un `UNION ALL` de 3 bloques por dimensión
(`CHOFER` / `MOVIL` / `ZONA`) × `tipo_servicio` × `empresa_fletera_id`, con
columnas homogéneas: `dimension`, `dimension_valor`, `periodo`, `tipo_servicio`,
`empresa_fletera_id`, `cantidad`, `promedio_mins`, `mediana_mins`
(`percentile_cont(0.5)`), `p90_mins` (`percentile_cont(0.9)`), `min_mins`,
`max_mins`, `promedio_atraso_mins`.

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

Las 4 son idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE VIEW`) — se pueden re-correr sin efectos destructivos.
Cada archivo trae su bloque de verificación al final.

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

## Qué falta del lado del sender

El sender (Firestore bridge / GeneXus) **no emite `FchHoraAsignado`** en el
payload de `POST /api/import/pedidos` ni `POST /api/import/services` todavía.
El campo está mapeado y listo para recibirlo (`parseDate(pedido.FchHoraAsignado || pedido.fch_hora_asignado)`)
— en cuanto el sender lo agregue, empieza a poblarse `fch_hora_asignado` y el
run automáticamente prioriza `asignado_source='CAMPO'` sobre el fallback
DERIVADO, sin cambios de código. Coordinar con el equipo del sender (gestión
del usuario, fuera de alcance de este run).
