# `moviles_dia` — Tabla de proyección denormalizada para la carga de móviles

**Fecha:** 2026-05-27
**Autor:** dmedaglia + Claude
**Estado:** Diseño aprobado en arquitectura (pendiente revisión de detalle)
**Componentes impactados:** capa de datos (Supabase), `app/dashboard/page.tsx`, `MovilSelector`, mapa + capas, vista extendida, contadores, estadísticas globales, `lib/moviles/visibility.ts`, realtime, tests.

---

## 1. Contexto y problema

Hoy, para armar la lista de móviles del colapsable izquierdo, el dashboard hace:

- **~5 queries** solo para los móviles: `/api/all-positions` consulta la tabla `moviles` + `gps_latest_positions`, y luego `/api/moviles-extended` **vuelve a consultar `moviles`** (columnas extendidas) y cuenta pedidos y services por móvil.
- **4 canales realtime** simultáneos: `gps_latest_positions`, `moviles`, `pedidos`, `services`.
- **3 loops de polling**: reconciliación (~180s), detección de silencio, y refetch al volver la pestaña a foreground.
- **Ensamblado client-side O(n)**: `getHiddenMovilIds()`, `getMovilesConOperacionEnFecha()`, `inactivosDelDia`, `pedidosAsignadosClientMap` — recorren TODOS los pedidos y services en cada update (realtime o polling), con riesgo de condiciones de carrera entre los múltiples caminos de actualización.

Además, ese mismo trabajo de conteo/derivación se **repite** en cada modal pesado:

- `ZonaEstadisticasModal`: O(n×z) — re-escanea pedidos por zona en cada render.
- `LeaderboardModal`: O(n×m) — filtra pedidos/services por cada móvil.
- `DashboardIndicators`, `MovilesSinGPS`, `MovilInfoCard`, `MovilInfoPopup`: re-cuentan/derivan estado.

### Objetivo

Mover el "armado" al servidor mediante una tabla denormalizada **`moviles_dia`** (read model / proyección), de modo que el cliente haga **1 lectura + 1 canal realtime** para todo lo relativo a móviles. La posición GPS se incluye en la tabla (**Opción A**, decidida con el usuario). Ver días pasados pasa a ser un `SELECT ... WHERE fecha = X` con realtime apagado.

### Principios rectores

1. **No romper nada.** Cada fase deja el sistema funcionando exactamente igual. Migración aditiva detrás de feature flag; el shape de datos que consume el front (`MovilData`) no cambia hasta que la nueva fuente esté verificada.
2. **Paridad verificable.** La lógica de flags/contadores que se mueve al servidor debe ser un *port fiel* de `lib/moviles/visibility.ts`, validado con un test de paridad (misma data → mismo resultado que el cálculo client-side actual).
3. **Una fase = un área impactada**, en orden seguro: primero la capa de datos, luego se migran los consumidores uno a uno, y el código muerto se borra al final.

---

## 2. Decisiones de diseño (cerradas con el usuario)

| Tema | Decisión |
|---|---|
| Granularidad de la tabla | 1 fila por **(escenario_id, movil_id, fecha)**; `empresa_fletera_id` como columna indexada para filtrar. |
| GPS / posición en vivo | **Opción A**: `last_gps_lat/lng/datetime` viven en `moviles_dia`. El marcador en vivo se mueve con el realtime de esta tabla. El cliente deja de suscribirse a `gps_latest_positions`. |
| Días anteriores | `SELECT` clásico sobre `moviles_dia` (realtime OFF). La fila del día queda "congelada" con sus datos finales. Lectura idéntica a hoy, sin merge. |
| `gps_latest_positions` / `gps_tracking_history` | **Se mantienen** como tablas de ingesta/fuente (no se rompe la ingesta). Un trigger refleja la última posición en `moviles_dia`. El historial (`gps_tracking_history`) sigue alimentando recorrido/animación. |
| Pedidos / Services (detalle) | Siguen cargándose como hoy (1 lectura + 1 canal cada uno). Se mantienen sus colapsables y la vista extendida. Lo que cambia: **dejan de usarse para derivar la visibilidad de móviles** (eso viene precalculado en `moviles_dia`). |
| Empresas fleteras | Sin cambios: 1 query liviana a `empresas_fleteras`. |
| Campos "EPS" / "fecha de tercerización" | **Descartados** — fueron un error de transcripción del audio, no son campos reales. |
| Campos relativos a tiempo / preferencias | **NO se guardan** en la tabla; se derivan en el cliente. La tabla guarda solo *hechos* (estado, contadores por estado, `last_gps_datetime`). Lo que depende del **reloj** o de una **preferencia** (`atrasados`, `móviles sin reportar`, ventana SA) se calcula en vivo en el cliente. |

