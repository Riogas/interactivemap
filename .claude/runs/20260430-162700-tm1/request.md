# Pedido original (vía Telegram, 2026-04-30 16:26 UY)

> parece que no está filtrando los pedidos / services por los móviles que tengo seleccionados lo cual está mal ... Lanza /feature para revisar corregir esto .. y cuando se pone seleccionar todo está poniendo los números de móvil en el badge de arriba en lugar de poner "todos" y comportarse como cuando se inicia sesión por primera vez
>
> ademas, el seleccionar todos me pone un +200 como si estuviera seleccionando algunos del total que hay en la tabla lo cual esta mal, porque es del total que veo en el colapsable... si en el colapsable tengo 80, y al seleccionar todos es 80/80 el badge deberia decir todos y FILTRAR por esos moviles..
>
> Adicionalmente cuando filtro por un o unos moviles "x", tanto los pedidos como los services solo deben ser de esos moviles seleccionados, no deber mostrar ni los pedidos de moviles inactivos, ni los pedidos sin movil... realiza la /feature para todo esto y que el triage decida que es lo mejor para arreglar todo esto que te comento

## Captura adjunta (resumen visual)
- Badge top: `Móviles: 106, 252, 250, 147, 136 +200 ×`
- Empresa Fletera con colapsable expandido. Header "Móviles 1" indica solo 1 móvil seleccionado dentro.
- Pedidos: 204 visibles. Filas muestran móviles 227, 167, 330, 770, "Sin asignar", 876 — ninguno coincide con el móvil seleccionado en el colapsable.

## Calidad detectada
**bueno** — multi-párrafo, 3 problemas concretos enumerados, captura confirma síntomas, comportamiento esperado claro.

## Acciones tomadas por el orquestador
- Sin enrichment (calidad bueno).
- Sin lessons previos (primer run en `.claude/runs/` de este repo).
- Stack confirmado: Next 16 + React 19 + Supabase + Tailwind 4 + Vitest (de package.json).

## Pedido enriquecido para los agentes downstream

### Síntomas (3)

1. **Filtro de móviles no aplica a pedidos ni services.** Aunque el usuario selecciona uno o varios móviles en el multiselect, la lista de pedidos/services sigue mostrando registros de:
   - Móviles NO seleccionados
   - Móviles inactivos
   - Pedidos "Sin asignar" (sin móvil asociado)

2. **Badge "Seleccionar todos" mal renderizado.** Al elegir "Seleccionar todos", el badge superior muestra los IDs de móviles concatenados (`Móviles: 106, 252, 250, 147, 136 +200`). Debería mostrar simplemente `Móviles: Todos` y comportarse como en el primer login (sin filtro activo / vista completa).

3. **El "+200" usa el total equivocado.** El badge calcula `+N` contra el total global de móviles existentes en lugar del total disponible en el colapsable de la Empresa Fletera. Si el colapsable tiene 80 móviles y se seleccionan los 80, el badge debe leer `Todos` (80/80), no `+200`.

### Comportamiento esperado

- Al seleccionar 1 o más móviles: pedidos y services SOLO de esos móviles. Cero pedidos/services de móviles no seleccionados, cero de inactivos, cero "Sin asignar".
- Al "Seleccionar todos" del colapsable: badge muestra `Todos` y la lista se comporta como vista sin filtro (incluyendo pedidos sin móvil si ese era el comportamiento inicial — a confirmar).
- El conteo `+N` debe usar como denominador el total visible/disponible en el colapsable, no el universo global.

### Notas para triage
- Áreas: UI (badge multiselect), state/filtros, data layer (queries de pedidos/services, joins con móviles activos)
- NO toca: auth, DB schema, infra
- Reportado por usuario final desde producción → priorizar fix correcto sobre velocidad
