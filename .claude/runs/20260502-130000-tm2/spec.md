# Spec mínima (inline orquestador): Bug fixes en panel modal estadística por zona y card/tabla de pedidos

## Pedido literal
Ver request.md — 3 cambios relacionados al panel modal de estadística por zona y tarjeta/tabla de pedidos.

## Síntoma reportado
1. Indicador "pedidos totales entregados" en panel estadística por zona: la lógica de cálculo ya es correcta (usa isPedidoEntregado que chequea sub_estado_nro IN (3,19)). El bug reportado está en los tooltips de la tabla que solo mencionan sub_estado 3, generando confusión.
2. Card de pedido (PedidoInfoPopup): muestra la sección "Cumplido" para TODOS los pedidos con estado_nro=2, pero debería mostrarse solo cuando el pedido está "Entregado" (isPedidoEntregado = estado_nro=2 AND sub_estado_nro IN (3,19)).
3. Tabla extendida (PedidosTableModal): la columna "Atraso" solo se muestra cuando esEntregado && tieneMovil. El pedido dice que debe mostrarse para TODOS los finalizados que tengan el campo, independientemente de si es entregado o tiene móvil.

## Acceptance criteria
- [ ] AC1: ZonaEstadisticasModal — tooltip del th "Entregados" dice "sub_estado 3 o 19" (no solo 3). Tooltip del th "No Entregados" dice "sub_estado ≠ 3 y ≠ 19" (no solo ≠ 3).
- [ ] AC2: LeaderboardModal — mismos tooltips corregidos.
- [ ] AC3: PedidoInfoPopup — sección "Cumplido" solo aparece cuando isPedidoEntregado(pedido) es true (estado_nro=2 AND sub_estado_nro IN (3,19)). Para pedidos finalizados pero NO entregados (cancelados, etc.), NO se muestra la sección Cumplido.
- [ ] AC4: PedidoInfoPopup — cuando el pedido ES entregado y NO tiene móvil asignado, se muestra solo "Fecha Cumplido" (sin Atraso). Cuando ES entregado CON móvil, se muestran ambos campos.
- [ ] AC5: PedidosTableModal — columna "Atraso" muestra el valor de atraso_cump_mins para TODOS los pedidos finalizados que tengan el campo no-null, independientemente de si es entregado o tiene móvil asignado.
- [ ] AC6: PedidosTableModal — columna "Cumplido" (fch_hora_finalizacion) permanece sin cambios (ya se muestra correctamente para todos los finalizados).
- [ ] AC7: Formato de atraso en la tabla consistente con el formato ya usado (ej: "5' antes" o "3'").
- [ ] AC8: Ningún otro KPI del ZonaEstadisticasModal se ve afectado por los cambios.

## Áreas afectadas
- components/map/PedidoInfoPopup.tsx — cambio en condición de la sección "Cumplido"
- components/ui/PedidosTableModal.tsx — cambio en condición de mostrarAtraso en la tabla
- components/ui/ZonaEstadisticasModal.tsx — corrección de tooltips
- components/ui/LeaderboardModal.tsx — corrección de tooltips