### Mantenimiento de la tabla (decidido)

Cada columna se actualiza en el punto natural donde cambia su fuente:
- **`estado_nro` / `estado_desc` / `tamano_lote` / identidad / `activo`**: trigger sobre `moviles` (instantáneo).
- **`last_gps_*`**: trigger en la ingesta de GPS (mismo punto que ya mantiene `gps_latest_positions`).
- **`pedidos_pendientes` / `services_pendientes` + flags `oculto_operativo` / `inactivo_del_dia`**: **recompute a nivel aplicación**. Cada vez que se consume `/api/pedidos` y se referencia un móvil, se recalculan sus pedidos pendientes y se impacta `moviles_dia`. Ídem `/api/services`. **No** hay trigger de DB sobre `pedidos`/`services`.
- **Contadores de cumplimiento** (finalizados / entregados / entregados tarde / % cumplimiento): **NO se almacenan** — se calculan on-demand desde `pedidos`/`services`, como hasta ahora (decisión: correctitud > perf en esas stats).

Esto se apoya en que las APIs de pedidos/services se consumen en el load inicial, en cada vuelta de polling y al reconectar realtime → los pendientes quedan frescos sin lógica de triggers pesada sobre tablas de alto volumen.

---

## 3. Esquema de `moviles_dia`

> Nota: nombres de columna a confirmar contra las convenciones reales del schema. Tipos orientativos.

```sql
CREATE TABLE moviles_dia (
  escenario_id        integer     NOT NULL,
  movil_id            integer     NOT NULL,
  fecha               date        NOT NULL,

  -- identidad del móvil
  empresa_fletera_id  integer,
  matricula           text,
  descripcion         text,

  -- estado y capacidad
  estado_nro          integer,
  estado_desc         text,
  tamano_lote         integer,

  -- contadores del día (SOLO pendientes; cumplimiento/atrasados NO se guardan)
  pedidos_pendientes  integer,
  services_pendientes integer,

  -- última posición GPS (Opción A)
  last_gps_lat        double precision,
  last_gps_lng        double precision,
  last_gps_datetime   timestamptz,

  -- flags precalculados (port de lib/moviles/visibility.ts)
  activo              boolean     NOT NULL DEFAULT false,  -- isMovilActiveForUI(estado_nro)
  oculto_operativo    boolean     NOT NULL DEFAULT false,  -- !activo && tiene operación en fecha
  inactivo_del_dia    boolean     NOT NULL DEFAULT false,  -- inactivo && trabajó en la fecha

  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (escenario_id, movil_id, fecha)
);

CREATE INDEX idx_moviles_dia_lookup    ON moviles_dia (escenario_id, fecha, empresa_fletera_id);
CREATE INDEX idx_moviles_dia_activo    ON moviles_dia (escenario_id, fecha, activo);
```

**Semántica de flags** (debe replicar exactamente `visibility.ts`, validar con test de paridad):
- `activo` = `estado_nro ∈ {0,1,2,4}` (o null) — `isMovilActiveForUI`.
- `oculto_operativo` = `!activo` y tiene al menos 1 pedido/service en la fecha (≡ `getHiddenMovilIds`). Se excluye del colapsable pero sus pedidos/services siguen visibles.
- `inactivo_del_dia` = inactivo y con operación en la fecha (≡ `inactivosDelDia`, va bajo el separador del colapsable).

> ⚠️ La distinción exacta entre `oculto_operativo` e `inactivo_del_dia` debe portarse leyendo `getHiddenMovilIds` vs `getMovilesConOperacionEnFecha` línea por línea. El test de paridad es la red de seguridad.

