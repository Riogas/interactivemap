# Implementation — 20260502-130000-tm2

## Cambios aplicados

### Bug 1: Tooltips incorrectos en ZonaEstadisticasModal y LeaderboardModal

**Problema:** Los tooltips de los encabezados "#Entreg." y "#No Ent." decían "sub_estado 3" (sin mencionar el sub_estado 19 = ENTR. SIN 1710). La lógica de cálculo con `isPedidoEntregado()` era correcta.

**Fix:** Actualización de texto en 4 tooltips:
- `ZonaEstadisticasModal.tsx` línea 476: "sub_estado 3" → "sub_estado 3 o 19"
- `ZonaEstadisticasModal.tsx` línea 477: "sub_estado ≠ 3" → "sub_estado ≠ 3 y ≠ 19"
- `LeaderboardModal.tsx` línea 221: "sub_estado = 3" → "sub_estado = 3 o 19"
- `LeaderboardModal.tsx` línea 218: "sub_estado != 3" → "sub_estado != 3 y != 19"

### Bug 2: Card PedidoInfoPopup — sección "Cumplido" aparecía para todos los finalizados

**Problema:** La condición era `Number(pedido.estado_nro) === 2 && (...)` mostrando la sección para todos los pedidos con estado=2, incluyendo cancelados, "no cumplidos", etc.

**Fix:** `components/map/PedidoInfoPopup.tsx` línea 306:
- Antes: `{Number(pedido.estado_nro) === 2 && (...) && (() => { const esEntregado = isPedidoEntregado(pedido);`
- Después: `{isPedidoEntregado(pedido) && (...) && (() => { const esEntregado = true;`

El `esEntregado = true` simplifica el código ya que la condición externa ya lo garantiza. La lógica de `mostrarAtraso` (solo si tiene móvil) se mantiene igual.

### Bug 3: Tabla extendida — columna Atraso solo visible para entregados con móvil

**Problema:** La condición `mostrarAtraso = esEntregado && tieneMovil && p.atraso_cump_mins != null` era demasiado restrictiva. El request pide mostrar el atraso para TODOS los finalizados que tengan el campo.

**Fix:** `components/ui/PedidosTableModal.tsx` línea 974:
- Antes: `const mostrarAtraso = esEntregado && tieneMovil && p.atraso_cump_mins != null;`
- Después: `const mostrarAtraso = p.atraso_cump_mins != null;`

## Verificaciones post-implementación
- `pnpm exec tsc --noEmit`: 0 errores nuevos (1 pre-existente en FloatingToolbar.tsx no relacionado)
- Vitest: 310/310 tests PASSED
- Linting: no ejecutado (vitest pasó, cambios son puramente presentación/condición simple)

## Archivos cambiados
- `components/map/PedidoInfoPopup.tsx`: +3 -3
- `components/ui/PedidosTableModal.tsx`: +2 -2
- `components/ui/ZonaEstadisticasModal.tsx`: +2 -2
- `components/ui/LeaderboardModal.tsx`: +2 -2
