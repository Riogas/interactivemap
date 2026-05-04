# Lessons — 20260502-130000-tm2

## Pedido
3 cambios al panel modal de estadística por zona y tarjeta/tabla de pedidos: bug en indicador entregados, 2 campos en card cuando estado=Entregado, 2 columnas en tabla extendida.

## Bucket inicial
bug-fix (inline triage, alta confianza).

## Resumen del path
```
triage (inline, ~1min)
  → implementer (sonnet-inline, ~5min, $0.04)
  → code-reviewer (inline, ~1min, $0.01)
  → qa-tester (inline, ~1min, $0.01)
Total: ~$0.06, ~15min wall-clock.
```

## Patrones detectados

### "Bug reportado" que no es bug de lógica sino de documentación
**Lección:** El usuario reportó "indicador de pedidos totales entregados está sumando mal". Al revisar el código, la lógica era CORRECTA (`isPedidoEntregado()` ya chequea sub_estado 3 Y 19). El error real era en los tooltips de la tabla que solo mencionaban sub_estado 3, creando confusión sobre qué estaba contando.
**How to apply:** Cuando un bug report dice "está sumando mal" en TrackMovil, revisar PRIMERO la lógica de cálculo vs `isPedidoEntregado`. Si la lógica está bien, buscar inconsistencias de documentación (tooltips, comentarios) que puedan confundir al usuario.

### Diferencia card vs tabla en visualización de atraso
**Lección:** La card (PedidoInfoPopup) muestra atraso SOLO para pedidos entregados CON móvil (comportamiento correcto: refleja el atraso de la entrega real). La tabla (PedidosTableModal) muestra atraso para TODOS los finalizados con el campo (comportamiento nuevo: mayor transparencia operacional). Son comportamientos deliberadamente distintos por contexto de uso.
**How to apply:** En TrackMovil, cuando haya duda sobre si una nueva columna debe ser "restrictiva" o "permisiva", referirse al pedido literal. La card es el detalle individual → muestra atraso solo cuando tiene sentido operacional. La tabla es el listado masivo → muestra todos los datos disponibles.

### Simplificación de dead code post-restricción
**Lección:** Cuando se cambia una condición exterior (`isPedidoEntregado(pedido)`) que hace redundante una variable interior (`esEntregado = isPedidoEntregado(pedido)`), hay que simplificar y eliminar el dead code resultante. El reviewer lo detectó y se corrigió antes de commitar.
**How to apply:** Después de cambiar condiciones de renderizado en React, verificar si hay variables declaradas dentro del bloque que ahora son tautologías.

## Métricas clave
- Iteraciones: 1 (sin rejections)
- LOC producción: +9 -10 (4 archivos)
- Tests: 310/310 PASSED (sin tests nuevos necesarios — cambios son presentación)
- Escalación: NO
