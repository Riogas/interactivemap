# Design Spec — Capas por zona: combo "Moviles" (prio/tránsito) y combo "Tipo" (pedidos/services)

**Fecha:** 2026-05-29 · **Branch:** `dev` · **Estado:** Borrador para revisión
**Relacionado:** `docs/superpowers/specs/2026-05-29-pendientes-arrastre-dia-anterior-design.md`

---

## 1. Resumen / Objetivo

Este documento cubre **dos features relacionadas** sobre las capas de coloreo de zonas del mapa, más un **agregado transversal** sobre la consistencia del modal de tabla al clickear una zona.

- **Feature B — Capa "Móviles en zonas":** agregar un segundo combo **"Moviles"** con valores `Prioridad + Transito` (default) / `Prioridad` / `Transito`. Este combo define qué subconjunto de móviles se cuenta por zona y, por lo tanto, **el color** de la zona. Decisión confirmada del usuario: el color SIEMPRE refleja el conteo del subconjunto elegido, para TODOS los tipos de servicio (URGENTE/NOCTURNO/SERVICE), unificando el comportamiento y corrigiendo la rareza actual donde SERVICE coloreaba solo por prioridad. Además se renombra el título de la leyenda a **"Tabla de Ref."**.

- **Feature C — Capa "Pedidos por zona":** agregar un combo **"Tipo"** con valores `Pedidos` (default) / `Services`, renombrar el combo existente de `Pedidos:` → **`Estado:`** (Pendientes / Sin Asignar / Atrasados), y permitir colorear las zonas usando la data de **services** con la misma lógica de los 3 estados.

- **Agregado transversal — Consistencia del modal de zona:** al clickear una zona, el modal de tabla debe abrir con su combo "Tipo" PRE-SELECCIONADO para coincidir con la capa de origen (si venís de `Tipo=Services` → abre en Services; si de Pedidos → abre en Pedidos). Hoy abre siempre en Pedidos.

> **Estado de verificación (VERIFY):** todos los file:line de este documento fueron verificados contra el código en `dev` al 2026-05-29. Hallazgos clave de VERIFY:
> 1. `servicesCompletos` **YA EXISTE** (`app/dashboard/page.tsx:2487-2520`), análogo a `pedidosCompletos` (`:2433-2484`). No hay que crearlo.
> 2. `PedidosTableModal` **NO** tiene combo Tipo Pedidos/Services: solo recibe `pedidos` (no `services`) — hay que extenderlo o crear equivalente.
> 3. **NO** existe un memo `servicesZonaData` análogo a `pedidosZonaData`: hay que crearlo. Sí existe filtrado de services por zona puntual en `servicesForMap` (`app/dashboard/page.tsx:2847-2900`, ej. `:2886`) pero es para el render de markers, no un conteo por zona.
> 4. La persistencia de filtros de capa se hace vía `useViewStateSync` (`app/dashboard/page.tsx:537-545`, hidratado en `:563-564`), NO sessionStorage directo.

---

## 2. Feature B — Capa "Móviles en zonas": nuevo combo "Moviles"

### 2.1 Estado actual (verificado)

