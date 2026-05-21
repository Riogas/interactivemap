# Tabla extendida — Sincronización y comportamiento por origen de apertura

**Fecha:** 2026-05-21
**Autor:** dmedaglia + Claude
**Componentes:** `PedidosTableModal`, `ServicesTableModal`, `MovilSelector`, `app/dashboard/page.tsx`

## Contexto

La tabla extendida (modal Pedidos / Services) se abre desde múltiples entry points
del dashboard. Hasta ahora todos los entry points compartían el mismo
comportamiento: leer los filtros actuales del colapsable y propagar cambios
bidireccionalmente. Eso causaba dos problemas:

1. **Bypass deseado**: al abrir desde el navbar "sin asignar" o "entregados", o
   desde el click en una zona del mapa, el usuario quiere ver datos del scope
   completo de sus empresas accesibles, ignorando los `selectedMoviles` /
   `selectedEmpresas` del colapsable.
2. **Persistencia indeseada**: tras un commit reciente que eliminó
   `snapshot/restore`, cualquier filtro tocado en la tabla extendida persiste
   al cerrarla. Para los entry points "contextuales" (sin asignar, entregados,
   zona, ficha móvil), el usuario quiere que los cambios sean efímeros — al
   cerrar, vuelve al estado del colapsable previo a la apertura.

## Solución

### 1. Prop `openSource` en ambos modales

Identificador del origen de apertura. Cinco valores:

| openSource | Entry point | Persistencia | Bypass selectedMoviles | Bypass selectedEmpresas |
|---|---|---|---|---|
| `'colapsable'` | Botón "Vista extendida" en MovilSelector | Bidireccional, persiste | No | No |
| `'navbar_sin_asignar'` | DashboardIndicators → "Sin asignar" | Snapshot/restore | Sí | Sí |
| `'navbar_entregados'` | DashboardIndicators → "Entregados" / "Porcentaje" | Snapshot/restore | Sí | Sí |
| `'zona_combo'` | Click en zona de capa "Pedidos/Zona" | Snapshot/restore | Sí | Sí |
| `'movil_individual'` | Popup "Ver pendientes" + leaderboard onStatClick | Snapshot/restore | Sí (preFilterMovil delimita) | Sí |

El `pedidosCompletos` / `servicesCompletos` del dashboard ya filtra por
scope del usuario (`allowedMovilIds`, no por `selectedEmpresas`). El "bypass
selectedEmpresas" se materializa porque el modal no aplica filtro adicional
de empresa cuando `openSource !== 'colapsable'`.

### 2. Caso 1 — vista finalizados respeta `selectedMoviles` cuando `openSource='colapsable'`

Hoy `PedidosTableModal:300-308` (y simétrico en services) ignora
`selectedMoviles` en la rama `isFinalizados`. La rama se mantiene solo cuando
`openSource !== 'colapsable'` (es decir, en `'navbar_entregados'` el total debe
coincidir con el navbar — comportamiento histórico opción C de 2026-05-19).

### 3. Caso 5 — combo de móvil multi-select

#### Tipo

`PedidoFilters.movil`: `number | null` → `number[]`
`ServiceFilters.movil`: `number | null` → `number[]`

#### UI

Dropdown con checkboxes (mismo patrón que `atraso` en el mismo modal).
Lista de opciones: solo móviles del scope del usuario, no `selectedEmpresas`.

#### Sincronización

- `openSource='colapsable'`: el dropdown muestra `selectedMoviles` pre-tildados.
  Cambios en el dropdown ↔ `selectedMoviles` bidireccional (tildar = agregar
  al colapsable; destildar = remover).
- Otros sources: el dropdown está vacío inicialmente (o pre-lleno por
  `preFilterMovil` en `'movil_individual'`). Cambios afectan al colapsable
  temporalmente, restaurados al cerrar.

#### Migración

`view-state.ts` guarda `pedidosFilters` en sessionStorage. Al rehidratar:
- `movil` legado (number | null) → `[number]` o `[]`
- `movil` nuevo (number[]) → tal cual

### 4. Caso 6 — gate sin-asignar actualizado

Nueva regla (aplica a pedidos + services, vista **pendientes únicamente**):

```ts
const canSeeUnassigned = canVerSinAsignarUnitario && (
  pedidosFilters.asignacion === 'sin_movil' || allMovilesSelected
);
```

En vista finalizados se mantiene el gate estricto (solo `allMovilesSelected`).

Ubicaciones a tocar:
- `MovilSelector.tsx:557` (canSeeUnassigned pedidos)
- `MovilSelector.tsx:728` (canSeeUnassignedSvc)
- `app/dashboard/page.tsx:2414` (pedidosForMap)
- `app/dashboard/page.tsx:2462` (servicesForMap)
- `components/ui/PedidosTableModal.tsx:316` (rama selectedMoviles>0 — usar `filters.asignacion`)
- `components/ui/ServicesTableModal.tsx:235` (idem)