**Derivados en el cliente (NO se guardan como columna):**
- `atrasados` por móvil = pedidos/services **pendientes** (estado 1) con hora límite vencida (`delay < 0`). Depende del **reloj** → se calcula en vivo desde los pendientes que el cliente ya tiene cargados. **No** es sobre los entregados.
- `móviles sin reportar` = `last_gps_datetime < (ahora − X min)`, donde **X sale de las preferencias** del usuario. Depende del reloj y de la pref → cliente.
- `ventana SA` (visibilidad de sin-asignar) = depende de `serverNow` + pref `minutosAntesSa` → cliente.
- Distinto de **móvil sin GPS** = `last_gps_lat IS NULL` (nunca reportó posición): eso sí es un hecho estable, se consulta directo en la tabla.
- **Contadores de cumplimiento** (finalizados / entregados / entregados tarde / % cumplimiento): se calculan **on-demand** desde `pedidos`/`services` como hasta ahora — NO se persisten. Evita cualquier riesgo de *drift* en esas estadísticas.
- **Color / capacidad** del móvil: hoy `getMovilColor` usa `tamano_lote` + pedidos asignados. Se reproduce con `tamano_lote` + `pedidos_pendientes` (los pedidos asignados de un móvil ≡ sus pendientes). Por eso se quitaron `capacidad` y `pedidos_asignados` del esquema. Verificar en paridad.

**Reconstruibilidad (corregibilidad):** `moviles_dia` es una *cache / read model reconstruible*, no un snapshot de una sola escritura. Cada columna se re-deriva desde las fuentes (`pedidos`, `services`, `moviles`, `gps_tracking_history`). Si aparece un bug: se corrige la función de recompute y se re-ejecuta el recompute/backfill (**utilidad en Preferencias Globales**, pide fecha o rango) sobre las fechas afectadas → los valores persistidos se corrigen. Las fuentes se retienen **180 días**, así que se reconstruye/corrige hasta 180 días atrás. Además, al no persistir cumplimiento, el grueso de las estadísticas nunca puede quedar "congelado mal".

**RLS / scope:** la lectura inicial va por `/api/moviles-dia` (server, service-role, scope fail-closed por `allowedEmpresas`, igual que `/api/pedidos` hoy). Para el realtime client-side se replica el filtro de canal por `empresa_fletera_id` (como los canales actuales) y **se añade política RLS** sobre `moviles_dia` como endurecimiento (ver Fase 3).

---

## 4. Cómo queda la carga completa de la barra lateral (objetivo)

| Sección | Hoy | Con `moviles_dia` |
|---|---|---|
| **Empresas fleteras** | 1 query a `empresas_fleteras` | Igual (sin cambios) |
| **Móviles** | ~5 queries + 2 canales (gps, moviles) + joins client-side | **1 query** `/api/moviles-dia` + **1 canal** `moviles_dia`. Posición incluida. Flags y contadores precalculados. |
| **Pedidos** | 1 query + 1 canal | Igual, pero ya **no** deriva visibilidad de móviles |
| **Services** | 1 query + 1 canal | Igual, pero ya **no** deriva visibilidad de móviles |
| **Ver día pasado** | refetch + refiltrado de todo | `SELECT WHERE fecha=X`, realtime OFF |

---

## 4.1 Comportamiento de la barra lateral y el mapa por fecha

> Reglas definidas por el usuario. Refinan y, donde se marca **(cambio vs hoy)**, modifican el comportamiento actual.

### Fecha = HOY (realtime ON)
- **Orden y agrupación:** móviles **activos** ordenados por ID arriba; luego un **subtítulo "Inactivos"** y debajo el resto (los inactivos presentes en `moviles_dia` de la fecha) ordenados por ID.
- **Selección inicial:** al primer load, **TODOS** seleccionados (activos e inactivos) y el checkbox "seleccionar todos" tildado. **(cambio vs hoy: el default actual es solo activos.)**
- **Auto-refresh:** como "seleccionar todos" está activo, cualquier móvil que aparezca nuevo en `moviles_dia` se inserta automáticamente en la lista según su estado e ID y queda seleccionado.
- **Título de la barra lateral:** indica **cantidad de activos** y **cantidad de inactivos**.
- **Inactivos:** NO se dibujan en el mapa; al clickearlos en la barra lateral **no pasa nada** (item inerte — no hay marker que enfocar ni toggle de visibilidad).

