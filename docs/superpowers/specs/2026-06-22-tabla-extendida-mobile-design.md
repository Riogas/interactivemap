# Tabla extendida — versión mobile (Pedidos / Services)

**Fecha:** 2026-06-22
**Autor:** dmedaglia + Claude
**Componentes afectados:** `PedidosTableModal`, `ServicesTableModal` (aditivo), + nuevos en `components/ui/mobile/`

## Contexto

La "tabla extendida" son dos modales casi paralelos:

- `components/ui/PedidosTableModal.tsx` (~1519 líneas)
- `components/ui/ServicesTableModal.tsx`

Cada uno tiene ~700 líneas de **lógica de datos** (filtros, búsqueda, orden,
paginación, stats, combos de opciones) que es **independiente del layout**, y
luego un render `<table>` denso pensado para PC. En PC la tabla es excelente;
en un celular es inusable (scroll horizontal, columnas minúsculas).

**Objetivo:** una versión mobile usable (tarjetas) que se muestre
automáticamente en pantallas angostas, **sin modificar en nada el render
desktop**. La web debe quedar idéntica.

## Decisiones (acordadas con el usuario)

| Tema | Decisión |
|---|---|
| Activación | Automática por ancho de viewport: `≤ 768px` → tarjetas; `> 768px` → tabla actual. Rotar/redimensionar conmuta en vivo. |
| Alcance | Pedidos **y** Services. |
| Formato de tarjeta | Compacta: toda la info clave visible (sin necesidad de expandir). |
| Filtros | Barra fija arriba (búsqueda + Pendientes/Finalizados) + hoja inferior (bottom-sheet) con el resto. |
| Paginación | **Infinite scroll** (IntersectionObserver) + botón "Cargar más" de respaldo. |

## Principio de no-regresión (web idéntica)

La lógica de datos NO se duplica ni se mueve. En cada modal:

1. Se agrega `const isMobile = useIsMobile();` **después** de todos los hooks
   existentes (cumple las reglas de hooks; no hay returns condicionales antes).
2. **Justo antes** del `return (<AnimatePresence>… tabla desktop …)`, se inserta:
   ```tsx
   if (isMobile) {
     return <PedidosTableMobile ctx={{ /* todo lo ya calculado */ }} />;
   }
   ```
   El bloque desktop queda **textualmente intacto** (no se reindenta ni se toca).
3. El render mobile reutiliza el 100% de lo ya calculado (`sorted`, `stats`,
   `filters`, `setFilters`, handlers, combos). Incluye el fix de aporte/staleness
   y todos los gates de scope/funcionalidad sin reescribir nada.

Edits a los 2 modales = **solo aditivos**: 1 import + 1 línea de hook + 1 `if`.

## Arquitectura

### Hook nuevo: `hooks/useIsMobile.ts`

```ts
export function useIsMobile(maxWidthPx = 768): boolean
```

- SSR-safe: retorna `false` en server / primer render; en `useEffect` evalúa
  `window.matchMedia(`(max-width: ${maxWidthPx}px)`)` y suscribe a cambios.
- Limpia el listener en unmount. Sin dependencias externas.

### Paso de datos: un único objeto `ctx`

Para no inflar los modales (1500 líneas) ni hacer prop-drilling de ~30 props,
el render mobile vive en componentes propios y recibe **un solo objeto** con
todo lo que necesita. Forma (Pedidos; Services análogo con sus campos):

```ts
interface PedidosMobileCtx {
  isOpen: boolean;
  onClose: () => void;
  // datos
  sorted: { pedido: PedidoSupabase; delayMins: number | null; delayInfo: DelayInfo }[];
  pedidosBaseLen: number;
  stats: Record<string, number>;
  // paginación (infinite scroll reusa `page`)
  page: number; setPage: (u: number | ((p: number) => number)) => void;
  pageSize: number;
  // filtros y setter (mismos que desktop)
  filters: Filters; setFilters: (...);
  // toggles
  vista: 'pendientes' | 'finalizados'; onVistaChange?: (v) => void;
  isFinalizados: boolean; isFilterDisabled: boolean;
  modalTipo: 'pedidos' | 'services'; setModalTipo?: (t) => void; servicesAvailable: boolean;
  canVerSinAsignarUnitario: boolean;
  // combos / opciones
  uniqueZonas: number[]; uniqueProductos: string[]; uniqueServicioNombres: string[];
  // combo de móvil (delegado al mismo handler del desktop)
  movilCombo: { ids: number[]; selected: number[]; label: string; isColapsable: boolean; onToggle; onClear; onNone; getMovilName };
  // sort
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
  // handlers de fila
  onPedidoClick?: (id: number) => void; onMovilClick?: (id: number) => void;
  getMovilName: (id: number | null) => string;
  getMovilColor: (id: number | null) => string;
  formatTime: (s: string | null) => string;
  formatCurrency: (v: number | null) => string;
  hasActiveFilters: boolean; clearFilters: () => void;
  activeFilterCount: number;
}
```

> El objetivo del `ctx` es **no recalcular nada** en mobile: el modal ya tiene
> todo en closures; solo lo empaqueta.

### Componentes nuevos (`components/ui/mobile/`)

- `PedidosTableMobile.tsx` — shell mobile para pedidos.
- `ServicesTableMobile.tsx` — shell mobile para services.
- `PedidoCardMobile.tsx` — tarjeta compacta de un pedido.
- `ServiceCardMobile.tsx` — tarjeta compacta de un service.
- `MobileSheet.tsx` — contenedor genérico de bottom-sheet (slide-up + backdrop),
  usado tanto por Filtros como por Ordenar.