### 5. Snapshot/restore por source

Se reintroduce `pedidosSnapshotRef` / `servicesSnapshotRef` (que el commit
`325e364` había neutralizado), pero solo se activa cuando
`openSource !== 'colapsable'`:

```ts
const restorePedidosState = useCallback(() => {
  if (currentOpenSource === 'colapsable') {
    // Bidireccional: NO restaurar filtros. Solo limpiar señales contextuales.
    setPreFilterMovil(undefined);
    setPreFilterZona(undefined);
    setPedidosInitialAtraso(undefined);
    pedidosSnapshotRef.current = null;
    return;
  }
  // Contextual: restaurar snapshot completo (filtros + selectedMoviles + selectedEmpresas).
  const snap = pedidosSnapshotRef.current;
  if (!snap) return;
  setPedidosFilters(snap.filters);
  setSelectedMoviles(snap.selectedMoviles);
  setSelectedEmpresas(snap.selectedEmpresas);
  setPreFilterMovil(snap.preFilterMovil);
  setPreFilterZona(snap.preFilterZona);
  setPedidosInitialAsignacion(snap.initialAsignacion);
  setPedidosInitialAtraso(snap.initialAtraso);
  pedidosSnapshotRef.current = null;
}, [...]);
```

El snapshot ahora incluye `selectedMoviles` y `selectedEmpresas`. Idem para
services con su propio snapshot.

### 6. Cambios por archivo

| Archivo | Cambios |
|---|---|
| `types/index.ts` | `PedidoFilters.movil` y `ServiceFilters.movil` → `number[]` |
| `lib/view-state.ts` | Migración legacy: `null/number → number[]` al rehidratar |
| `app/dashboard/page.tsx` | + `openSource` state, setearlo en cada handler, snapshot/restore por source, gate Caso 6 en map filters, defaultPedidosFilters/defaultServicesFilters.movil = [] |
| `components/ui/PedidosTableModal.tsx` | + `openSource` prop, rama isFinalizados respeta selectedMoviles si colapsable, combo movil multi-select, gate Caso 6, filters.movil tipo array |
| `components/ui/ServicesTableModal.tsx` | Igual que pedidos |
| `components/ui/MovilSelector.tsx` | Gate Caso 6, filters.movil tipo array en filtrado |

### 7. Pruebas manuales (criterios de aceptación)

#### Caso 1
- Estado: empresa A + móviles 20, 21 seleccionados, vista pendientes.
- Acción: abrir tabla extendida desde colapsable → ver pedidos del 20+21 → presionar "Finalizados".
- Esperado: ver finalizados solo del 20+21 (no todos los finalizados de la empresa).

#### Caso 2
- Estado: empresas parciales o móviles parciales seleccionados.
- Acción: click "Sin asignar" en navbar.
- Esperado: ver todos los pedidos sin móvil del scope del usuario (sin importar selección actual). Filtro `asignacion='sin_movil'` aplicado.
- Acción: cerrar modal.
- Esperado: estado del colapsable vuelve a lo previo.

#### Caso 3
- Estado: cualquiera.
- Acción: click "Entregados" en navbar.
- Esperado: ver TODOS los finalizados-entregados del scope del usuario.
- Acción: cerrar.
- Esperado: estado previo restaurado.

#### Caso 4
- Estado: empresa parcial seleccionada.
- Acción: click en zona X en capa Pedidos/Zona con combo "Atrasados".
- Esperado: tabla extendida muestra pedidos atrasados de zona X, de TODAS las empresas del scope del usuario.
- Acción: cerrar.
- Esperado: estado previo restaurado.

#### Caso 5
- Estado: móviles 20, 21 en colapsable, abrir modal desde colapsable.
- Esperado: dropdown movil muestra 20, 21 tildados.
- Acción: destildar 21 dentro del modal.
- Esperado: colapsable también deselecciona 21 (bidireccional).
- Acción: tildar móvil 30 desde modal.
- Esperado: colapsable también selecciona 30.

#### Caso 6
- Estado: usuario con funcId 12 + algunos móviles seleccionados (no todos).
- Acción: en tabla extendida, vista pendientes, filtrar asignacion='sin_movil'.
- Esperado: ver pedidos sin asignar (gate permite por asignacion=sin_movil).
- Acción: cambiar a asignacion='todos'.
- Esperado: dejar de ver sin asignar (no allMovilesSelected y no sin_movil).

## Out of scope

- Cambios al cálculo de `allMovilesSelected` (ya cubierto en commit `f9654bc`).
- Comportamiento del filtro de actividad del colapsable.
- Refactor del flujo de `pedidosInitialAtraso` (queda como está).