### Fecha = ANTERIOR (realtime OFF)
- Realtime **desactivado**.
- **Qué móviles aparecen:** los que esa fecha estuvieron **referenciados en `pedidos` o `services`, o enviaron coordenadas GPS**. No aplica el concepto de "activo/visible" — la lista se reconstruye de los hechos de esa fecha.
- **Todos** se visualizan como **inactivos**.
- `pedidos_pendientes`, `services_pendientes` y `tamano_lote` **no aplican** para fechas pasadas (van `null`) — "pendiente" es un concepto del día en curso.
- La app **no** los muestra en el mapa, ni muestra info de lote / capacidad / etc.
- **Selección inicial:** todos seleccionados por defecto.
- La lista de móviles de fechas pasadas se arma con la **utilidad de reconstrucción** (§3 / Preferencias Globales).

## 4.2 Pantalla "Ver recorrido"

- Carga **todos los móviles que tuvieron coordenadas GPS en la fecha seleccionada**, leyendo `moviles_dia` (filas de esa fecha con `last_gps_datetime` no nulo). Reemplaza el escaneo actual de `/api/moviles-with-activity`.
- Si la fecha es **hoy:** muestra el estado al lado de cada móvil, como hoy.
- Si la fecha es **anterior:** todos los registros dicen **"inactivo"**.
- El **dibujo del recorrido** se hace **igual que hasta ahora** (desde `gps_tracking_history`). Eso no cambia.

## 4.3 Combo de móviles en la tabla extendida

- El combo/selector de móviles de la **tabla extendida** (`PedidosTableModal` / `ServicesTableModal`) se muestra **igual que la barra lateral**: **activos arriba, inactivos abajo** (mismo orden por ID, §4.1).
- Mantiene **la misma selección con la que se entró desde la barra lateral** (los `selectedMoviles` del colapsable al abrir el modal). Por defecto, **todos** (hereda el default de la barra lateral).

---

## 5. Fases de implementación

> Cada fase es entregable y verificable de forma independiente. El sistema queda funcionando tras cada una. Recomendado ejecutarlas 1 a 1.

### Fase 1 — Esquema + población de `moviles_dia` (backend puro, front intacto)

**Objetivo:** la tabla existe, se puebla y está verificada contra la realidad. El front no se toca.

Tareas:
1. Migración SQL: tabla `moviles_dia` + índices (sección 3).
2. Trigger sobre `moviles` (INSERT/UPDATE): refleja `estado_nro`, `estado_desc`, `empresa_fletera_id`, `tamano_lote`, `capacidad`, `matricula`, `descripcion` en la fila de **hoy**; recalcula `activo`.
3. Trigger sobre la ingesta de GPS (el mismo punto que mantiene `gps_latest_positions`): escribe `last_gps_lat/lng/datetime` en la fila de hoy del móvil.
4. Función de recálculo de `pedidos_pendientes` / `services_pendientes` + flags `oculto_operativo` / `inactivo_del_dia` por móvil, **invocable a nivel aplicación** desde las APIs de pedidos/services (§2) y desde el backfill. (Port de `visibility.ts`.) Cumplimiento y `atrasados` NO se guardan.
5. Job de "cierre/rollover" de día (la fila del día anterior queda congelada; se crea la fila del día nuevo al primer evento o por cron).
6. **Recompute/backfill re-ejecutable por rango de fechas** (idempotente). Es a la vez (a) la carga inicial histórica, (b) el mecanismo de corrección ante bugs, y (c) la reconstrucción de la lista de móviles de fechas pasadas (§4.1). Distingue por fecha:
   - **Día en curso:** calcula la fila **completa** (estado live, `tamano_lote`, `pedidos_pendientes`/`services_pendientes`, posición, flags).
   - **Fechas pasadas:** reconstrucción **reducida** desde `pedidos`/`services`/`gps_tracking_history` (móvil inactivo, con `last_gps_*` e identidad, **sin** pendientes ni `tamano_lote`).
   - **Despliegue a prod:** hay que **ejecutar la utilidad** para la población inicial — el día en curso (completo) + el histórico hasta 180 días (reducido).
7. **Test de paridad** (clave): para una muestra de (escenario, fecha), comparar `moviles_dia` contra el resultado del cálculo client-side actual (`getHiddenMovilIds`, `getMovilesConOperacionEnFecha`, conteos de `/api/moviles-extended`). Debe ser idéntico.