`PedidosTableMobile` y `ServicesTableMobile` comparten el patrón de shell; sus
diferencias (campos de la tarjeta, filtros propios de services como `defecto`)
justifican dos archivos en vez de uno sobre-parametrizado.

## UX mobile (detalle)

### Shell
- Sheet **full-screen** (`h-[100dvh]`, ancho completo), tema oscuro consistente
  con el modal actual. No es diálogo centrado.
- **Header** (sticky): botón cerrar (✕), título ("Pedidos" / "Services") +
  contador en vivo ("N pendientes"); segmented full-width Pendientes/Finalizados;
  segmented Pedidos/Services cuando corresponde.
- **Búsqueda** sticky (input ancho con ícono lupa).
- **Fila de acciones:** botón **Filtros** con badge del nº de filtros activos, y
  botón **Ordenar**. Ambos abren un `MobileSheet`.

### Hoja de Filtros (bottom-sheet)
Contiene los mismos controles que el panel desktop, apilados y con tap-targets
grandes:
- Asignación (Pendientes): Todos / Con Móvil / Sin Móvil (este último gateado por
  `canVerSinAsignarUnitario`). Entrega (Finalizados): Todos / Entregados / No.
- Chips de atraso (pendientes: franjas; finalizados: rangos) con contadores.
- Zona (select), Producto (select), Tipo de servicio (multi-check), Móvil
  (multi-check, delegado al **mismo** handler que desktop → mantiene la sincronía
  con colapsable cuando `openSource='colapsable'`).
- "Limpiar filtros" (cuando aplica) y "Aplicar" (cierra la hoja).
- Respeta `isFilterDisabled` (cuando `openSource ≠ 'colapsable'`): controles
  grisáceos/disabled igual que en desktop.

### Hoja de Ordenar (bottom-sheet)
Lista de columnas ordenables (las mismas del desktop según vista): Atraso, #
Pedido, Móvil, Zona, Cliente, Importe, H. Máx; en finalizados además Cumplido.
Cada opción muestra dirección actual (↑/↓) y togglea asc/desc — reusa `onSort`.

### Tarjeta compacta (aprobada)
Borde izquierdo coloreado por atraso/estado (misma escala que la fila desktop):

```
┌──────────────────────────────┐
│ ⏱ +25min          #48213 18:30 │   ← badge atraso/estado · #id · H.Máx
│ 099 123 456 · Juan Pérez       │   ← cliente: tel (fuerte) + nombre
│ 📍 Av. Italia 2940, Maldonado  │   ← dirección (+ ciudad)
│ 🟢 M12 · Z7 · Supergas13k x2   │   ← chip móvil(tap→ficha) · zona · producto
│ [Sin Asignar]              $850 │   ← estado + importe (+ obs si hay)
└──────────────────────────────┘
```

- **Pendientes:** badge = franja de atraso (`⏱ delayInfo.badgeText`); sin móvil →
  acento azul + estado "Sin Asignar".
- **Finalizados:** badge = ✔ Entregado / ✗ No Entregado; pie agrega Cumplido
  (hora) y atraso al cumplir (`+Xʹ` / `Xʹ antes`).
- Tap en la tarjeta → `onPedidoClick`/`onServiceClick` (detalle).
- Tap en el chip de móvil → `onMovilClick` (ficha) con `stopPropagation`.
- Obs pedido/cliente: si existen, una línea secundaria truncada (no rompen el alto).

### Infinite scroll
- Mobile renderiza `sorted.slice(0, (page + 1) * pageSize)` (acumula).
- Un `div` sentinel al final + `IntersectionObserver`: al entrar en viewport y si
  quedan más (`(page+1)*pageSize < sorted.length`), `setPage(p => p+1)`.
- Botón **"Cargar más"** visible como respaldo (y para accesibilidad / si el
  observer no dispara). Indicador "Mostrando X de N".
- `page` se resetea a 0 al cambiar filtros/vista/tipo (ya ocurre vía los
  `setPage(0)` existentes), colapsando la lista al tope.

## Qué NO cambia

- Todo el render desktop de ambos modales (tabla, header, panel de filtros,
  footer/paginador).
- La lógica de datos (filtros, scope, gates, orden, stats), tipos, APIs.
- El comportamiento de `openSource`, controlled/uncontrolled, snapshot/restore.

## Testing

- **Unit `useIsMobile`** (vitest + mock de `matchMedia`): default `false` en SSR;
  `true` cuando matchea; reacciona a cambios; limpia listener.
- **Smoke render** de `PedidoCardMobile` / `ServiceCardMobile`: muestra #id, tel,
  dirección, móvil; dispara `onClick` y `onMovilClick`.
- **No-regresión:** los tests existentes de la tabla
  (`__tests__/tabla-extendida-filtros-origen.test.ts`,
  `app/api/zonas/...` etc.) siguen verdes — no se toca lógica.
- **Verificación visual (Playwright):** abrir el dashboard en viewport `390×844`,
  abrir la vista extendida, screenshot de la lista de tarjetas + hoja de filtros;
  y en viewport ancho confirmar que la tabla desktop sigue igual.

## Out of scope

- Rediseño de los modales de **detalle** de pedido/service (se siguen usando los
  actuales al tocar una tarjeta).
- Cambios al colapsable / mapa / indicadores.
- Persistencia de preferencia "tabla vs tarjetas" (la activación es solo por
  ancho; sin toggle manual en esta etapa).
