# Spec mínima (inline orquestador): Fix filtro de móviles en dashboard

## Pedido literal
Ver `request.md`. Reportado vía Telegram con captura adjunta.

## Síntoma reportado
1. **Filtro no aplica.** Selecciono 1 móvil en el colapsable "Empresa Fletera" y la lista de pedidos sigue mostrando 204 registros de múltiples móviles (227, 167, 330, 770, 876) y "Sin asignar".
2. **Badge "Todos" mal renderizado.** Al hacer "Seleccionar todos", el badge muestra IDs concatenados con `+200` en lugar de un literal "Todos".
3. **Contador `+N` mal calculado.** El `+N` se computa contra el universo global de móviles, no contra el total disponible en el colapsable. Si colapsable tiene 80 y selecciono 80, debe leer "Todos" (80/80), no "+200".

## Acceptance criteria

- [ ] **AC1.** Al seleccionar 1+ móviles, la lista de **pedidos** muestra exclusivamente pedidos de esos móviles. Cero pedidos de móviles no seleccionados, cero de móviles inactivos, cero "Sin asignar".
- [ ] **AC2.** Al seleccionar 1+ móviles, la lista de **services** muestra exclusivamente services de esos móviles. Mismas exclusiones que AC1.
- [ ] **AC3.** Al usar "Seleccionar todos" del colapsable de una empresa fletera con N móviles disponibles, el badge superior muestra el literal `Móviles: Todos` (no IDs concatenados, no contador `+N`).
- [ ] **AC4.** El comportamiento de "Seleccionar todos" debe coincidir con el del primer login — vista sin filtro de móvil activo.
- [ ] **AC5.** Cuando hay selección parcial (no todos), el badge muestra los IDs visibles + `+N` donde **N = (total disponible en el colapsable de esa empresa) − (visibles)**, NO contra el universo global de móviles.
- [ ] **AC6.** Si la empresa fletera tiene 80 móviles disponibles y el usuario selecciona los 80, el badge dice "Todos" (no "+0", no IDs).

## Edge cases a cubrir

- [ ] **EC1.** Empresa fletera con 0 móviles disponibles → no debería ser posible seleccionar nada; badge no muestra IDs raros.
- [ ] **EC2.** Selección que mezcla móviles de varias empresas (si está soportado) → cada colapsable evalúa "Todos" independientemente.
- [ ] **EC3.** Filtro de búsqueda activo en el multiselect: el "Todos" debe seleccionar **solo los visibles tras la búsqueda**, y el contador debe ser sobre los visibles, no sobre todos.
- [ ] **EC4.** Pedidos cuyo móvil pasó a inactivo después de creados → no deben aparecer cuando hay filtro activo (cualquiera).
- [ ] **EC5.** Quitar todos los móviles seleccionados (deselect all) → vuelve a vista sin filtro (igual que primer login).

## Áreas afectadas (de triage)
- `components/ui/MovilSelector.tsx` (líneas ~212-291 lógica filtro, 312-440 aplicación, 645-657 badge)
- `app/dashboard/page.tsx` (líneas 188-250: estado de empresas/móviles seleccionados)
- `hooks/dashboard/useFilterHelpers.ts` (lógica auxiliar)

## Out of scope
- Cambios a auth, schema de DB, API.
- Refactor del multiselect (solo fix de los bugs mencionados).
- Performance del filtro (no hay queja de lentitud).
- Documentación de usuario (es bug-fix).

## Respuestas a clarifying questions del triage (resueltas por el orquestador desde el pedido original)
1. **El colapsable Empresa Fletera contiene los N móviles asignados a esa empresa.** El "80" del usuario es ejemplo. "Todos" del colapsable = todos los móviles de esa empresa fletera.
2. **El badge dice "Todos" literal** cuando todos los del colapsable están seleccionados. Comportamiento coincide con primer login.
3. **Sí**, pedidos/services "Sin asignar" o de móviles inactivos se filtran al activar cualquier filtro de móviles.