> **Regla de existencia de fila:**
> - **Hoy:** existe fila para los móviles **activos/visibles** (`mostrar_en_mapa`) **y** para cualquiera con pedido/service/GPS del día. Lleva estado live, `tamano_lote`, `pedidos_pendientes`/`services_pendientes`, posición y flags.
> - **Fecha pasada (reconstruida):** existe fila para los móviles **referenciados en `pedidos`/`services` o con coordenadas GPS** esa fecha. Todos **inactivos**; `pedidos_pendientes`/`services_pendientes`/`tamano_lote` van **null** (no aplican); se conserva `last_gps_*` (para "Ver recorrido") e identidad.
>
> Confirmar la inclusión de "hoy" contra la lógica actual de `/api/all-positions`.

**Criterio de aceptación:** `moviles_dia` refleja exactamente lo que hoy calcula el cliente, para hoy y para fechas pasadas. Front sin cambios, todo sigue igual.

---

### Fase 2 — Endpoint de lectura `/api/moviles-dia` (detrás de feature flag)

**Objetivo:** un endpoint que devuelve `MovilData[]` desde `moviles_dia`, compatible en shape con lo que hoy produce `/api/all-positions` + `/api/moviles-extended`.

Tareas:
1. `GET /api/moviles-dia?fecha=&escenario=&empresas=` → arma `MovilData[]` (incluye `currentPosition` desde `last_gps_*`).
2. Scope server-side fail-closed por `allowedEmpresas` (espejo de `/api/pedidos`).
3. Feature flag (`NEXT_PUBLIC_USE_MOVILES_DIA`) para poder activar/desactivar el nuevo camino sin borrar el viejo.
4. Test de contrato: el shape y los valores que devuelve `/api/moviles-dia` == los que producía el pipeline viejo, sobre la misma data.
5. **Utilidad de reconstrucción en Preferencias Globales:** endpoint admin (p. ej. `POST /api/moviles-dia/rebuild?desde=&hasta=`) + botón/form en `PreferenciasGlobalesModal` que **pide una fecha o un rango** y dispara el recompute/backfill (tarea 6 de Fase 1). Es la herramienta para **reconstruir la lista de móviles de días anteriores** y para corregir datos ante un bug. El rango admitido es hasta **180 días** atrás (límite de retención de las fuentes).

**Criterio de aceptación:** el endpoint devuelve datos idénticos en estructura y valores. La utilidad de reconstrucción funciona desde Preferencias Globales para una fecha o rango. El dashboard sigue usando el camino viejo (flag off).

---

### Fase 3 — Canal realtime sobre `moviles_dia`

**Objetivo:** updates en vivo (incluida posición) por un único canal nuevo.

Tareas:
1. Hook `useMovilesDiaRealtime` suscrito a `moviles_dia` filtrado por `escenario_id` + `fecha` + `empresa_fletera_id`.
2. La posición en vivo (Opción A) llega por este canal; el marcador se mueve con eso. En fecha histórica el canal no se abre.
3. Política **RLS** sobre `moviles_dia` (endurecimiento del scope por empresa para suscripciones client-side).
4. Mantener los canales viejos (`gps`, `moviles`) disponibles tras el flag para rollback.
5. (Perf knob) Si la flota + frecuencia de GPS resultara alta, throttle de la escritura de posición en `moviles_dia` (p. ej. máx. cada N s). Default: sin throttle.

**Criterio de aceptación:** con el flag on, estado/capacidad/contadores/posición se actualizan en vivo por el canal `moviles_dia`. Sin regresiones de scope (RLS verificada).

---

### Fase 4 — Migrar el colapsable izquierdo + orquestación del dashboard

**Objetivo:** el dashboard y `MovilSelector` consumen `moviles_dia`; se borran las derivaciones client-side.

Tareas (en `app/dashboard/page.tsx` salvo donde se indique):
1. Reemplazar `fetchPositions` + `enrichMovilesWithExtendedData` por `fetchMovilesDia` (1 query). Eliminar la lógica de reconciliación (add/remove) — la tabla es la fuente de verdad.
2. Cambiar la suscripción realtime al hook nuevo; simplificar los effects de merge de GPS y de `moviles`.
3. **Borrar/derivar de flags**:
   - `hiddenMovilIds` (memo + ref) → usar `oculto_operativo`.
   - `inactivosDelDia` / `movilesConOperacion` → filtro por `inactivo_del_dia`.
   - `pedidosAsignadosClientMap` / `movilesFilteredMarked` → `pedidos_pendientes`/`services_pendientes` y color desde `tamano_lote` + `pedidos_pendientes`. *(Nota: mantener un recálculo client-side ligero del contador solo si se quiere reflejar al instante eventos de pedido entre refrescos; evaluar.)*
   - `allMovilesSelected`, `movilesForMap`, `pedidosForMap`: quitar referencias a `hiddenMovilIds`.