- **Componente:** `components/map/MovilesZonasLayer.tsx`.
- **Combo "Tipo Servicio:"** en `MovilesZonasFilterControl` (`components/map/MovilesZonasLayer.tsx:118-174`), label `"Tipo Servicio:"` (`:141`), valores fijos `TIPOS_SERVICIO_FIJOS = ['URGENTE','SERVICE','NOCTURNO']` (`:115`).
- **Estado en dashboard:** `movilesZonasServiceFilter` / `setMovilesZonasServiceFilter` (`app/dashboard/page.tsx:306`), pasado al layer en `:3995-3996`.
- **Auto-switch por horario:** `determineServicePeriod` dentro de `hooks/dashboard/useMapDataView.ts:84` (no `lib/hooks/`). Cambia el período de servicio automáticamente según la hora.
- **Clasificación móvil:** columna `moviles_zonas.prioridad_o_transito` (`docs/sqls/alter-moviles-zonas-add-campos.sql`): **1 = prioridad, ≠1 (=2) = tránsito**. Interface `MovilZonaRecord` (`MovilesZonasLayer.tsx:34-42`).
- **Filtrado previo (`MovilesZonasLayer.tsx:219-233`):** por `tipo_de_servicio` (match con `serviceFilter`, case-insensitive) + exclusión de inactivos (`isMovilActiveForUI`) y ocultos (`hiddenMovilIds`).
- **Conteo por zona (`:235-251`):** `MERGE_FILTERS = ['URGENTE','NOCTURNO']` (`:237`) → `mergeAll` (`:238`) mete prioridad y tránsito juntos en el contador `prioridad`; para `SERVICE` quedan separados (`prioridad` vs `transito`).
- **Coloreo (`:283`):** `getColorByPrioridad(counts.prioridad, visualRefs)` — **colorea por el contador `prioridad`, NO por el total**. Función de color `:15-23` (`0→Ref#8, 1→Ref#9, 2→Ref#10, 3→Ref#11, 4+→Ref#12`). El `total = counts.prioridad + counts.transito` se calcula en `:282` pero **NO se usa para el color** (solo para las etiquetas en `mergeAll`).
- **Leyenda:** `MovilesZonasLegend` (`:176-200`), título actual `"Móviles / Zona"` (`:184`), clase CSS `.demora-legend-title` (`components/map/DataViewControl.css`). Refs Ref#8–Ref#12 en `lib/visual-refs-catalog.ts:28-33`.
- **Etiquetas de conteo ("Cant.", toggle `:145-149`):** en `mergeAll` muestran `total`; en SERVICE muestran `prioridad/transito` (`:351`).
- **API datos:** `app/api/moviles-zonas/route.ts:92-122`.

#### Discrepancia actual del color en SERVICE (a corregir)

Hoy el color de la zona se determina **siempre** por `counts.prioridad`:

- Para **URGENTE / NOCTURNO** (`mergeAll = true`), `counts.prioridad` acumula prioridad **+** tránsito → el color refleja el total. Coherente.
- Para **SERVICE** (`mergeAll = false`), `counts.prioridad` solo cuenta `prioridad_o_transito === 1` y `counts.transito` queda aparte → **el color ignora completamente el tránsito**. Una zona con 0 prioridad y 5 tránsito se pinta como "0 móviles" (Ref#8, rojo). Esta es la rareza a corregir.

### 2.2 Cambio requerido

1. Agregar un **segundo combo** debajo del de "Tipo Servicio:", etiqueta **"Moviles"**, valores:
   - **"Prioridad + Transito"** (DEFAULT)
   - **"Prioridad"**
   - **"Transito"**
2. Ese combo define el subconjunto que se cuenta por zona y, por lo tanto, el **color**:
   - `"Prioridad"` → contar solo `prioridad_o_transito === 1`.
   - `"Transito"` → contar solo `prioridad_o_transito !== 1`.
   - `"Prioridad + Transito"` → contar ambos (el "merge" de hoy).
3. **Decisión del usuario (confirmada):** el color SIEMPRE refleja el conteo del subconjunto elegido, para **todos** los tipos de servicio (URGENTE/NOCTURNO/SERVICE). Esto **unifica el comportamiento** y **corrige la rareza** descrita arriba. Implica reemplazar la lógica `MERGE_FILTERS` / `getColorByPrioridad(counts.prioridad)` por un **único `count`** = conteo del subconjunto del combo, coloreado con `getColorByCount(count)`.
4. **Nuevo estado en dashboard:** `movilesZonaMovilFilter` (tipo `'prio_transito' | 'prioridad' | 'transito'`, default `'prio_transito'`), pasado como prop al layer. Persistirlo igual que los otros filtros de capa (vía `useViewStateSync`, ver §6). **NO** auto-switch (control manual del usuario; el auto-switch de horario sigue aplicando solo al combo "Tipo Servicio:").
5. Renombrar el **título de la leyenda** de `"Móviles / Zona"` a **"Tabla de Ref."**. Mantener los mismos rangos `0/1/2/3/4+` y refs Ref#8–Ref#12.
6. Documentar que las **etiquetas de conteo por zona** (toggle "Cant.") ahora reflejan el conteo del subconjunto elegido (un único número), no `prioridad/transito`.

### 2.3 Lógica de conteo nueva (pseudo)

Reemplazar `zonaCounts` (`:239-251`) y el cálculo de color (`:281-283`) por:

```
type MovilSubset = 'prio_transito' | 'prioridad' | 'transito';

// conteo por zona = un solo número, según subset
for (const mz of filteredData) {
  const isPrioridad = mz.prioridad_o_transito === 1;
  const incluir =
    movilFilter === 'prio_transito' ? true
    : movilFilter === 'prioridad'   ? isPrioridad
    : /* 'transito' */                !isPrioridad;
  if (incluir) count[zona]++;
}

// color: por ese count, para TODOS los tipos de servicio
fillColor = getColorByCount(count); // 0→Ref#8, 1→Ref#9, 2→Ref#10, 3→Ref#11, 4+→Ref#12
```

`getColorByPrioridad` (`:15-23`) puede renombrarse a `getColorByCount` (mismos rangos/refs) o reusarse tal cual pasándole el `count` del subconjunto. La lógica `MERGE_FILTERS` / `mergeAll` (`:237-238`) se **elimina**. Las etiquetas (`:351`) muestran `count` directamente.

### 2.4 UI

- Segundo combo "Moviles" en `MovilesZonasFilterControl`, reutilizando estilos `.mz-filter-label` / `.mz-filter-select` (mismo patrón que el combo "Tipo Servicio:").
- Leyenda: solo cambia el texto del título (`MovilesZonasLayer.tsx:184`). Sin cambios en swatches/refs.

### 2.5 Archivos a tocar (Feature B)

- `components/map/MovilesZonasLayer.tsx` — combo nuevo, props nuevas (`movilFilter`, `onMovilFilterChange`), conteo por subconjunto, color por `count`, título de leyenda, etiquetas.
- `app/dashboard/page.tsx` — estado `movilesZonaMovilFilter` + setter (cerca de `:306`), wiring al layer (cerca de `:3994-3996`), persistencia (ver §6).
- `hooks/useViewStateSync` (ubicación a confirmar) — agregar el nuevo filtro al estado sincronizado/hidratado (`app/dashboard/page.tsx:542-544`, `:563-564`).

---

## 3. Feature C — Capa "Pedidos por zona": combo "Tipo: Pedidos/Services" + rename "Pedidos:"→"Estado:"

### 3.1 Estado actual (verificado)

- **Componente:** `components/map/PedidosZonasLayer.tsx`. Combo en `PedidosZonaFilterControl` (`:100-134`), etiqueta actual **`"Pedidos:"`** (`:115`), valores `pendientes / sin_asignar / atrasados` (`:117-119`). Tipo `PedidosZonaFilter` (`:10`).
- **Estado dashboard:** `pedidosZonaFilter` / `setPedidosZonaFilter` (`app/dashboard/page.tsx:385`), wiring al layer en `:3988-3991`.
- **Cálculo conteo por zona:** memo `pedidosZonaData` (`app/dashboard/page.tsx:2622-2650`), agrupa `pedidosCompletos` por `zona_nro`. Definiciones:
  - **Pendientes** = `estado_nro === 1` (`:2632`).
  - **Sin Asignar** = `estado_nro === 1 && !tieneMovil` (`:2634`), con gate de permiso `canVerSinAsigPorZona` (`:2625`, `:2630`) y ventana temporal SA `isWithinSaWindow(p.fch_hora_para, serverNow, minutosAntesSa)` (`:2636`).
  - **Atrasados** = `estado_nro === 1 && computeDelayMinutes(p.fch_hora_max_ent_comp) < 0` (`:2638-2642`).
  - **Scope por rol/empresa:** `scopedZonaIds` (`:2646`).
- **Color:** `getPedidosColor` / `getPedidosOpacity` (`PedidosZonasLayer.tsx:78-92`), rangos `Ref#16(0) / Ref#17(1-3) / Ref#18(4-7) / Ref#19(8-11) / Ref#20(12+)`. Leyenda con título dinámico (`:149`): `"Pendientes / zona"` / `"Sin asignar / zona"` / `"Atrasados / zona"`.
- **Wiring:** props en `app/dashboard/page.tsx:3988-3991`; render en `components/map/MapView.tsx`. Click de zona → `onZonaClick` (`app/dashboard/page.tsx:4016-4034`) abre `PedidosTableModal` con `setPedidosModalInitialFilters` / `setPedidosModalVista` / `setPedidosInitialAtraso`.
- **Tabla `services`** (`docs/sqls/create-services-table.sql:7-75`): MISMA estructura relevante (`estado_nro`, `movil`, `zona_nro`, `sub_estado_nro/desc`, `fch_hora_max_ent_comp`, `fch_hora_para`). Ya hay realtime de services (`useServicesRealtime` en `lib/hooks/useRealtimeSubscriptions.ts`) y fetch inicial (`servicesIniciales`, `app/dashboard/page.tsx:666`).
- **NO existe capa services-por-zona hoy** (verificado: no hay memo `servicesZonaData`).
- **Tabla extendida:** `components/ui/PedidosTableModal.tsx`.

### 3.2 Cambio requerido

1. Agregar combo nuevo etiqueta **"Tipo:"** con valores **"Pedidos"** (DEFAULT) / **"Services"**. Nuevo estado dashboard `zonaLayerTipo: 'pedidos' | 'services'`, default `'pedidos'`.
2. Renombrar la etiqueta del combo existente de **`"Pedidos:"`** a **`"Estado:"`** (`PedidosZonasLayer.tsx:115`). Mismos 3 valores: Pendientes / Sin Asignar / Atrasados.
3. Cuando `Tipo = Services`: calcular el conteo por zona usando la data de **services** (no pedidos), con la **misma lógica de los 3 estados** (decisión confirmada):
   - Pendientes = `estado_nro === 1`.
   - Sin Asignar = `estado_nro === 1 && sin móvil`, con el **mismo gate** `canVerSinAsigPorZona` + ventana SA `isWithinSaWindow`.
   - Atrasados = `estado_nro === 1 && computeDelayMinutes(fch_hora_max_ent_comp) < 0`.
   - Reusar mismos colores/rangos Ref#16–Ref#20.
4. Cuando `Tipo = Pedidos`: comportamiento **idéntico** al actual.
5. Leyenda: cuando `Tipo = Services`, mantener mismos rangos/colores. **Recomendación (marcada, simple):** mantener el título dinámico actual (`"Pendientes / zona"`, etc.) sin cambios — es lo más simple y la diferencia Pedidos/Services ya es visible en el combo "Tipo:". *(Alternativa opcional si el usuario lo pide: anteponer `"Services · "` al título cuando `Tipo = Services`.)*

### 3.3 Lógica de conteo de services (misma que pedidos)

**Fuente de datos:** `servicesCompletos` (`app/dashboard/page.tsx:2487-2520`) — **ya existe**, armado igual que `pedidosCompletos`:
- merge `servicesIniciales` (`:2489`) + `servicesRealtime` (`:2490`) en un `Map` por `id`;
- filtro por fecha seleccionada (`fch_para === selectedDateCompact` o `fch_hora_para.startsWith(selectedDate)`, `:2493-2498`);
- modo histórico → solo `estado_nro === 2` (`:2501-2503`);
- "Empresas: Ninguna" → `[]` (`:2506-2508`);
- empresa scope para no-root (`allowedMovilIds`, `:2511-2516`).

**Implementación sugerida:** crear un memo `servicesZonaData` **análogo** a `pedidosZonaData`, que aplique exactamente los mismos filtros de estado/SA/atraso/scope pero sobre `servicesCompletos`. Alternativa más DRY: extraer una función `buildZonaCounts(source, filter, { canVerSinAsigPorZona, serverNow, minutosAntesSa, scopedZonaIds })` parametrizada por la fuente (`pedidos | services`) y usarla para ambos memos. El consumidor (MapView) elige `pedidosZonaData` o `servicesZonaData` según `zonaLayerTipo`.

```
const servicesZonaData = useMemo(() => {
  const map = new Map<number, number>();
  if (zonaLayerEstado === 'sin_asignar' && !canVerSinAsigPorZona) return map;
  servicesCompletos.forEach(s => {
    const estado = Number(s.estado_nro);
    const tieneMovil = s.movil != null && Number(s.movil) !== 0;
    if (!tieneMovil && !canVerSinAsigPorZona) return;
    if (estado !== 1 && estado-relevante) return; // misma lógica que :2632-2642
    if (estado === 'sin_asignar' && serverNow && !isWithinSaWindow(s.fch_hora_para, serverNow, minutosAntesSa)) return;
    // atrasados: computeDelayMinutes(s.fch_hora_max_ent_comp) < 0
    const zona = s.zona_nro != null ? Number(s.zona_nro) : null;
    if (!zona || zona === 0) return;
    if (scopedZonaIds && !scopedZonaIds.has(zona)) return;
    map.set(zona, (map.get(zona) ?? 0) + 1);
  });
  return map;
}, [servicesCompletos, pedidosZonaFilter, scopedZonaIds, serverNow, minutosAntesSa, canVerSinAsigPorZona]);
```

> El conteo elegido (`zonaLayerTipo === 'services' ? servicesZonaData : pedidosZonaData`) se pasa como `pedidosCount` al `PedidosZonasLayer` — la firma del layer no cambia (sigue siendo `Map<number, number>`), solo cambia la fuente.

### 3.4 UI

- Combo "Tipo:" nuevo en `PedidosZonaFilterControl` (`PedidosZonasLayer.tsx:100-134`), por encima o al lado del combo "Estado:". Reusar `.mz-filter-label` / `.mz-filter-select`.
- Rename `"Pedidos:"` → `"Estado:"` (`:115`).

### 3.5 Archivos a tocar (Feature C)

- `components/map/PedidosZonasLayer.tsx` — combo "Tipo:" nuevo (props `tipo`, `onTipoChange`), rename label `"Pedidos:"`→`"Estado:"`, (opcional) prefijo de leyenda.
- `app/dashboard/page.tsx` — estado `zonaLayerTipo` + setter (cerca de `:385`), memo `servicesZonaData` (análogo a `:2622-2650`), selección de fuente para `pedidosCount`, wiring (cerca de `:3988-3991`), persistencia (§6).
- `components/map/MapView.tsx` — pasar el `pedidosCount` correcto y las props del combo Tipo al layer.

---

## 4. Agregado transversal — Consistencia del modal de zona (Tipo de origen)

### 4.1 Problema

Hoy, al clickear una zona en la capa Pedidos/Zona, `onZonaClick` (`app/dashboard/page.tsx:4016-4034`) abre `PedidosTableModal` y setea `setPedidosModalInitialFilters({ asignacion: ..., tipoServicio: [] })` (`:4027-4030`) + `setPedidosModalVista('pendientes')` (`:4031`). El modal SIEMPRE muestra **pedidos** — su combo de Tipo (si existiera) quedaría en "Pedidos". `PedidosTableModal` ni siquiera recibe `services` (solo `pedidos`, `PedidosTableModal.tsx:62`, firma en `:157`).

### 4.2 Requerimiento

El modal debe abrir con su combo "Tipo" **PRE-SELECCIONADO** para coincidir con la capa de origen:
- Si venís de la capa con `Tipo = Services` → el modal abre en **Services**.
- Si venís de la capa de pedidos por zona con `Tipo = Pedidos` → el modal abre en **Pedidos**.

### 4.3 Implicancias

a) **`PedidosTableModal` debe soportar mostrar Services además de Pedidos.** Hoy NO lo hace: solo recibe `pedidos: PedidoSupabase[]` (`:62`) y no tiene combo Tipo ni prop `services`. Opciones:
   - **Extender `PedidosTableModal`** con prop `services?: ServiceSupabase[]`, prop `tipo?: 'pedidos'|'services'` + `onTipoChange`, y combo Tipo interno; o
   - **Generalizar a un modal único parametrizado** por fuente. (Decisión de diseño a confirmar — ver §9.)
   - Relacionado con la decisión "click de zona en `Tipo=Services` abre la tabla de **Services**".

