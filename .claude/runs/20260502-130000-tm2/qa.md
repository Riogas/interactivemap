# QA — 20260502-130000-tm2

## Veredicto: PASSED

## ACs verificados

### AC1: ZonaEstadisticasModal tooltips
- [x] `#Entreg.` tooltip dice "Entregados (estado 2, sub_estado 3 o 19)" — VERIFICADO en línea 476
- [x] `#No Ent.` tooltip dice "No Entregados (estado 2, sub_estado ≠ 3 y ≠ 19)" — VERIFICADO en línea 477

### AC2: LeaderboardModal tooltips
- [x] "Entregados (estado 2, sub_estado = 3 o 19)" — VERIFICADO línea 221
- [x] "No Entregados (estado 2, sub_estado != 3 y != 19)" — VERIFICADO línea 218

### AC3: PedidoInfoPopup — sección Cumplido solo cuando isPedidoEntregado
- [x] Condición es `{isPedidoEntregado(pedido) && ...}` — VERIFICADO línea 306
- [x] Para pedido cancelado (estado_nro=2, sub_estado_nro=5): `isPedidoEntregado` → false → sección NO se renderiza
- [x] Para pedido entregado (estado_nro=2, sub_estado_nro=3): `isPedidoEntregado` → true → sección SÍ aparece
- [x] Para pedido ENTR. SIN 1710 (estado_nro=2, sub_estado_nro=19): → true → sección SÍ aparece

### AC4: Atraso en card solo si tiene móvil
- [x] `mostrarAtraso = tieneMovil && pedido.atraso_cump_mins != null` — VERIFICADO línea 308
- [x] Sin móvil: `tieneMovil=false` → solo Fecha Cumplido (grid-cols-1)
- [x] Con móvil: si hay atraso → grid-cols-2 mostrando ambos campos

### AC5: Tabla — atraso para todos los finalizados con el campo
- [x] `mostrarAtraso = p.atraso_cump_mins != null` — VERIFICADO línea 974
- [x] Pedido cancelado con atraso_cump_mins=5 → muestra "5'"
- [x] Pedido entregado sin móvil con atraso_cump_mins=0 → muestra "0' antes"
- [x] Pedido sin atraso_cump_mins → muestra "—"

### AC6: Columna Cumplido en tabla sin cambios
- [x] `p.fch_hora_finalizacion ? formatTime(p.fch_hora_finalizacion) : '—'` — sin cambios

### AC7: Formato consistente
- [x] Tabla usa `atraso <= 0 ? '${Math.abs(atraso)}' antes' : '${atraso}''` — consistente con card

### AC8: Otros KPIs del modal sin regresiones
- [x] Lógica de cálculo de entregados, noEntregados, pendientes, atrasados — sin cambios
- [x] 310/310 tests PASSED

## Tests suite
- Resultado: 310/310 PASSED en 1.25s
- Archivos cubiertos: `__tests__/distribuidor-scope-ui.test.ts`, `scope-filter.test.ts`, `movil-filter-fix.test.ts`, etc.
- Los tests de estadoPedido y scope cubren la lógica de `isPedidoEntregado` usada en los cambios.