4. **Adaptar los 3 loops de polling a `moviles_dia`:** `fetchPositions()` → `fetchMovilesDia()`. La **reconciliación** deja de ser el diff multi-fuente (add/remove contra `moviles`+`gps_latest_positions`) y pasa a ser un **re-fetch del snapshot de `moviles_dia`** (`SELECT` por escenario+fecha+empresas) que reconcilia el estado del cliente — *safety net* por si el realtime perdió eventos. El re-fetch respeta "seleccionar todos" (los móviles nuevos quedan seleccionados, §4.1). `silence-detection` y `visibility-refetch` hacen el mismo re-query trivial. Los loops siguen re-fetcheando también `pedidos`/`services` (lo que de paso recomputa `pedidos_pendientes`/`services_pendientes` en `moviles_dia`).
5. `MovilSelector`: consumir los flags precalculados (`activo`, `oculto_operativo`, `inactivo_del_dia`) en vez de recalcular.
6. **Orden + agrupación (ver §4.1):** activos por ID arriba; subtítulo "Inactivos"; resto por ID debajo.
7. **Selección inicial = TODOS** (activos + inactivos) con "seleccionar todos" tildado (cambio vs default actual). Auto-seleccionar los móviles nuevos que entren por `moviles_dia`.
8. **Título de la barra lateral:** mostrar cantidad de activos y de inactivos.
9. **Inactivos inertes:** no se dibujan en el mapa; click en la barra lateral no dispara acción (ni focus ni toggle).
10. **Fecha anterior (§4.1):** realtime OFF; todos como inactivos; sin info de lote/capacidad; todos seleccionados por defecto.

**Criterio de aceptación:** el colapsable cumple §4.1 para hoy y para fechas anteriores (orden, agrupación, selección inicial, título con contadores, inactivos inertes), alimentado por `moviles_dia`. Derivaciones viejas eliminadas.

---

### Fase 5 — Migrar el mapa + capas

**Objetivo:** marcadores, colores e íconos de móviles alimentados por `moviles_dia`.

Tareas:
1. `MapView.getMovilColor()` e `createCustomIcon/Compact/Mini`: leer `estado_nro`, `tamano_lote`, `pedidos_pendientes` desde la fila (color y barra de capacidad = `tamano_lote` + `pedidos_pendientes`, que reemplaza a `capacidad`/`pedidos_asignados`). Verificar en paridad misma salida.
2. `CulledMovilesLayer`: posición desde `last_gps_*`; `estado`/inactividad desde flags.
3. `MovilInfoPopup` / `MovilInfoCard`: estado, capacidad, `cant_ped`/`cant_serv`, último GPS desde la fila. (Historial/recorrido sigue desde `gps_tracking_history`.)
4. `MovilesZonasLayer`: filtrar por el flag `activo` en vez del join de `estado` (elimina el `movilEstados` Map y el chequeo `isMovilActiveForUI` client-side).
5. **Inactivos fuera del mapa (§4.1):** los móviles inactivos NO se dibujan (ni hoy ni en fecha anterior). En **fecha anterior** no se dibuja ningún marcador de móvil y no se muestra info de lote/capacidad.
6. **Pantalla "Ver recorrido" (§4.2):** `RouteAnimationControl` / `TrackingModal` arman la lista de móviles desde `moviles_dia` (filas de la fecha con `last_gps_datetime` no nulo) en vez de `/api/moviles-with-activity`. Estado al lado si es hoy; "inactivo" en todos si es fecha anterior. El **dibujo** del recorrido sigue desde `gps_tracking_history` (sin cambios).
7. (Opcional, evaluable) `SaturacionZonasLayer`: precalcular `capacidad_disponible` por zona en agregación server-side. **Puede diferirse** — no bloquea.