b) **`onZonaClick` debe pasar el Tipo de origen** (`zonaLayerTipo`) como filtro/estado inicial del modal, en vez del default fijo "pedidos". Concretamente, donde hoy se setea (`app/dashboard/page.tsx:4016-4034`):
   - agregar `setPedidosModalTipo(zonaLayerTipo)` (nuevo estado, análogo a `pedidosModalVista`, `:378`), y/o pasar `tipo={zonaLayerTipo}` como prop al render del modal (cerca de `:3492-3520`);
   - el cálculo `asignacion: pedidosZonaFilter === 'sin_asignar' ? 'sin_movil' : 'todos'` (`:4028`) y `initialAtraso` (`:4032`) se conservan, ahora aplicados sobre la fuente correcta (pedidos o services).

c) El estado del modal `pedidosModalInitialFilters` (`:376`), `pedidosModalVista` (`:378`) y el nuevo `pedidosModalTipo` se resetean al cerrar (`restorePedidosState` / `:478-479`).

---

## 5. Comportamiento esperado (casos)

### Feature B — combo "Moviles"

| Tipo Servicio | Combo Moviles | Zona con prio=2, tránsito=3 | Color resultante |
|---|---|---|---|
| URGENTE | Prioridad + Transito | count = 5 | Ref#12 (4+) |
| URGENTE | Prioridad | count = 2 (ignora tránsito) | Ref#10 (2) |
| URGENTE | Transito | count = 3 | Ref#11 (3) |
| NOCTURNO | Prioridad + Transito | count = 5 | Ref#12 |
| SERVICE | Prioridad + Transito | count = 5 (**antes** coloreaba solo por prio=2 → Ref#10) | Ref#12 |
| SERVICE | Prioridad | count = 2 | Ref#10 |
| SERVICE | Transito | count = 3 (**antes** el tránsito se ignoraba) | Ref#11 |

> La fila SERVICE + Prioridad+Transito y SERVICE + Transito **cambian respecto a hoy** — comportamiento intencional (corrección unificadora). Etiqueta "Cant." muestra el `count` del subconjunto.

### Feature C — combo "Tipo"

| Tipo | Estado | Fuente | Conteo por zona |
|---|---|---|---|
| Pedidos | Pendientes | `pedidosZonaData` | estado_nro===1 (idéntico a hoy) |
| Pedidos | Sin Asignar | `pedidosZonaData` | estado1 + sin móvil + gate + ventana SA |
| Pedidos | Atrasados | `pedidosZonaData` | estado1 + delay<0 |
| Services | Pendientes | `servicesZonaData` (nuevo) | estado_nro===1 sobre services |
| Services | Sin Asignar | `servicesZonaData` | estado1 + sin móvil + **mismo** gate + ventana SA |
| Services | Atrasados | `servicesZonaData` | estado1 + delay<0 |

### Agregado transversal

| Origen del click | Tipo del modal al abrir |
|---|---|
| Capa con Tipo=Pedidos | Pedidos |
| Capa con Tipo=Services | Services |

---

## 6. Edge cases / riesgos

- **B — Unificación del color (cambio intencional):** SERVICE deja de colorear solo por prioridad. Documentado y aceptado por el usuario. Verificar que ningún test existente asuma la lógica `mergeAll` vieja (revisar `__tests__/moviles-zonas-recompute.test.ts`).
- **B — Auto-switch de servicio:** el auto-switch (`hooks/dashboard/useMapDataView.ts:84`) sigue aplicando SOLO al combo "Tipo Servicio:". El nuevo combo "Moviles" es 100% manual; no debe ser tocado por el auto-switch.
- **C — Reuso del gate/ventana SA en services:** confirmar que `canVerSinAsigPorZona`, `isWithinSaWindow`, `minutosAntesSa` y `serverNow` aplican igual a services (la estructura de `services` tiene `fch_hora_para` y `fch_hora_max_ent_comp`, `create-services-table.sql:7-75` → sí aplica).
- **C — Performance del doble conteo:** se agregan memos para pedidos **y** services. `servicesZonaData` solo necesita recomputar cuando `Tipo=Services` está activo; considerar gatear el cómputo por `zonaLayerTipo` para no recalcular el memo no usado (o aceptar el costo: el dataset por fecha ya está acotado).
- **Modal que ahora debe soportar services:** mayor superficie de cambio. `PedidosTableModal` está fuertemente acoplado a `PedidoSupabase`; soportar `ServiceSupabase` puede requerir generalizar tipos de fila, columnas y filtros. Riesgo de regresión en la vista de pedidos existente — testear ambos modos.
- **Persistencia:** los nuevos filtros (`movilesZonaMovilFilter`, `zonaLayerTipo`) deben sumarse a `useViewStateSync` (`app/dashboard/page.tsx:537-545`) e hidratarse (`:563-564`) para sobrevivir auto-reloads de realtime, igual que `pedidosZonaFilter` y `movilesZonasServiceFilter`. Default sano si no hay valor hidratado.

---

## 7. Plan de testing

Stack: **Vitest** (`vitest.config.ts`), tests en `__tests__/`.

### Unit
- **B — conteo por subconjunto:** nuevo `__tests__/moviles-zonas-subset-count.test.ts` (o ampliar `moviles-zonas-recompute.test.ts`): dado un set de `MovilZonaRecord` con prioridad y tránsito mezclados, verificar `count` y color para `prio_transito` / `prioridad` / `transito` en URGENTE, NOCTURNO y SERVICE. Incluir el caso "SERVICE + Transito colorea por tránsito" (regresión de la corrección).
- **C — conteo de services:** nuevo `__tests__/services-zona-count.test.ts`: verificar que `servicesZonaData` aplica la misma lógica de los 3 estados que `pedidosZonaData`, incluyendo gate `canVerSinAsigPorZona`, ventana SA y `scopedZonaIds`. Reusar fixtures de `movil-counters.test.ts` / `sa-window-filter.test.ts` donde aplique.

### E2E / integración
- Combos: cambiar combo "Moviles" recolorea zonas; cambiar combo "Tipo" alterna fuente pedidos/services; rename de labels visible.
- Colores: tabla de casos §5.
- Click de zona: abre el modal con el **Tipo de origen** correcto (pedidos vs services). Reusar/extender `tabla-extendida-filtros-origen.test.ts` y `zona-estadisticas-propagar-combos.test.ts`.

---

## 8. Checklist de archivos a tocar

### Feature B
- [ ] `components/map/MovilesZonasLayer.tsx` — combo "Moviles", props nuevas, conteo por subconjunto, color por `count`, título leyenda → "Tabla de Ref.", etiquetas.
- [ ] `app/dashboard/page.tsx` — estado `movilesZonaMovilFilter` (`~:306`), wiring (`~:3994-3996`).
- [ ] `hooks/useViewStateSync` (ubicación a confirmar) + `app/dashboard/page.tsx:542-544`, `:563-564` — persistencia/hidratación.
- [ ] `__tests__/` — test de conteo por subconjunto.

### Feature C
- [ ] `components/map/PedidosZonasLayer.tsx` — combo "Tipo:", rename "Pedidos:"→"Estado:", (opcional) leyenda.
- [ ] `app/dashboard/page.tsx` — estado `zonaLayerTipo` (`~:385`), memo `servicesZonaData` (análogo a `:2622-2650`), selección de fuente para `pedidosCount`, wiring (`~:3988-3991`), persistencia.
- [ ] `components/map/MapView.tsx` — pasar fuente correcta y props del combo Tipo.
- [ ] `__tests__/` — test de conteo de services por zona.

### Agregado transversal
- [ ] `components/ui/PedidosTableModal.tsx` — soporte de `services` + combo Tipo (o modal generalizado).
- [ ] `app/dashboard/page.tsx` — estado `pedidosModalTipo` (análogo a `pedidosModalVista` `:378`), seteo en `onZonaClick` (`:4016-4034`), prop al render del modal (`~:3492-3520`), reset al cerrar (`:478-479`).
- [ ] `__tests__/` — test del Tipo de origen del modal.

---

## 9. Preguntas abiertas / temas a profundizar

1. **Modal unificado vs extender `PedidosTableModal`:** ¿extendemos el modal de pedidos con soporte de services (prop `services` + combo Tipo) o creamos/generalizamos un único modal? Define el alcance del agregado transversal.
2. **Columnas/filtros del modal en modo Services:** ¿la tabla de services usa las mismas columnas y filtros (atraso, asignación, tipoServicio, búsqueda) que pedidos? `ServiceSupabase` tiene campos análogos pero hay que confirmar paridad (ej. `defecto`, `sub_estado_desc`).
3. **Título de leyenda en Services (Feature C §3.2.5):** ¿se deja igual ("Pendientes / zona") o se antepone "Services · "? Recomendación: dejar igual; confirmar.
4. **Gateo del memo `servicesZonaData`:** ¿computar siempre o solo cuando `zonaLayerTipo === 'services'`? Decisión de performance.
5. **Persistencia de combos nuevos:** confirmar que se quieren persistir `movilesZonaMovilFilter` y `zonaLayerTipo` a través de auto-reloads (recomendado para UX consistente).
6. **Interacción con `dataViewMode`:** ¿el combo "Tipo: Services" implica un nuevo `dataViewMode` (ej. `services-zona`) o se mantiene dentro de `pedidos-zona` solo cambiando la fuente? Hoy `onZonaClick` ramifica por `dataViewMode` (`:4016-4039`); definir si Services reusa `pedidos-zona` o introduce un modo nuevo.

---

### Metadata

- **Fecha:** 2026-05-29
- **Branch:** `dev`
- **Estado:** Borrador para revisión
- **Relacionado:** `docs/superpowers/specs/2026-05-29-pendientes-arrastre-dia-anterior-design.md`
- **Verificación:** file:line confirmados contra el código en `dev` al 2026-05-29 (ver nota VERIFY en §1).
