# Code Review — Iteración 1

## Veredicto: APPROVED

## Cambios revisados
- `components/map/PedidoInfoPopup.tsx`: +7 -4 — condición de sección Cumplido restringida a isPedidoEntregado, dead code eliminado.
- `components/ui/PedidosTableModal.tsx`: +2 -2 — condición mostrarAtraso simplificada.
- `components/ui/ZonaEstadisticasModal.tsx`: +2 -2 — tooltips corregidos.
- `components/ui/LeaderboardModal.tsx`: +2 -2 — tooltips corregidos.

## Hallazgos

### APROBADO — sin bloqueantes
1. **PedidoInfoPopup**: La condición `isPedidoEntregado(pedido)` reemplaza correctamente `Number(pedido.estado_nro) === 2`. La función `isPedidoEntregado` ya hace el check de estado_nro=2 internamente. El dead code `esEntregado = true` fue eliminado en la revisión, quedando limpio.
2. **PedidosTableModal**: La remoción de `esEntregado && tieneMovil` es correcta. El campo `atraso_cump_mins` es null para pedidos sin datos, por lo que `mostrarAtraso = p.atraso_cump_mins != null` funciona como guarda correcta.
3. **Tooltips**: Los textos ahora reflejan fielmente la lógica de `isPedidoEntregado` que chequea sub_estado_nro 3 Y 19.
4. **Sin regresiones**: Los KPIs del ZonaEstadisticasModal no cambiaron — solo los tooltips.
5. **tsc**: 0 errores nuevos.
6. **Tests**: 310/310 PASSED.

## Notas menores (no bloqueantes)
- La columna "Atraso" en la tabla ahora muestra atraso para pedidos cancelados que tengan el campo. Esto es el comportamiento pedido por el usuario. La colorización (verde/amarillo/rojo) aplica igualmente bien.
- El banner superior de la card (`isPedidoEntregado` en línea 150) mantiene su lógica separada e intacta.