**Criterio de aceptación:** colores/íconos/popups/capa de móviles-zonas idénticos visualmente, alimentados por la nueva fuente. Inactivos no aparecen en el mapa; fecha anterior sin marcadores de móvil. "Ver recorrido" lista desde `moviles_dia` y dibuja igual que antes. Sin regresiones en culling ni en el movimiento en vivo del marcador.

---

### Fase 6 — Migrar vista extendida + contadores + estadísticas globales

**Objetivo:** eliminar los re-escaneos O(n×z) y O(n×m) usando los agregados de `moviles_dia`.

Tareas:
1. `DashboardIndicators`: `movilesSinReportar` se deriva **en el cliente** comparando `last_gps_datetime` contra (ahora − X min), donde **X sale de las preferencias** del usuario (no es un flag guardado: depende del reloj y de la pref). `sin-asignar` también se deriva en cliente porque depende de la ventana SA (`serverNow` + pref `minutosAntesSa`). Entregados / cumplimiento se calculan on-demand desde `pedidos` como hasta ahora (no se persisten).
2. `MovilesSinGPS`: `WHERE last_gps_lat IS NULL` — móvil que **nunca reportó** posición (distinto de "sin reportar hace X min", que es el punto 1). Reemplaza el filtro del array.
3. `LeaderboardModal`: la lista, los `pedidos_pendientes`/`services_pendientes` y los flags vienen de `moviles_dia`. El cumplimiento / entregados / atrasados del ranking se siguen calculando **on-demand** desde `pedidos`/`services` (NO precalculados). Exclusión de ocultos vía `oculto_operativo`.
4. `ZonaEstadisticasModal`: usa `moviles_dia` para la lista/estado/flags de móviles y los pendientes; las **stats de cumplimiento por zona** se siguen calculando on-demand desde `pedidos`/`services` (correctitud). La ganancia se concentra en no re-derivar visibilidad/estado, no en los agregados de cumplimiento.
5. `PedidosTableModal` / `ServicesTableModal`: el combo de móviles se arma desde `moviles_dia` (reemplaza `getMovilesConPedidosMatching` / `getMovilesConFinalizadosEnFecha`) y se muestra **igual que la barra lateral** — activos arriba, inactivos abajo (§4.3) — **conservando la selección con la que se entró** desde el colapsable (por defecto, todos).

**Criterio de aceptación:** lista de móviles, estado, flags y pendientes vienen de `moviles_dia`; las stats de cumplimiento se siguen calculando on-demand y dan los mismos números que hoy (sin riesgo de drift). Sin regresiones.

---

### Fase 7 — Limpieza, código muerto y tests

**Objetivo:** retirar lo viejo y dejar la suite verde.

Tareas:
1. Borrar endpoints `/api/all-positions` y `/api/moviles-extended`.
2. Borrar funciones de `lib/moviles/visibility.ts` que quedan sin uso (`getHiddenMovilIds`, `getHiddenMovilIdsFromEstadosMap`, `getMovilesConOperacionEnFecha`, y posiblemente `getMovilesConPedidosMatching` / `getMovilesConFinalizadosEnFecha` si se migran a query). **Mantener** `isMovilActiveForUI` (regla de negocio pura, usada en server-port y tests).
3. Retirar canales realtime viejos (`gps`, `moviles`) y la **reconciliación multi-fuente vieja** / debounce de eventos de móvil (queda solo el re-query simple del snapshot de `moviles_dia`).
4. Quitar el feature flag.
5. **Tests** (rewrite/ajuste):
   - `dashboard-lifecycle.test.ts`: mocks de `/api/moviles-dia` en vez de all-positions + extended; 1 request.
   - `movil-event-refetch.test.ts`: canal `moviles_dia`, refetch dirigido.
   - `movil-counters.test.ts`: contadores desde la tabla.
   - `distribuidor-scope-ui.test.ts`: borrar tests de `getHiddenMovilIds`; verificar scope server-side + RLS.
   - `combo-moviles-extendida.test.ts`: combo desde query a `moviles_dia` (o mantener funciones puras con tests si se conservan).
   - `movil-filter-fix.test.ts`: AC de `hiddenMovilIds` → flag `oculto_operativo`; mantener AC de color/capacidad.
   - `all-positions-gps-seed.test.ts`: migrar a `/api/moviles-dia`; quitar casos de reconciliación.
   - **Conservar** `import-moviles-autocreate-gps.test.ts` (la ingesta a tablas base no cambia) y `estadoPedido.test.ts`.

**Criterio de aceptación:** sin código muerto, sin flag, `npm test` verde, comportamiento idéntico al inicial.

---

## 6. Inventario de impacto (resumen de los 3 análisis)

### Capa de datos / backend
- **Nueva:** tabla `moviles_dia`, triggers, función de recálculo, job de rollover, RLS, `/api/moviles-dia`, endpoint admin de rebuild + **utilidad de reconstrucción en `PreferenciasGlobalesModal`** (pide fecha/rango).
- **Se mantiene:** `gps_latest_positions` + `gps_tracking_history` (ingesta), `pedidos`/`services`, `empresas_fleteras`, `zonas`/`demoras`/`moviles_zonas`.
- **Se retira:** `/api/all-positions`, `/api/moviles-extended`.

### Colapsable + dashboard (`app/dashboard/page.tsx`)
- **Borrar:** `enrichMovilesWithExtendedData`, `hiddenMovilIds`, `allHiddenMovilIds`, `inactivosDelDia`, `movilesConOperacion`, `pedidosAsignadosClientMap`, `movilesFilteredMarked`, la **reconciliación multi-fuente** (diff add/remove) + cache `outOfScopeMovilIds`, debounce de eventos de móvil.
- **Simplificar:** `fetchPositions`→`fetchMovilesDia`, los 3 polling loops (la reconciliación pasa a ser un re-query trivial del snapshot de `moviles_dia`, como *safety net*), los effects de merge realtime, `allMovilesSelected`, `movilesForMap`, `pedidosForMap`, auto-select.
- **Mantener:** `pedidosCompletos`/`servicesCompletos`, persistencia de `selectedDate`/`selectedMoviles`.

### Mapa + capas
- **Afectados (deben migrar):** `getMovilColor`, creación de íconos, `CulledMovilesLayer`, `MovilInfoPopup`, `MovilesZonasLayer`, `RouteAnimationControl`/`TrackingModal` (lista de móviles del recorrido desde `moviles_dia`; el **dibujo** sigue por `gps_tracking_history`).
- **Opcional:** `SaturacionZonasLayer` (precompute por zona).
- **Sin cambios:** `DemorasZonasLayer`, `PedidosZonasLayer`, `ZonasActivasLayer`, `DistribucionZonasLayer`, clustering, viewport culling, dibujo del recorrido (`gps_tracking_history`).

### Vista extendida + contadores + estadísticas
- **Alto impacto:** `ZonaEstadisticasModal`, `LeaderboardModal`.
- **Medio:** `DashboardIndicators`, `MovilInfoCard`, `PedidosTableModal`/`ServicesTableModal` (combo inactivos), `ZonaMovilesViewModal`.
- **Directo:** `MovilesSinGPS` (`currentPosition`→`last_gps_*`).
- **Sin cambios:** `Navbar`, `FloatingToolbar`.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La lógica de flags difiere sutilmente de la actual | Test de paridad (Fase 1) como gate obligatorio antes de migrar consumidores. |
| Write amplification / ruido realtime por GPS en fila ancha (Opción A) | Perf knob de throttle en Fase 3; medir con flota real. |
| Triggers de contadores pesados ante muchos eventos de pedido | Patrón *dirty-flag + recompute debounced*, no recálculo síncrono por evento. |
| Fuga de scope por realtime client-side | RLS sobre `moviles_dia` (Fase 3) + filtro de canal. |
| Regresión durante migración | Feature flag por fase + canales viejos disponibles para rollback hasta Fase 7. |

---

## 8. Puntos abiertos a confirmar antes de implementar

1. Números de **flota por escenario + frecuencia de GPS** (solo afinan el throttle de Fase 3; no cambian la arquitectura).
2. Validar **nombres/tipos reales** de columnas contra el schema actual de Supabase.

**Ya decidido:** **retención = 180 días** (las fuentes conservan ~180 días → `moviles_dia` es reconstruible/corregible hasta 180 días atrás; la utilidad de Preferencias Globales acepta rango dentro de esa ventana); mantenimiento = recompute a nivel aplicación en las APIs de pedidos/services + triggers para estado/GPS; cumplimiento = on-demand (no se persiste); GPS = Opción A; `cant_atrasados`/`movilesSinReportar` = cliente.
